import { check } from '../../../../runtime/http.mjs'

export async function agentMonitorReport({
  query,
  now = Date.now(),
  cap,
  headers,
  identity,
  applications = [],
}) {
  const admin = identity.roles.includes('admin')
  const ops = identity.roles.includes('operator')
  check(admin || ops, 403, 'ACCESS_DENIED')

  const filterOrg = query.get('org') || null
  if (!admin && filterOrg && filterOrg !== identity.org) {
    throw new (await import('../../../../runtime/http.mjs')).ApiError(403, 'ACCESS_DENIED', '无权查询其他组织的数据')
  }
  const filterAccount = query.get('account') || '全部账户'
  const filterAppName = query.get('appName') || '全部应用'
  const filterIp = query.get('ip') || '全部 IP'
  const filterModel = query.get('model') || '全部模型'
  const filterKnowledge = query.get('knowledge') || '全部知识库'
  const filterMcp = query.get('mcp') || '全部 MCP'
  const filterPlugin = query.get('plugin') || '全部插件'
  const q = (query.get('q') || '').trim().toLowerCase()
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query.get('pageSize') || '20', 10) || 20))

  // 1. 能力侧 Dify 全量应用与仓库目录实时采集
  let difyCatalogSource = 'not_collected'
  const difyApps = []
  const warehouseIds = new Set()

  if (cap) {
    try {
      const catRes = await cap('/catalog?kind=agent', 'GET', undefined, headers)
      if (catRes.ok) {
        difyCatalogSource = 'collected'
        const catData = await catRes.json().catch(() => ({}))
        for (const item of Array.isArray(catData.items) ? catData.items : []) {
          if (item?.resourceId) warehouseIds.add(item.resourceId)
          if (item?.data?.appId) warehouseIds.add(item.data.appId)
        }
      }
    } catch {
      difyCatalogSource = 'not_collected'
    }

    try {
      let cursor = ''
      for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
        const qs = new URLSearchParams({ kind: 'dify_app', limit: '50' })
        if (cursor) qs.set('cursor', cursor)
        const res = await cap(`/resources?${qs.toString()}`, 'GET', undefined, headers)
        if (!res.ok) break
        difyCatalogSource = 'collected'
        const body = await res.json().catch(() => ({}))
        const items = Array.isArray(body.items) ? body.items : []
        difyApps.push(...items)
        if (!body.nextCursor || body.nextCursor === cursor) break
        cursor = body.nextCursor
      }
    } catch {
      // Keep partial or empty list when Dify upstream is unreachable
    }
  }

  // 2. 按开发账户/工作区聚合真实 Dify 应用树
  const groupMap = new Map()
  for (const app of difyApps) {
    if (!app?.resourceId) continue
    const ownerAccount = (typeof app.ownerAccount === 'string' && app.ownerAccount.trim())
      || (typeof app.data?.ownerAccount === 'string' && app.data.ownerAccount.trim())
      || (app.workspaceId ? `workspace:${app.workspaceId.slice(0, 8)}` : 'dify-workspace')
    const ownerName = (typeof app.ownerName === 'string' && app.ownerName.trim())
      || (typeof app.data?.ownerName === 'string' && app.data.ownerName.trim())
      || 'Dify 工作区'
    const ownerOrg = (typeof app.org === 'string' && app.org.trim())
      || (typeof app.data?.org === 'string' && app.data.org.trim())
      || identity.org
    if (!admin && ownerOrg !== identity.org) continue
    if (filterOrg && ownerOrg !== filterOrg) continue
    if (!groupMap.has(ownerAccount)) {
      groupMap.set(ownerAccount, {
        account: ownerAccount,
        name: ownerName,
        org: ownerOrg,
        useCount: 0,
        apps: [],
      })
    }
    groupMap.get(ownerAccount).apps.push({
      name: app.name || app.resourceId,
      appId: app.resourceId,
      appMode: app.data?.mode || app.mode || 'chat',
      inWarehouse: warehouseIds.has(app.resourceId),
      useCount: 0,
      description: typeof app.data?.description === 'string' ? app.data.description : null,
      versions: Array.isArray(app.data?.versions) ? app.data.versions.filter(row => row && typeof row.version === 'string') : [],
    })
  }

  const accountGroups = Array.from(groupMap.values())
  const visibleAccounts = accountGroups.map(g => g.account)
  let ragflowAccountCount = null
  if (cap) {
    try {
      const response = await cap('/resources?kind=ragflow_account&limit=100', 'GET', undefined, headers)
      if (response.ok) {
        const body = await response.json().catch(() => ({}))
        if (Array.isArray(body.items)) ragflowAccountCount = new Set(body.items.map(item => item.resourceId || item.account).filter(Boolean)).size
      }
    } catch { ragflowAccountCount = null }
  }
  const invocationFeed = await readInvocations(cap, headers)
  const allLogs = invocationFeed.items
  for (const profile of invocationFeed.profiles ?? []) {
    for (const group of accountGroups) {
      const app = group.apps.find(item => item.appId === profile.appId)
      if (!app) continue
      if (typeof profile.description === 'string') app.description = profile.description
      if (Array.isArray(profile.versions)) app.versions = profile.versions
    }
  }

  // 指标卡计算
  const totalAppsList = accountGroups.flatMap(g => g.apps)
  const accountCount = visibleAccounts.length
  const totalAppCount = totalAppsList.length
  const outsideAppCount = totalAppsList.filter(a => !a.inWarehouse).length
  const callCount = allLogs.length
  const failedCallCount = allLogs.filter(l => l.result === '失败').length

  // 5. 选项集提取
  const ipOptions = Array.from(new Set(allLogs.map(l => l.sourceIp))).sort()
  const modelOptions = Array.from(new Set(allLogs.flatMap(l => l.modelLabels))).sort()
  const knowledgeOptions = Array.from(new Set(allLogs.flatMap(l => l.knowledgeLabels))).sort()
  const mcpOptions = Array.from(new Set(allLogs.flatMap(l => l.mcpLabels))).sort()
  const pluginOptions = Array.from(new Set(allLogs.flatMap(l => l.pluginLabels))).sort()

  // 6. 过滤日志
  const filteredLogs = allLogs.filter(log => {
    if (filterAccount !== '全部账户' && log.ownerAccount !== filterAccount) return false
    if (filterAppName !== '全部应用' && log.appName !== filterAppName) return false
    if (filterIp !== '全部 IP' && log.sourceIp !== filterIp) return false
    if (filterModel !== '全部模型' && !log.modelLabels.includes(filterModel)) return false
    if (filterKnowledge !== '全部知识库' && !log.knowledgeLabels.includes(filterKnowledge)) return false
    if (filterMcp !== '全部 MCP' && !log.mcpLabels.includes(filterMcp)) return false
    if (filterPlugin !== '全部插件' && !log.pluginLabels.includes(filterPlugin)) return false
    if (q) {
      const blob = [
        log.ownerName,
        log.ownerAccount,
        log.appName,
        log.sourceIp,
        log.caller,
        ...log.modelLabels,
        ...log.knowledgeLabels,
        ...log.mcpLabels,
        ...log.pluginLabels,
      ].join(' ').toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })

  // 7. 分页
  const start = (page - 1) * pageSize
  const pagedLogs = filteredLogs.slice(start, start + pageSize)

  return {
    asOf: new Date(now).toISOString(),
    window: query.get('window') || '24h',
    metrics: {
      accountCount,
      totalAppCount,
      outsideAppCount,
      callCount,
      failedCallCount,
    },
    sources: {
      difyCatalog: difyCatalogSource,
      invocations: invocationFeed.source,
      tokens: invocationFeed.items.some(item => typeof item.tokens === 'number') ? 'collected' : 'not_collected',
    },
    overview: {
      difyAccountCount: difyCatalogSource === 'collected' ? accountCount : null,
      ragflowAccountCount,
      difyAppCount: difyCatalogSource === 'collected' ? totalAppCount : null,
      warehouseAppCount: warehouseApplicationCount(applications, warehouseIds),
    },
    analysis: buildAnalysis({
      apps: totalAppsList,
      logs: allLogs,
      invocations: invocationFeed.source,
      now,
      usageApp: query.get('usageApp') || '',
      usageFrom: query.get('usageFrom') || '',
      usageTo: query.get('usageTo') || '',
    }),
    accountGroups,
    filterOptions: {
      ipOptions,
      modelOptions,
      knowledgeOptions,
      mcpOptions,
      pluginOptions,
    },
    logs: {
      total: filteredLogs.length,
      page,
      pageSize,
      items: pagedLogs,
    },
  }
}

const runBuckets = [
  { label: '10万及以上', test: count => count >= 100000 },
  { label: '5万～10万', test: count => count >= 50000 && count < 100000 },
  { label: '1万～5万', test: count => count >= 10000 && count < 50000 },
  { label: '小于1万', test: count => count < 10000 },
]
const tokenBuckets = [
  { label: '100万及以上', test: count => count >= 1000000 },
  { label: '10万～100万', test: count => count >= 100000 && count < 1000000 },
  { label: '1万～10万', test: count => count >= 10000 && count < 100000 },
  { label: '小于1万', test: count => count < 10000 },
]

function warehouseApplicationCount(applications, warehouseIds) {
  const ids = new Set(warehouseIds)
  const ordered = [...applications].sort((a, b) => Date.parse(a.createdAt ?? 0) - Date.parse(b.createdAt ?? 0))
  for (const app of ordered) {
    if (app.status !== '已完成') continue
    const id = app.submission?.resourceId || app.resourceId
    if (!id) continue
    if (app.ticketType === 'AG-02' || app.ticketType === 'AG-04') ids.add(id)
    if (app.ticketType === 'AG-05') ids.delete(id)
  }
  return ids.size
}

async function readInvocations(cap, headers) {
  if (!cap) return { source: 'not_collected', items: [], profiles: [] }
  try {
    const response = await cap('/agent-invocations', 'GET', undefined, headers)
    if (!response?.ok) return { source: 'not_collected', items: [], profiles: [] }
    const body = await response.json()
    if (body?.availability !== 'collected' || !Array.isArray(body?.items)) return { source: 'not_collected', items: [], profiles: [] }
    return { source: 'collected', items: body.items.flatMap(normalizeInvocation), profiles: Array.isArray(body.profiles) ? body.profiles : [] }
  } catch {
    return { source: 'not_collected', items: [], profiles: [] }
  }
}

function normalizeInvocation(item, index) {
  const appId = typeof item?.appId === 'string' ? item.appId : ''
  const appName = typeof item?.appName === 'string' ? item.appName : appId
  if (!appId && !appName) return []
  const model = typeof item?.model === 'string' ? item.model : ''
  return [{
    seq: Number.isInteger(item.seq) ? item.seq : index + 1,
    time: typeof item?.time === 'string' ? item.time : '',
    ownerAccount: item.ownerAccount || '',
    ownerName: item.ownerName || '',
    ownerOrg: item.ownerOrg || '',
    appName,
    appId,
    appMode: item.appMode || '',
    sourceIp: item.sourceIp || '',
    caller: item.caller || '',
    models: model ? [model] : [],
    modelLabels: model ? [model] : [],
    knowledgeBases: [],
    knowledgeLabels: [],
    mcpCalls: [],
    mcpLabels: [],
    pluginCalls: [],
    pluginLabels: [],
    duration: item.duration || '未采集',
    httpStatus: item.httpStatus || '未采集',
    result: item.result === '失败' ? '失败' : '成功',
    errorCode: item.errorCode || '',
    tokens: typeof item.tokens === 'number' && item.tokens >= 0 ? item.tokens : null,
  }]
}

function shanghaiParts(time) {
  const parsed = Date.parse(time)
  if (!Number.isFinite(parsed)) return null
  const shifted = new Date(parsed + 8 * 3600000)
  return { parsed, hour: shifted.toISOString().slice(0, 13), day: shifted.toISOString().slice(0, 10), month: shifted.toISOString().slice(0, 7) }
}

function series(logs, key, buckets) {
  const counts = new Map(buckets.map(bucket => [bucket, 0]))
  for (const log of logs) {
    const parts = shanghaiParts(log.time)
    if (parts && counts.has(parts[key])) counts.set(parts[key], counts.get(parts[key]) + 1)
  }
  return buckets.map(bucket => ({ label: bucket, count: counts.get(bucket) }))
}

function buildAnalysis({ apps, logs, invocations, now, usageApp, usageFrom, usageTo }) {
  const collected = invocations === 'collected'
  const tokensCollected = collected && logs.some(log => log.tokens !== null)
  const callsByApp = new Map()
  for (const log of logs) {
    const key = log.appId || log.appName
    if (!callsByApp.has(key)) callsByApp.set(key, { appId: log.appId, appName: log.appName, calls: 0, tokens: 0, tokenKnown: false, models: new Map() })
    const row = callsByApp.get(key)
    row.calls += 1
    const model = log.modelLabels[0] || '未标明模型'
    const previous = row.models.get(model) ?? { calls: 0, tokens: 0 }
    row.models.set(model, { calls: previous.calls + 1, tokens: previous.tokens + (log.tokens ?? 0) })
    if (log.tokens !== null) { row.tokens += log.tokens; row.tokenKnown = true }
  }
  const runDistribution = collected ? runBuckets.map(bucket => ({
    label: bucket.label,
    count: [...callsByApp.values()].filter(row => bucket.test(row.calls)).length + apps.filter(app => !callsByApp.has(app.appId) && bucket.test(0)).length,
  })) : null
  const tokenDistribution = tokensCollected ? tokenBuckets.map(bucket => ({
    label: bucket.label,
    count: [...callsByApp.values()].filter(row => row.tokenKnown && bucket.test(row.tokens)).length,
  })) : null
  const ranking = [...callsByApp.values()].map(row => ({
    appId: row.appId,
    appName: row.appName,
    totalTokens: row.tokenKnown ? row.tokens : null,
    totalCalls: row.calls,
    models: [...row.models.entries()].map(([model, value]) => ({ model, calls: value.calls, tokens: value.tokens })),
  }))
  const hourLabels = Array.from({ length: 24 }, (_, index) => shanghaiParts(new Date(now - (23 - index) * 3600000).toISOString()).hour)
  const dayLabels = Array.from({ length: 30 }, (_, index) => shanghaiParts(new Date(now - (29 - index) * 86400000).toISOString()).day)
  const monthLabels = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now)
    date.setUTCMonth(date.getUTCMonth() - (11 - index))
    return shanghaiParts(date.toISOString()).month
  })
  const from = Date.parse(usageFrom)
  const to = Date.parse(usageTo)
  const usageLogs = logs.filter(log => {
    if (usageApp && log.appId !== usageApp && log.appName !== usageApp) return false
    const time = Date.parse(log.time)
    if (Number.isFinite(from) && (!Number.isFinite(time) || time < from)) return false
    if (Number.isFinite(to) && (!Number.isFinite(time) || time > to)) return false
    return true
  })
  const selected = apps.find(app => app.appId === usageApp || app.name === usageApp)
  const ipMap = new Map()
  for (const log of usageLogs) if (log.sourceIp) ipMap.set(log.sourceIp, (ipMap.get(log.sourceIp) ?? 0) + 1)
  return {
    runDistribution,
    callSeries: collected ? { hour: series(logs, 'hour', hourLabels), day: series(logs, 'day', dayLabels), month: series(logs, 'month', monthLabels) } : null,
    tokenDistribution,
    tokenRanking: tokensCollected ? ranking : [],
    modelCallRanking: collected ? ranking : [],
    usage: usageApp ? {
      appId: selected?.appId || usageApp,
      appName: selected?.name || usageApp,
      description: selected?.description ?? null,
      iterationCount: Array.isArray(selected?.versions) ? selected.versions.length : null,
      versions: selected?.versions ?? [],
      ipDistribution: collected ? [...ipMap.entries()].map(([ip, count]) => ({ ip, count })).sort((a, b) => b.count - a.count) : null,
    } : null,
  }
}
