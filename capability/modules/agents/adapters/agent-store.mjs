import {randomUUID} from 'node:crypto'
import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig, resolveProductOwner, difyConsoleFetch} from '../../../platform/dify/public.mjs'

export async function listDifyApps({workspaceId, openLedger} = {}) {
  const {isReal, workspaceId: configuredWorkspace} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 应用连接')
  const scope = workspaceId || configuredWorkspace
  const map = new Map()
  let page = 1
  for (;;) {
    const response = await difyConsoleFetch(`/console/api/apps?page=${page}&limit=100`)
    check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 应用列表读取失败: HTTP ${response.status}`)
    const data = await response.json()
    check(Array.isArray(data?.data), 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 应用列表响应格式错误')
    for (const app of data.data) {
      check(typeof app?.id === 'string' && app.id, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 应用缺少真实标识')
      const appScope = app.workspace_id || workspaceId || configuredWorkspace
      if (scope && appScope && appScope !== scope) continue
      const synced = openLedger ? openLedger('synced-apps').get(app.id) : null
      map.set(app.id, {
        resourceId: app.id,
        name: app.name || app.id,
        source: 'dify',
        workspaceId: appScope || null,
        revision: synced?.revision ?? 0,
        mode: app.mode ?? null,
        description: typeof app.description === 'string' ? app.description : null,
        ownerAccount: resolveProductOwner([app.owner_account, app.ownerAccount, app.created_by], {product: 'DIFY'}),
        webSiteEnabled: app.enable_site ?? app.webSiteEnabled ?? null,
        publicationVersionId: app.publication_version_id ?? app.publicationVersionId ?? app.workflow?.id ?? null,
        workflowSnapshotId: app.workflow_snapshot_id ?? app.workflowSnapshotId ?? app.workflow?.id ?? null,
      })
    }
    if (!data.has_more) break
    check(data.data.length > 0 && page < 10000, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 应用分页未结束')
    page += 1
  }
  // 同步台账只补充管理元数据，不能让已删除或已失权的产品资源重新出现。
  return [...map.values()]
}

export async function readDifyApp(appId, workspaceId) {
  const {isReal, workspaceId: configuredWorkspace} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 应用连接')
  const response = await difyConsoleFetch(`/console/api/apps/${encodeURIComponent(appId)}`)
  check(response.ok, response.status === 404 ? 404 : 503, 'UPSTREAM_ERROR', `Dify 应用详情读取失败: HTTP ${response.status}`)
  const app = await response.json()
  check(app?.id === appId, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 应用详情标识不一致')
  const actualScope = app.workspace_id || workspaceId || configuredWorkspace
  check(!workspaceId || !actualScope || workspaceId === actualScope, 404, 'NOT_FOUND', '应用不属于目标工作区')
  const difyRev = Number.isInteger(app.updated_at) && app.updated_at > 0 ? `dify-ts-${app.updated_at}` : null
  return {
    resourceId: app.id,
    name: app.name,
    workspaceId: actualScope || null,
    mode: app.mode ?? null,
    ownerAccount: resolveProductOwner([app.owner_account, app.ownerAccount, app.created_by], {product: 'DIFY'}),
    webSiteEnabled: app.enable_site ?? null,
    publicationVersionId: app.publication_version_id ?? app.publicationVersionId ?? app.workflow?.id ?? app.model_config?.id ?? difyRev,
    workflowSnapshotId: app.workflow_snapshot_id ?? app.workflowSnapshotId ?? app.workflow?.id ?? difyRev,
    modelConfig: app.model_config ?? null,
  }
}

const KIND_LABELS = {knowledge: '知识库', plugin: '插件', mcp: 'MCP', tool: '自定义工具'}

async function fetchDifyWorkflowGraph(appId) {
  for (const suffix of ['workflows/publish', 'workflows/draft']) {
    try {
      const res = await difyConsoleFetch(`/console/api/apps/${encodeURIComponent(appId)}/${suffix}`)
      if (res.ok) {
        const body = await res.json()
        if (body?.graph?.nodes && Array.isArray(body.graph.nodes)) {
          return {inspected: true, source: suffix, nodes: body.graph.nodes}
        }
      }
    } catch {
      // 未发布或未初始化工作流草稿时忽略
    }
  }
  return {inspected: false, source: null, nodes: []}
}

async function fetchDifyDatasetName(datasetId) {
  try {
    const res = await difyConsoleFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}`)
    if (res.ok) {
      const body = await res.json()
      if (body?.name) return body.name
    }
  } catch {
    // 忽略名称回查失败
  }
  return null
}

async function safeJsonList(fn) {
  try {
    const res = await fn()
    const body = await res.json()
    return Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : []
  } catch {
    return []
  }
}

export async function inspectDifyAppDependencies(app, {clients} = {}) {
  const raw = new Map()
  const add = item => {
    const key = `${item.kind}:${item.id}`
    if (!raw.has(key)) raw.set(key, item)
  }

  // 1. 解析 model_config（chat / agent-chat / completion 模式）
  const mc = app?.modelConfig
  if (mc && typeof mc === 'object') {
    const dsList = mc.dataset_configs?.datasets?.datasets
    if (Array.isArray(dsList)) {
      for (const entry of dsList) {
        const ds = entry?.dataset ?? entry
        if (ds?.id && ds?.enabled !== false) {
          add({kind: 'knowledge', id: String(ds.id), name: ds.name || String(ds.id), source: 'dify-model-config'})
        }
      }
    }
    const tools = mc.agent_mode?.tools
    if (Array.isArray(tools)) {
      for (const t of tools) {
        if (!t || t.enabled === false) continue
        const providerType = String(t.provider_type || '').toLowerCase()
        const id = String(t.provider_id || t.provider_name || t.tool_name || '')
        if (!id) continue
        const label = t.tool_label || t.tool_name || t.provider_name || id
        if (providerType === 'mcp') {
          add({kind: 'mcp', id, name: label, source: 'dify-model-config'})
        } else if (providerType === 'api') {
          add({kind: 'tool', id, name: label, source: 'dify-model-config'})
        } else {
          add({kind: 'plugin', id, name: label, source: 'dify-model-config'})
        }
      }
    }
  }

  // 2. 解析 workflow / advanced-chat 图节点
  let workflowInspected = false
  if (app?.resourceId && ['workflow', 'advanced-chat'].includes(app.mode)) {
    const wf = await fetchDifyWorkflowGraph(app.resourceId)
    workflowInspected = wf.inspected
    for (const node of wf.nodes) {
      const d = node?.data
      if (!d || typeof d !== 'object') continue
      if (d.type === 'knowledge-retrieval' && Array.isArray(d.dataset_ids)) {
        for (const dsId of d.dataset_ids) {
          if (dsId) add({kind: 'knowledge', id: String(dsId), name: String(dsId), source: `dify-${wf.source}`})
        }
      } else if (d.type === 'tool') {
        const providerType = String(d.provider_type || '').toLowerCase()
        const id = String(d.provider_id || d.provider_name || d.tool_name || node.id)
        const label = d.title || d.tool_label || d.tool_name || d.provider_name || id
        if (providerType === 'mcp') {
          add({kind: 'mcp', id, name: label, source: `dify-${wf.source}`})
        } else if (providerType === 'api') {
          add({kind: 'tool', id, name: label, source: `dify-${wf.source}`})
        } else {
          add({kind: 'plugin', id, name: label, source: `dify-${wf.source}`})
        }
      } else if (d.type === 'http-request' && d.url) {
        add({kind: 'tool', id: String(d.url), name: `${d.title || 'HTTP 请求'} (${d.method || 'GET'} ${d.url})`, source: `dify-${wf.source}`})
      }
    }
  }

  // 3. 与平台仓库比对合规状态
  const [plugins, mcps] = await Promise.all([
    clients?.plugin ? safeJsonList(() => clients.plugin('/packages')) : Promise.resolve([]),
    clients?.mcp ? safeJsonList(() => clients.mcp('/mcps')) : Promise.resolve([]),
  ])

  const dependencies = []
  for (const item of raw.values()) {
    let name = item.name
    let approved = false
    let externalAllowed = false
    let status = '未审告警'
    let reason = ''

    if (item.kind === 'knowledge') {
      const resolvedName = await fetchDifyDatasetName(item.id)
      if (resolvedName) name = resolvedName
      approved = false
      externalAllowed = false
      status = '未审告警'
      reason = '应用绑定了知识库，请核验其是否已通过 KB-02 安全审查（或确认风险后放行）'
    } else if (item.kind === 'plugin') {
      const matched = plugins.find(p =>
        [p.resourceId, p.packageId, p.name, p.identifier].filter(Boolean).some(v => String(v) === item.id || String(v) === item.name),
      )
      if (matched && ['active', '已上架', 'approved'].includes(String(matched.status || '').toLowerCase())) {
        approved = true
        externalAllowed = matched.externalAllowed !== false
        status = externalAllowed ? '合规通过' : '未审告警'
        reason = externalAllowed ? '已在插件仓库通过 PLG-01 审核' : '插件已入库但禁止对外开放使用'
      } else if (matched) {
        approved = false
        externalAllowed = false
        status = '已禁用拦截'
        reason = `插件当前状态为 ${matched.status}，不可作为合规依赖`
      } else {
        reason = '未在平台插件仓库登记，尚未通过 PLG-01 代码安全审核'
      }
    } else if (item.kind === 'mcp') {
      const matched = mcps.find(m =>
        [m.resourceId, m.name, m.url].filter(Boolean).some(v => String(v) === item.id || String(v) === item.name),
      )
      if (matched && ['active', '已上架'].includes(String(matched.status || '').toLowerCase())) {
        approved = true
        externalAllowed = matched.externalAllowed !== false
        status = externalAllowed ? '合规通过' : '未审告警'
        reason = externalAllowed ? '已在 MCP 仓库通过 MCP-01 审核' : 'MCP 已登记但禁止对外开放使用'
      } else {
        reason = '未在平台 MCP 仓库登记或未处于生效状态，尚未通过 MCP-01 审核'
      }
    } else {
      reason = '自定义 HTTP/API 工具存在外部调用风险，尚未通过 TOL-01 审批'
    }

    dependencies.push({
      kind: item.kind,
      kindLabel: KIND_LABELS[item.kind] ?? item.kind,
      id: item.id,
      name,
      source: item.source,
      approved,
      externalAllowed,
      status,
      reason,
    })
  }

  const counts = {knowledge: 0, plugin: 0, mcp: 0, tool: 0}
  for (const d of dependencies) {
    if (Object.hasOwn(counts, d.kind)) counts[d.kind] += 1
  }
  const warnings = dependencies.filter(d => !d.approved || !d.externalAllowed).length
  return {
    dependencies,
    dependencySummary: {
      checkedAt: new Date().toISOString(),
      workflowInspected,
      total: dependencies.length,
      passed: dependencies.length - warnings,
      warnings,
      counts,
    },
  }
}

export function saveSyncedApp(openLedger, app) {
  const db = openLedger('synced-apps')
  const existing = db.get(app.resourceId)
  check(app.workspaceId, 409, 'MISSING_WORKSPACE', '同步应用缺少已核验工作区')
  const record = {
    resourceId: app.resourceId,
    name: app.name || existing?.name || app.resourceId,
    source: 'dify',
    workspaceId: app.workspaceId,
    mode: app.mode ?? existing?.mode ?? null,
    ownerAccount: app.ownerAccount || existing?.ownerAccount || '',
    revision: existing ? existing.revision + 1 : 1,
    syncedAt: new Date().toISOString(),
  }
  db.put(record.resourceId, record)
  return record
}

export function getGrantState(openLedger, catalogResourceId) {
  const db = openLedger('grants')
  const doc = db.get(catalogResourceId)
  if (!doc) return {revision: 0, items: []}
  return {revision: doc.revision ?? 0, items: Array.isArray(doc.items) ? doc.items : []}
}

export function addGrant(openLedger, catalogResourceId, principals) {
  const db = openLedger('grants')
  const prev = getGrantState(openLedger, catalogResourceId)
  const merged = [...new Set([...prev.items, ...principals.filter(p => typeof p === 'string' && p.trim())])].sort()
  const next = {catalogResourceId, revision: prev.revision + 1, items: merged, updatedAt: new Date().toISOString()}
  db.put(catalogResourceId, next)
  return next
}

export function revokeAllGrants(openLedger, catalogResourceId) {
  const db = openLedger('grants')
  const prev = getGrantState(openLedger, catalogResourceId)
  const next = {catalogResourceId, revision: prev.revision + 1, items: [], revokedCount: prev.items.length, updatedAt: new Date().toISOString()}
  db.put(catalogResourceId, next)
  return next
}

export function buildAgentImpact({resourceId, appId, workspaceId, openLedger}) {
  const capturedAt = new Date().toISOString()
  const grantState = openLedger ? getGrantState(openLedger, resourceId) : {revision: 0, items: []}
  const metaDoc = openLedger ? openLedger('impact-meta').get(resourceId) : null
  const keysItems = Array.isArray(metaDoc?.keys) ? [...new Set(metaDoc.keys)].sort() : []
  const keysRev = Number.isInteger(metaDoc?.keysRevision) ? metaDoc.keysRevision : 0
  const depItems = Array.isArray(metaDoc?.dependencies) ? metaDoc.dependencies : []
  const depRev = Number.isInteger(metaDoc?.dependenciesRevision) ? metaDoc.dependenciesRevision : 0

  return {
    resourceId,
    appId,
    workspaceId,
    snapshotId: `snap-impact-${randomUUID().slice(0, 10)}`,
    capturedAt,
    grants: {state: 'collected', count: grantState.items.length, revision: grantState.revision, items: grantState.items},
    keys: {state: 'collected', count: keysItems.length, revision: keysRev, items: keysItems},
    dependencies: {state: 'collected', count: depItems.length, revision: depRev, items: depItems},
    // 未接入真实调用日志时不伪造 0
    calls30d: {state: 'unavailable', count: null, from: null, to: null, reasonCode: 'CALL_STATS_UNCOLLECTED'},
  }
}

export async function readAgentApprovedInput(clients, command) {
  if (!clients?.management) return null
  let response
  try {
    response = await clients.management('/approved-inputs/' + encodeURIComponent(command.executionId))
  } catch (err) {
    if (err.code === 'REPOSITORY_UNCONFIGURED') return null
    throw err
  }
  const approved = await response.json()
  check(
    approved &&
      approved.decisionRef === command.payload?.decisionRef &&
      approved.ticketType === command.ticketType &&
      approved.action === command.action &&
      approved.resourceId === command.resourceId,
    409,
    'APPROVED_INPUT_MISMATCH',
    '获准输入与执行命令不一致',
  )
  return {
    fields: approved.fields ?? {},
    preconditions: Array.isArray(approved.preconditions) ? approved.preconditions : [],
  }
}
