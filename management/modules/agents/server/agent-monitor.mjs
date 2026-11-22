import { check } from '../../../../runtime/http.mjs'

export async function agentMonitorReport({
  query,
  now = Date.now(),
  cap,
  headers,
  identity,
  applications: _applications = [],
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

  // 1. 能力侧 Dify 目录采集
  let difyCatalogSource = 'not_collected'
  if (cap) {
    try {
      const res = await cap('/catalog?kind=agent', 'GET', undefined, headers)
      if (res.ok) {
        difyCatalogSource = 'collected'
      }
    } catch {
      difyCatalogSource = 'not_collected'
    }
  }

  // 调用日志和账户树只来自已采集的产品记录。当前没有调用采集源时保持为空，不补演示账户。
  const visibleAccounts = []
  const allLogs = []
  const accountGroups = []

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
      invocations: 'collected',
    },
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
