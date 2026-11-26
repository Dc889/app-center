import {check, json, id} from '../../../../runtime/http.mjs'
import {fetchDifyDocumentSegments, getDifyDatasetDetail, getDifyDatasetDetailWithFallback} from '../adapters/dify-datasets.mjs'
import {fetchRagflowDocumentChunks, getRagflowDatasetDetail, getRagflowExternalEndpoint} from '../adapters/ragflow-datasets.mjs'
import {diffDocuments, resolveBindingVariant, sha256Hex} from '../adapters/knowledge-store.mjs'

async function fetchLiveDataset(dataset, clients) {
  if (dataset.sourceSystem === 'RAGFlow') {
    return getRagflowDatasetDetail(dataset.sourceResourceId)
  }
  return getDifyDatasetDetailWithFallback(dataset.sourceResourceId, dataset.sourceScopeId, {clients, fallbackDataset: dataset})
}

async function fetchOrgItems(clients) {
  if (!clients?.management) return []
  try {
    const res = await clients.management('/organizations')
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data?.items) ? data.items : []
  } catch {
    return []
  }
}

function orgMatchesBoundary(userOrg, boundaryList, orgItems) {
  const list = Array.isArray(boundaryList) ? boundaryList.filter(Boolean) : []
  if (list.length === 0 || !userOrg) return true
  if (list.includes(userOrg) || list.includes('全员') || list.includes('全部')) return true
  if (!Array.isArray(orgItems) || orgItems.length === 0) return false
  const byId = new Map()
  const byName = new Map()
  for (const node of orgItems) {
    if (!node) continue
    if (node.id) byId.set(node.id, node)
    if (node.name) byName.set(node.name, node)
  }
  let cur = byName.get(userOrg) || byId.get(userOrg)
  const visited = new Set()
  while (cur && !visited.has(cur.id || cur.name)) {
    visited.add(cur.id || cur.name)
    if (cur.name && list.includes(cur.name)) return true
    if (cur.id && list.includes(cur.id)) return true
    cur = cur.parentId ? byId.get(cur.parentId) : null
  }
  return false
}

async function fetchKeywordRules(clients) {
  if (!clients?.management) return {ruleSetVersion: 0, rules: []}
  try {
    const res = await clients.management('/keyword-rules')
    const data = await res.json()
    const items = Array.isArray(data?.items) ? data.items : []
    const rules = items.filter(r => r && r.enabled !== false && (!Array.isArray(r.targets) || r.targets.includes('知识库文档')))
    return {ruleSetVersion: data?.ruleSetVersion ?? 1, rules}
  } catch {
    return {ruleSetVersion: 0, rules: []}
  }
}

function scanTextAgainstRules(text, rules) {
  if (!text || !rules.length) return []
  const hits = []
  for (const rule of rules) {
    let matched = false
    try {
      if (rule.matchMode === '正则表达式') {
        matched = new RegExp(rule.pattern, 'i').test(text)
      } else {
        matched = text.toLowerCase().includes(String(rule.pattern || '').toLowerCase())
      }
    } catch {
      // 忽略非法正则
    }
    if (matched) {
      hits.push({ruleId: rule.ruleId, category: rule.category, severity: rule.severity, pattern: rule.pattern, note: rule.note ?? ''})
    }
  }
  return hits
}

async function autoSyncDatasetIfMissing(openLedger, resourceId, workspaceId, identity) {
  const db = openLedger('datasets')
  const existing = db.get(resourceId)
  if (existing) return existing

  // 尝试从真实 RAGFlow / Dify 自动纳管（免去已取消的 KB-01 工单）
  let live = null
  let sourceSystem = 'RAGFlow'
  try {
    live = await getRagflowDatasetDetail(resourceId)
    sourceSystem = 'RAGFlow'
  } catch {
    try {
      live = await getDifyDatasetDetail(resourceId, workspaceId || undefined)
      sourceSystem = 'Dify'
    } catch {
      return null
    }
  }
  const now = new Date().toISOString()
  const record = {
    resourceId,
    name: live.name || resourceId,
    sourceSystem,
    sourceResourceId: resourceId,
    sourceScopeId: sourceSystem === 'RAGFlow' ? (live.tenantId || workspaceId || '') : (live.workspaceId || workspaceId || ''),
    ownerAccount: identity?.account || live.ownerAccount || '',
    status: '已纳管',
    revision: 1,
    documents: live.documents ?? [],
    manifestSnapshotId: live.manifestSnapshotId,
    manifestSha256: live.manifestSha256,
    syncedAt: now,
    updatedAt: now,
  }
  db.put(resourceId, record)
  return record
}

function activeBindingsFor(openLedger, resourceId) {
  const bindings = openLedger('bindings')
  return bindings.all().filter(b => b.catalogResourceId === resourceId && b.status === 'active')
}

export async function kb02Context(ctx) {
  const {query, res, openLedger, clients, identity} = ctx
  const action = query.get('action') ?? 'publish_dataset'
  check(action === 'publish_dataset', 400, 'INVALID_ACTION')
  const resourceId = query.get('resourceId')
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  check(typeof resourceId === 'string' && resourceId.trim(), 400, 'INVALID_REQUEST')

  const dataset = await autoSyncDatasetIfMissing(openLedger, resourceId, workspaceId, identity)
  check(dataset, 404, 'NOT_FOUND', '未找到已纳管的知识库')
  const live = await fetchLiveDataset(dataset, clients)
  const {ruleSetVersion, rules} = await fetchKeywordRules(clients)

  let totalScannedChunks = 0
  const docs = []
  for (const d of live.documents) {
    let chunkTexts = []
    if (rules.length > 0 && dataset.sourceSystem === 'RAGFlow') {
      chunkTexts = await fetchRagflowDocumentChunks(dataset.sourceResourceId, d.documentId)
    } else if (rules.length > 0 && dataset.sourceSystem === 'Dify') {
      chunkTexts = await fetchDifyDocumentSegments(dataset.sourceResourceId, d.documentId)
    }
    totalScannedChunks += chunkTexts.length
    // 零留存流式扫描：正文切片仅在内存中与 CFG-02 词库比对，不落盘、不写入快照
    const sampleText = [d.name, d.previewText, d.content, ...chunkTexts].filter(Boolean).join('\n')
    const hits = scanTextAgainstRules(sampleText, rules)
    const blocked = hits.some(h => h.severity === '阻断')
    docs.push({
      documentId: d.documentId,
      name: d.name,
      sha256: d.sha256,
      scannedChunks: chunkTexts.length,
      autoVerdict: blocked ? '不通过' : d.autoVerdict,
      ...(hits.length ? {matchedRules: hits} : {}),
    })
  }
  const blockedCount = docs.filter(d => d.autoVerdict !== '通过').length
  const warnCount = docs.filter(d => Array.isArray(d.matchedRules) && d.matchedRules.some(r => r.severity === '告警')).length

  return json(res, {
    snapshotId: `kb02-${id()}`,
    ticketType: 'KB-02',
    action: 'publish_dataset',
    resourceId,
    capturedAt: new Date().toISOString(),
    eligible: live.modelVerified && docs.every(d => d.autoVerdict === '通过'),
    fields: {
      来源系统: dataset.sourceSystem,
      所有者账户名: dataset.ownerAccount,
      'workspace/tenant ID': dataset.sourceScopeId,
      文档清单快照ID: live.manifestSnapshotId,
      文档数: docs.length,
      模型目录核对结果: live.modelVerified ? '一致' : '不一致',
      关键词扫描规则版本: ruleSetVersion ? `v${ruleSetVersion}（启用 ${rules.length} 条规则，扫描 ${totalScannedChunks} 个正文切片，零留存）` : '未启用外部词库',
      关键词扫描结论: blockedCount > 0 ? `阻断（${blockedCount} 份文档命中阻断词）` : warnCount > 0 ? `告警放行（${warnCount} 份文档命中告警词）` : '通过（未命中敏感关键词）',
      文档审查明细: docs,
    },
    preconditions: [
      {kind: 'dataset_manifest', id: live.manifestSnapshotId, sha256: live.manifestSha256},
      {kind: 'dataset', id: resourceId, revision: dataset.revision},
    ],
  })
}

export async function kb03Candidates(ctx) {
  const {query, identity, res, openLedger, clients} = ctx
  const action = query.get('action')
  const workspaceId = query.get('workspaceId')
  const permission = query.get('permission') ?? '检索使用'
  check(
    action === 'bind_dataset' &&
      typeof workspaceId === 'string' &&
      workspaceId.trim() &&
      ['检索使用', '编排绑定'].includes(permission),
    400,
    'INVALID_BINDING_CANDIDATE_QUERY',
  )
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const limit = Math.min(Math.max(Number(query.get('limit') ?? 50) || 50, 1), 100)
  const account = identity?.account ?? ''
  const org = identity?.org ?? ''
  const orgItems = await fetchOrgItems(clients)

  const rows = openLedger('datasets')
    .all()
    .filter(row => {
      if (row.status === '已下架' || row.status === '暂停分享') return false
      if (row.status === '已纳管' && row.ownerAccount !== account) return false
      if (row.status === '已发布') {
        const boundary = row.boundaryOrgs ?? []
        if (boundary.length > 0 && org && !orgMatchesBoundary(org, boundary, orgItems) && row.ownerAccount !== account) return false
        if (row.shareMode === '指定人员' && !(row.targetAccounts ?? []).includes(account) && row.ownerAccount !== account) {
          return false
        }
        if (row.shareMode === '指定组织' && org && !orgMatchesBoundary(org, row.targetOrgs ?? [], orgItems) && row.ownerAccount !== account) {
          return false
        }
      }
      if (
        q &&
        !row.name.toLowerCase().includes(q) &&
        !row.resourceId.toLowerCase().includes(q) &&
        !row.sourceResourceId.toLowerCase().includes(q)
      ) {
        return false
      }
      return true
    })
    .slice(0, limit)
    .map(row => ({
      resourceId: row.resourceId,
      name: row.name,
      workspaceId,
      source: row.status === '已发布' ? '已发布共享' : '本人纳管',
      sourceSystem: row.sourceSystem,
      sourceScopeId: row.sourceScopeId,
      sourceResourceId: row.sourceResourceId,
      ownerAccount: row.ownerAccount,
    }))

  return json(res, {items: rows, nextCursor: null})
}

export async function kb03Context(ctx) {
  const {query, identity, res, openLedger, clients} = ctx
  const action = query.get('action')
  const resourceId = query.get('resourceId')
  const workspaceId = query.get('workspaceId')
  const permission = query.get('permission') ?? '检索使用'
  check(
    action === 'bind_dataset' &&
      typeof resourceId === 'string' &&
      resourceId.trim() &&
      typeof workspaceId === 'string' &&
      workspaceId.trim() &&
      ['检索使用', '编排绑定'].includes(permission),
    400,
    'INVALID_BINDING_QUERY',
  )

  const dataset = openLedger('datasets').get(resourceId)
  check(dataset && !['已下架', '暂停分享'].includes(dataset.status), 404, 'NOT_FOUND', '知识库不存在或已停止分享')

  const isPublished = dataset.status === '已发布'
  const account = identity?.account ?? ''
  const org = identity?.org ?? ''
  if (!isPublished) {
    check(dataset.ownerAccount === account, 403, 'PRIVATE_DATASET_NOT_OWNED', '仅知识库所有者可绑定私有知识库')
  }

  const orgItems = await fetchOrgItems(clients)
  const boundaryOrgs = dataset.boundaryOrgs?.length ? dataset.boundaryOrgs : [org || '默认组织']
  const boundaryMatched =
    !isPublished ||
    dataset.ownerAccount === account ||
    !org ||
    orgMatchesBoundary(org, boundaryOrgs, orgItems)

  const variant = resolveBindingVariant(dataset.sourceSystem, dataset.sourceScopeId, workspaceId)
  const fields = {
    目录来源: isPublished ? '已发布共享' : '本人纳管',
    来源系统: dataset.sourceSystem,
    知识库名称: dataset.name,
    源知识库ID: dataset.sourceResourceId,
    源所有者账户名: dataset.ownerAccount,
    '目标Dify workspace ID': workspaceId,
    '源workspace/tenant ID': dataset.sourceScopeId,
    policyRef: dataset.policyRef ?? `private-${dataset.resourceId}`,
    实现方式: variant,
    边界匹配结果: boundaryMatched ? '符合' : '不符合',
    组织边界: boundaryOrgs,
    密级: dataset.classification ?? '内部',
    业务线: dataset.businessLine ?? '通用业务',
    允许申请权限: ['检索使用', '编排绑定'],
  }

  const preconditions = [{kind: 'dataset_catalog', id: resourceId, revision: dataset.revision}]

  if (variant === 'RAGFlow外部知识库') {
    fields['外部知识库API地址'] = getRagflowExternalEndpoint()
  }
  if (variant === 'Dify跨workspace复制') {
    const live = await fetchLiveDataset(dataset, clients)
    fields['源文档版本指纹'] = live.manifestSha256
    fields['文档清单快照ID'] = live.manifestSnapshotId
    preconditions.push({kind: 'dataset_manifest', id: live.manifestSnapshotId, sha256: live.manifestSha256})
  }

  return json(res, {
    snapshotId: `kb03-${id()}`,
    ticketType: 'KB-03',
    action: 'bind_dataset',
    resourceId,
    capturedAt: new Date().toISOString(),
    eligible: boundaryMatched,
    fields,
    preconditions,
  })
}

export async function kb04Context(ctx) {
  const {query, res, openLedger, clients} = ctx
  const action = query.get('action')
  const resourceId = query.get('resourceId')
  const sourceEventId = query.get('sourceEventId')
  check(
    action === 'review_dataset_changes' &&
      typeof resourceId === 'string' &&
      resourceId.trim() &&
      typeof sourceEventId === 'string' &&
      sourceEventId.trim(),
    400,
    'INVALID_REQUEST',
  )

  const dataset = openLedger('datasets').get(resourceId)
  check(dataset && ['已发布', '暂停分享'].includes(dataset.status), 404, 'NOT_FOUND', '未找到可进行变更再审的知识库')

  const live = await fetchLiveDataset(dataset, clients)
  const changes = diffDocuments(dataset.documents ?? [], live.documents)
  check(
    changes.length > 0 && live.manifestSnapshotId !== dataset.manifestSnapshotId,
    409,
    'NO_DATASET_CHANGES',
    '源知识库文档清单未发生变化',
  )

  const autoDispositionEventId = `kb04-auto-${sourceEventId}`
  const manualDispositionEventId = `kb04-manual-${sourceEventId}`

  const alertsLedger = openLedger('alerts')
  const evidenceSha = sha256Hex({resourceId, sourceEventId, manifestSha256: live.manifestSha256, changes})
  for (const eventId of [autoDispositionEventId, manualDispositionEventId]) {
    if (!alertsLedger.get(eventId)) {
      alertsLedger.put(eventId, {
        sourceEventId: eventId,
        resourceId,
        evidence: [{evidenceId: `ev-${sha256Hex(eventId).slice(0, 16)}`, sha256: evidenceSha}],
        createdAt: new Date().toISOString(),
      })
    }
  }

  return json(res, {
    snapshotId: `kb04-${id()}`,
    ticketType: 'KB-04',
    action: 'review_dataset_changes',
    resourceId,
    capturedAt: new Date().toISOString(),
    eligible: true,
    fields: {
      变更事件ID: sourceEventId,
      所有者账户名: dataset.ownerAccount,
      来源系统: dataset.sourceSystem,
      源知识库ID: dataset.sourceResourceId,
      'workspace/tenant ID': dataset.sourceScopeId,
      知识库名称: dataset.name,
      上次快照ID: dataset.manifestSnapshotId,
      当前快照ID: live.manifestSnapshotId,
      文档清单快照ID: live.manifestSnapshotId,
      处置证据事件ID: autoDispositionEventId,
      人工处置证据事件ID: manualDispositionEventId,
      原目录状态: dataset.status,
      新增文档数: changes.filter(c => c.changeType === '新增').length,
      变更文档数: changes.filter(c => c.changeType === '修改').length,
      删除文档数: changes.filter(c => c.changeType === '删除').length,
      变更明细: changes,
    },
    preconditions: [
      {kind: 'dataset', id: resourceId, revision: dataset.revision},
      {kind: 'dataset_manifest', id: live.manifestSnapshotId, sha256: live.manifestSha256},
    ],
  })
}

export async function kb05Candidates(ctx) {
  const {query, res, openLedger} = ctx
  check(query.get('action') === 'dispose_dataset', 400, 'INVALID_DISPOSITION_CANDIDATES')
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const limit = Math.min(Math.max(Number(query.get('limit') ?? 50) || 50, 1), 100)

  const items = openLedger('datasets')
    .all()
    .filter(
      row =>
        row.status !== '已下架' &&
        (!q ||
          row.name.toLowerCase().includes(q) ||
          row.resourceId.toLowerCase().includes(q) ||
          row.sourceResourceId.toLowerCase().includes(q)),
    )
    .slice(0, limit)
    .map(row => ({
      resourceId: row.resourceId,
      name: row.name,
      source: row.sourceSystem,
      sourceScopeId: row.sourceScopeId,
      sourceResourceId: row.sourceResourceId,
    }))

  return json(res, {items, nextCursor: null})
}

export async function kb05Context(ctx) {
  const {query, identity, res, openLedger, clients} = ctx
  const action = query.get('action') ?? 'dispose_dataset'
  const resourceId = query.get('resourceId')
  const sourceEventId = query.get('sourceEventId') || null
  check(
    ['dispose_dataset', 'pause_share'].includes(action) && typeof resourceId === 'string' && resourceId.trim(),
    400,
    'INVALID_REQUEST',
  )

  const dataset = openLedger('datasets').get(resourceId)
  check(dataset && dataset.status !== '已下架', 404, 'NOT_FOUND', '未找到可处置的知识库')

  let alertEvidence = null
  if (sourceEventId) {
    check(identity?.account === 'system_event', 403, 'ALERT_IDENTITY_REQUIRED', '告警来源须由系统事件身份核验')
    const alert = openLedger('alerts').get(sourceEventId)
    check(alert && alert.resourceId === resourceId && Array.isArray(alert.evidence) && alert.evidence.length > 0, 409, 'INVALID_ALERT_EVIDENCE')
    alertEvidence = alert.evidence
  }

  const live = await fetchLiveDataset(dataset, clients)
  const bindings = activeBindingsFor(openLedger, resourceId)
  const impactedApps = new Set(bindings.map(b => b.targetAppId).filter(Boolean))

  const targets = [
    {system: '平台', objectId: dataset.resourceId, action: '目录下架'},
    {system: '平台', objectId: dataset.resourceId, action: '暂停分享'},
  ]
  for (const b of bindings) {
    targets.push({system: 'Dify', objectId: b.bindingId, action: '撤销未到期授权'})
  }
  if (bindings.length === 0) {
    targets.push({system: dataset.sourceSystem, objectId: dataset.sourceResourceId, action: '撤销未到期授权'})
  }
  for (const doc of live.documents) {
    targets.push({
      system: dataset.sourceSystem,
      objectId: dataset.sourceResourceId,
      action: '停用文档',
      documentId: doc.documentId,
    })
  }

  const fields = {
    知识库名称: dataset.name,
    来源系统: dataset.sourceSystem,
    '源workspace/tenant ID': dataset.sourceScopeId,
    源知识库ID: dataset.sourceResourceId,
    文档清单快照ID: live.manifestSnapshotId,
    清单完整: true,
    文档清单: live.documents.map(({documentId, sha256}) => ({documentId, sha256})),
    影响中的授权数: bindings.length,
    影响中的智能体数: impactedApps.size,
    处置目标清单: targets,
    ...(sourceEventId ? {告警ID: sourceEventId, 告警证据: alertEvidence} : {}),
  }

  return json(res, {
    snapshotId: `kb05-${id()}`,
    ticketType: 'KB-05',
    action,
    resourceId,
    capturedAt: new Date().toISOString(),
    eligible: true,
    fields,
    preconditions: [
      {kind: 'dataset', id: resourceId, revision: dataset.revision},
      {kind: 'dataset_manifest', id: live.manifestSnapshotId, sha256: live.manifestSha256},
    ],
  })
}
