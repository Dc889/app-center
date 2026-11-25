import {createHash} from 'node:crypto'

const APPROVED_STATES = new Set(['succeeded', 'approved', 'completed', 'active'])

function isApprovedRecord(row) {
  const execStatus = String(row?.execution?.status ?? row?.state?.status ?? '').toLowerCase()
  const reviewStatus = String(row?.status ?? '').toLowerCase()
  if (APPROVED_STATES.has(execStatus)) return true
  if (['已通过', '已办结', '已完成', '已批准', '生效中'].includes(row?.status)) return true
  if (APPROVED_STATES.has(reviewStatus)) return true
  return false
}

function normalizeStr(v) {
  return String(v ?? '').trim().toLowerCase()
}

function stableFindingId(ruleCode, workspaceId, resourceId) {
  const digest = createHash('sha256').update(`${ruleCode}|${workspaceId || ''}|${resourceId || ''}`).digest('hex').slice(0, 12)
  return `REC-${ruleCode}-${digest}`
}

export function reconcileDifyCompliance({inventory, tickets = [], applications = [], events = [], now = Date.now()} = {}) {
  const allApproved = [...tickets, ...applications].filter(isApprovedRecord)

  // Build approved lookup sets
  const approvedPlugins = new Set()
  const approvedPluginNames = new Set()
  const approvedMcpUrls = new Set()
  const approvedMcpIds = new Set()
  const approvedKeyIds = new Set()
  const approvedKeyPreviews = new Set()
  const approvedDatasetIds = new Set()
  const approvedAppsByResourceId = new Map()

  for (const row of allApproved) {
    const cmd = row.command ?? {}
    const payload = cmd.payload ?? row.payload ?? row.form ?? {}
    const result = row.execution?.result ?? row.state?.result ?? {}
    const action = String(cmd.action ?? row.action ?? '').toLowerCase()
    const ticketType = String(cmd.ticketType ?? row.ticketType ?? row.type ?? '').toUpperCase()
    const resourceId = String(cmd.resourceId ?? row.resourceId ?? payload.resourceId ?? '').trim()
    const workspaceId = String(payload.workspaceId ?? payload.tenantId ?? result.workspaceId ?? '').trim()

    if (ticketType.startsWith('PLG-') || action.includes('plugin')) {
      const pid = String(payload.pluginId ?? payload.packageId ?? resourceId ?? '').trim()
      if (pid) {
        approvedPluginNames.add(normalizeStr(pid))
        if (workspaceId) approvedPlugins.add(`${normalizeStr(workspaceId)}::${normalizeStr(pid)}`)
      }
    }
    if (ticketType.startsWith('MCP-') || action.includes('mcp')) {
      const url = normalizeStr(payload.serverUrl ?? payload.url ?? result.serverUrl)
      const sid = normalizeStr(payload.serverIdentifier ?? payload.providerId ?? result.providerId ?? resourceId)
      if (url) approvedMcpUrls.add(url)
      if (sid) approvedMcpIds.add(sid)
    }
    if (ticketType.startsWith('KEY-') || action.includes('key')) {
      const kid = normalizeStr(result.keyId ?? result.apiKeyId ?? payload.keyId ?? resourceId)
      const preview = normalizeStr(result.tokenPreview ?? result.maskedKey)
      if (kid) approvedKeyIds.add(kid)
      if (preview) approvedKeyPreviews.add(preview)
    }
    if (ticketType === 'KB-02' || action === 'publish_dataset') {
      const did = String(payload.datasetId ?? resourceId ?? '').trim()
      if (did) approvedDatasetIds.add(normalizeStr(did))
    }
    if (ticketType === 'APP-01' || ticketType === 'APP-03' || action === 'publish_app' || action === 'republish_app') {
      const aid = String(payload.appId ?? resourceId ?? '').trim()
      if (aid) {
        const atStr = row.execution?.updatedAt ?? row.state?.updatedAt ?? row.updatedAt ?? row.createdAt ?? null
        const atMs = atStr ? Date.parse(atStr) : NaN
        const prev = approvedAppsByResourceId.get(normalizeStr(aid))
        if (!prev || (Number.isFinite(atMs) && atMs > prev.approvedAtMs)) {
          approvedAppsByResourceId.set(normalizeStr(aid), {
            ticketNo: row.ticketNo ?? '',
            approvedAtMs: Number.isFinite(atMs) ? atMs : 0,
            approvedAt: atStr,
          })
        }
      }
    }
  }

  // Index existing EVT-01 events to link already-ticketed findings
  const eventByFindingId = new Map()
  const eventByRuleResource = new Map()
  for (const ev of events) {
    if (!ev || !ev.ticketNo) continue
    if (ev.reconcileFindingId) {
      const prev = eventByFindingId.get(ev.reconcileFindingId)
      if (!prev || prev.status === '已关闭') eventByFindingId.set(ev.reconcileFindingId, ev)
    }
    if (ev.ruleCode && ev.resourceId) {
      const key = `${ev.ruleCode}::${ev.resourceId}`
      const prev = eventByRuleResource.get(key)
      if (!prev || prev.status === '已关闭') eventByRuleResource.set(key, ev)
    }
  }

  const findings = []
  const pushFinding = (item) => {
    const findingId = stableFindingId(item.ruleCode, item.workspaceId, item.resourceId)
    const linked = eventByFindingId.get(findingId) ?? eventByRuleResource.get(`${item.ruleCode}::${item.resourceId}`) ?? null
    findings.push({
      ...item,
      findingId,
      linkedEventTicketNo: linked?.ticketNo ?? null,
      linkedEventStatus: linked?.status ?? null,
      remediationStatus: linked ? (linked.status === '已关闭' ? '已闭环' : '已转安全事件') : '待处置',
    })
  }

  const inv = inventory ?? {syncedAt: null, apps: [], datasets: [], mcpProviders: [], plugins: [], apiKeys: []}

  // 1. Unapproved / shadow plugins installed directly in Dify
  for (const plg of inv.plugins ?? []) {
    const pid = String(plg.pluginId || plg.pluginName || '').trim()
    const ws = String(plg.workspaceId || '').trim()
    if (!pid) continue
    const matched = approvedPlugins.has(`${normalizeStr(ws)}::${normalizeStr(pid)}`) || approvedPluginNames.has(normalizeStr(pid))
    if (matched) continue
    pushFinding({
      category: 'plugin',
      categoryLabel: '未备案插件',
      objectType: '插件',
      ruleCode: 'SHADOW_PLUGIN',
      severity: '严重',
      resourceId: plg.installationId || `${ws}:${pid}`,
      resourceName: `${pid} (${plg.version || '1.0.0'})`,
      workspaceId: ws,
      workspaceName: plg.workspaceName || ws.slice(0, 8),
      ownerAccount: plg.ownerAccount || '',
      ownerName: plg.ownerName || 'Dify 工作区',
      org: plg.org || '待归属',
      detail: `在 Dify 工作区「${plg.workspaceName || ws.slice(0, 8)}」检测到已安装插件 ${pid}（版本 ${plg.version || '未知'}，来源 ${plg.source || 'package'}），但在应用中心无对应已批准的 PLG-01/PLG-03 上架或安装审批单。`,
      detectedAt: plg.installedAt || inv.syncedAt || new Date(now).toISOString(),
    })
  }

  // 2. Unapproved / shadow MCP providers bound directly in Dify
  for (const mcp of inv.mcpProviders ?? []) {
    const url = normalizeStr(mcp.serverUrl)
    const sid = normalizeStr(mcp.serverIdentifier || mcp.providerId)
    const matched = (url && approvedMcpUrls.has(url)) || (sid && approvedMcpIds.has(sid))
    if (matched) continue
    const ws = String(mcp.workspaceId || '').trim()
    pushFinding({
      category: 'mcp',
      categoryLabel: '未备案 MCP',
      objectType: 'MCP',
      ruleCode: 'SHADOW_MCP',
      severity: '严重',
      resourceId: mcp.providerId || mcp.serverIdentifier || mcp.name,
      resourceName: mcp.name || mcp.serverIdentifier || mcp.providerId,
      workspaceId: ws,
      workspaceName: mcp.workspaceName || ws.slice(0, 8),
      ownerAccount: mcp.ownerAccount || '',
      ownerName: mcp.ownerName || 'Dify 工作区',
      org: mcp.org || '待归属',
      detail: `在 Dify 工作区「${mcp.workspaceName || ws.slice(0, 8)}」检测到已绑定外部 MCP 服务「${mcp.name}」（标识：${mcp.serverIdentifier || '-'}），但在应用中心无对应已批准的 MCP-01/MCP-02 登记或绑定审批单。`,
      detectedAt: mcp.createdAt || inv.syncedAt || new Date(now).toISOString(),
    })
  }

  // 3. Unapproved / shadow App API Keys created directly in Dify
  for (const key of inv.apiKeys ?? []) {
    const kid = normalizeStr(key.keyId)
    const preview = normalizeStr(key.tokenPreview)
    const matched = (kid && approvedKeyIds.has(kid)) || (preview && approvedKeyPreviews.has(preview))
    if (matched) continue
    const ws = String(key.workspaceId || '').trim()
    pushFinding({
      category: 'key',
      categoryLabel: '未备案密钥',
      objectType: '智能体',
      ruleCode: 'SHADOW_KEY',
      severity: '严重',
      resourceId: key.keyId,
      resourceName: `${key.appName || '应用'} (${key.tokenPreview || key.keyId.slice(0, 8)})`,
      workspaceId: ws,
      workspaceName: key.workspaceName || ws.slice(0, 8),
      ownerAccount: key.ownerAccount || '',
      ownerName: key.ownerName || 'Dify 工作区',
      org: key.org || '待归属',
      detail: `在 Dify 工作区「${key.workspaceName || ws.slice(0, 8)}」检测到应用「${key.appName || key.appId}」存在访问密钥 ${key.tokenPreview || ''}，但在应用中心无对应已批准的 KEY-01/KEY-02 密钥申领记录。`,
      detectedAt: key.createdAt || inv.syncedAt || new Date(now).toISOString(),
    })
  }

  // 4. Shared datasets in Dify without KB-02 approval
  for (const ds of inv.datasets ?? []) {
    const perm = String(ds.permission || 'only_me').toLowerCase()
    if (perm === 'only_me') continue
    if (approvedDatasetIds.has(normalizeStr(ds.resourceId))) continue
    const ws = String(ds.workspaceId || '').trim()
    pushFinding({
      category: 'dataset',
      categoryLabel: '未备案共享知识库',
      objectType: '知识库',
      ruleCode: 'SHADOW_DATASET_SHARE',
      severity: '一般',
      resourceId: ds.resourceId,
      resourceName: ds.name || ds.resourceId,
      workspaceId: ws,
      workspaceName: ds.workspaceName || ws.slice(0, 8),
      ownerAccount: ds.ownerAccount || '',
      ownerName: ds.ownerName || 'Dify 工作区',
      org: ds.org || '待归属',
      detail: `知识库「${ds.name}」（文档数 ${ds.documentCount ?? 0}）在 Dify 中的权限已开放为 ${ds.permission}，但在应用中心无对应已批准的 KB-02 共享上架审批单。`,
      detectedAt: ds.createdAt || inv.syncedAt || new Date(now).toISOString(),
    })
  }

  // 5. Published apps modified in Dify after approval without APP-03 republish
  for (const app of inv.apps ?? []) {
    const approved = approvedAppsByResourceId.get(normalizeStr(app.resourceId))
    if (!approved || !approved.approvedAtMs || !app.updatedAt) continue
    const appUpdatedMs = Date.parse(app.updatedAt)
    if (!Number.isFinite(appUpdatedMs) || appUpdatedMs <= approved.approvedAtMs + 60_000) continue
    const ws = String(app.workspaceId || '').trim()
    pushFinding({
      category: 'app',
      categoryLabel: '已发布应用私自变更',
      objectType: '智能体',
      ruleCode: 'APP_UNAPPROVED_CHANGE',
      severity: '一般',
      resourceId: app.resourceId,
      resourceName: app.name || app.resourceId,
      workspaceId: ws,
      workspaceName: app.workspaceName || ws.slice(0, 8),
      ownerAccount: app.ownerAccount || '',
      ownerName: app.ownerName || 'Dify 工作区',
      org: app.org || '待归属',
      detail: `已上架智能体「${app.name}」（审批单 ${approved.ticketNo}）在 Dify 中的最近修改时间（${app.updatedAt}）晚于审批通过时间（${approved.approvedAt}），疑似绕过 APP-03 变更复审直接修改。`,
      detectedAt: app.updatedAt,
    })
  }

  const byCategory = {
    plugin: findings.filter(f => f.category === 'plugin').length,
    mcp: findings.filter(f => f.category === 'mcp').length,
    key: findings.filter(f => f.category === 'key').length,
    dataset: findings.filter(f => f.category === 'dataset').length,
    app: findings.filter(f => f.category === 'app').length,
  }
  const pending = findings.filter(f => f.remediationStatus === '待处置').length
  const ticketed = findings.filter(f => f.remediationStatus === '已转安全事件').length
  const closed = findings.filter(f => f.remediationStatus === '已闭环').length

  return {
    capturedAt: new Date(now).toISOString(),
    syncedAt: inv.syncedAt || null,
    scannedCounts: {
      apps: (inv.apps ?? []).length,
      datasets: (inv.datasets ?? []).length,
      plugins: (inv.plugins ?? []).length,
      mcpProviders: (inv.mcpProviders ?? []).length,
      apiKeys: (inv.apiKeys ?? []).length,
    },
    summary: {
      total: findings.length,
      pending,
      ticketed,
      closed,
      byCategory,
    },
    items: findings,
  }
}
