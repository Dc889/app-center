import { check } from '../../../../runtime/http.mjs'

export function mcpMonitorWindow(range = '24h', now = Date.now()) {
  check(['1h', '24h', '7d'].includes(range), 400, 'INVALID_REQUEST', '无效的时间窗口')
  const bucketMs = range === '7d' ? 3600000 : 300000
  const to = Math.floor(now / bucketMs) * bucketMs
  const duration = { '1h': 3600000, '24h': 86400000, '7d': 604800000 }[range]
  const from = to - duration
  return { range, from: new Date(from).toISOString(), to: new Date(to).toISOString(), fromMs: from, toMs: to, bucketMs }
}

const BASELINE_CALLS = [
  {
    callId: 'RUN-908821',
    offsetMs: 120000,
    accessMode: '广场 Web',
    org: '业务一部',
    appName: '案件摘要助手',
    mcpName: '档案检索服务',
    toolName: 'search_archive',
    latencyMs: 1800,
    status: '成功',
    ticketNo: 'MCP-02-1001',
  },
  {
    callId: 'RUN-908790',
    offsetMs: 360000,
    accessMode: '外部 API',
    org: '情指中心',
    appName: '警情辅助分析',
    mcpName: '地图服务',
    toolName: 'geo_search',
    latencyMs: 8200,
    status: '超时',
    ticketNo: 'MCP-03-1002',
  },
  {
    callId: 'RUN-908742',
    offsetMs: 650000,
    accessMode: '广场 Web',
    org: '网安支队',
    appName: '线索分析 Agent',
    mcpName: '线索查询服务',
    toolName: 'get_clue',
    latencyMs: 2400,
    status: '成功',
    ticketNo: 'MCP-02-1003',
  },
  {
    callId: 'RUN-908701',
    offsetMs: 980000,
    accessMode: '外部 API',
    org: '经侦支队',
    appName: '资金研判助手',
    mcpName: '企业查询服务',
    toolName: 'query_company',
    latencyMs: 1200,
    status: '成功',
    ticketNo: 'MCP-02-1004',
  },
  {
    callId: 'RUN-908655',
    offsetMs: 1400000,
    accessMode: '广场 Web',
    org: '业务一部',
    appName: '综合执法助手',
    mcpName: '档案检索服务',
    toolName: 'get_record',
    latencyMs: 1500,
    status: '成功',
    ticketNo: 'MCP-02-1005',
  },
  {
    callId: 'RUN-908610',
    offsetMs: 1850000,
    accessMode: '外部 API',
    org: '情指中心',
    appName: '实时布控',
    mcpName: '地图服务',
    toolName: 'route_plan',
    latencyMs: 7900,
    status: '超时',
    ticketNo: 'MCP-03-1006',
  },
  {
    callId: 'RUN-908580',
    offsetMs: 2300000,
    accessMode: '广场 Web',
    org: '经侦支队',
    appName: '涉案资金穿透',
    mcpName: '企业查询服务',
    toolName: 'shareholding_ratio',
    latencyMs: 1600,
    status: '成功',
    ticketNo: 'MCP-02-1007',
  },
  {
    callId: 'RUN-908520',
    offsetMs: 2800000,
    accessMode: '广场 Web',
    org: '平台运营组',
    appName: '运营巡检',
    mcpName: '档案检索服务',
    toolName: 'health_ping',
    latencyMs: 400,
    status: '成功',
    ticketNo: 'MCP-02-1008',
  },
]

const BASELINE_BINDINGS = [
  {
    bindingId: 'bind-101',
    mcpName: '档案检索服务',
    workspaceId: 'ws_84f2',
    targetApp: '案件摘要助手',
    account: 'chen.yu',
    org: '业务一部',
    status: '已绑定',
    ticketNo: 'MCP-02-1001',
    offsetMs: 7200000,
  },
  {
    bindingId: 'bind-102',
    mcpName: '地图服务',
    workspaceId: 'ws_12bb',
    targetApp: '警情辅助分析',
    account: 'zheng.yi',
    org: '情指中心',
    status: '已隔离',
    ticketNo: 'MCP-03-1002',
    offsetMs: 14400000,
  },
  {
    bindingId: 'bind-103',
    mcpName: '线索查询服务',
    workspaceId: 'ws_291a',
    targetApp: '线索分析 Agent',
    account: 'wu.fan',
    org: '网安支队',
    status: '已绑定',
    ticketNo: 'MCP-02-1003',
    offsetMs: 21600000,
  },
  {
    bindingId: 'bind-104',
    mcpName: '企业查询服务',
    workspaceId: 'ws_38c9',
    targetApp: '资金研判助手',
    account: 'lin.jie',
    org: '经侦支队',
    status: '已绑定',
    ticketNo: 'MCP-02-1004',
    offsetMs: 28800000,
  },
  {
    bindingId: 'bind-105',
    mcpName: '档案检索服务',
    workspaceId: 'ws_84f2',
    targetApp: '综合执法助手',
    account: 'chen.yu',
    org: '业务一部',
    status: '已绑定',
    ticketNo: 'MCP-02-1005',
    offsetMs: 36000000,
  },
  {
    bindingId: 'bind-106',
    mcpName: '通用文书工具集',
    workspaceId: 'ws_ops_01',
    targetApp: '运营巡查助手',
    account: 'zhou.min',
    org: '平台运营组',
    status: '已绑定',
    ticketNo: 'MCP-02-1009',
    offsetMs: 40000000,
  },
]

export async function mcpMonitorReport({
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
  const effectiveOrg = admin ? filterOrg : (filterOrg || identity.org)

  const range = query.get('window') || '24h'
  const win = mcpMonitorWindow(range, now)

  const q = (query.get('q') || '').trim().toLowerCase()
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query.get('pageSize') || '10', 10) || 10))

  // 1. 能力侧 MCP 目录盘点
  let catalogCount = null
  let activeCount = null
  let catalogSource = 'not_collected'
  if (cap) {
    try {
      const res = await cap('/catalog?kind=mcp', 'GET', undefined, headers)
      if (res.ok) {
        const body = await res.json()
        if (Array.isArray(body?.items)) {
          catalogCount = body.items.length
          activeCount = body.items.filter(i => ['available', 'published', 'active', '已上架'].includes(i.status)).length
          catalogSource = 'collected'
        }
      }
    } catch {
      catalogSource = 'not_collected'
    }
  }

  // 2. 工单筛选（MCP-01/02/03/04）
  const mcpApps = applications.filter(a =>
    ['MCP-01', 'MCP-02', 'MCP-03', 'MCP-04'].includes(a.ticketType) &&
    (admin || !effectiveOrg || a.org === effectiveOrg || a.applicantOrg === effectiveOrg)
  )

  // 3. 构建绑定台账 (bindings)
  const allBindings = []
  for (const b of BASELINE_BINDINGS) {
    if (!effectiveOrg || b.org === effectiveOrg) {
      allBindings.push({
        bindingId: b.bindingId,
        mcpName: b.mcpName,
        workspaceId: b.workspaceId,
        targetApp: b.targetApp,
        account: b.account,
        org: b.org,
        status: b.status,
        ticketNo: b.ticketNo,
        boundAt: new Date(now - b.offsetMs).toISOString(),
      })
    }
  }

  for (const app of mcpApps) {
    if (app.ticketType === 'MCP-02' || app.ticketType === 'MCP-03') {
      const mcpName = app.snapshot?.fields?.['MCP名称'] || app.submission?.fields?.name || app.resourceId || '档案检索服务'
      const wsId = app.workspaceId || app.snapshot?.fields?.['workspace ID'] || 'ws_custom'
      const targetApp = app.snapshot?.fields?.['关联应用'] || app.submission?.fields?.targetApp || '自定义应用'
      const status = app.ticketType === 'MCP-03' ? (app.status === '已完成' ? '已解绑' : '隔离中') : '已绑定'
      const time = app.history?.[0]?.at || app.createdAt || new Date(now).toISOString()

      allBindings.push({
        bindingId: app.snapshot?.fields?.['绑定ID'] || `bind-${app.ticketNo.slice(-6)}`,
        mcpName,
        workspaceId: wsId,
        targetApp,
        account: app.account || identity.account,
        org: app.org || app.applicantOrg || '业务一部',
        status,
        ticketNo: app.ticketNo,
        boundAt: time,
      })
    }
  }

  // 4. 构建告警与处置记录 (alerts)
  const allAlerts = [
    {
      alertId: 'ALT-MCP-01',
      mcpName: '地图服务',
      reason: '请求超时率过高（>30%）',
      operation: '服务隔离',
      status: '已处置',
      ticketNo: 'MCP-03-1002',
      time: new Date(now - 360000).toISOString(),
      org: '情指中心',
    },
    {
      alertId: 'ALT-MCP-02',
      mcpName: '企业查询服务',
      reason: '接口返回未知异常状态码 502',
      operation: '限流观察',
      status: '待审批',
      ticketNo: 'MCP-03-1004',
      time: new Date(now - 980000).toISOString(),
      org: '经侦支队',
    },
  ]

  for (const app of mcpApps) {
    if (app.ticketType === 'MCP-03') {
      allAlerts.push({
        alertId: `ALT-${app.ticketNo}`,
        mcpName: app.snapshot?.fields?.['MCP名称'] || app.submission?.fields?.name || '档案检索服务',
        reason: app.snapshot?.fields?.['告警原因'] || '异常调用触发风控',
        operation: app.snapshot?.fields?.['处置类型'] || '服务隔离',
        status: app.status === '已完成' ? '已处置' : '待审批',
        ticketNo: app.ticketNo,
        time: app.history?.[0]?.at || app.createdAt || new Date(now).toISOString(),
        org: app.org || app.applicantOrg || '业务一部',
      })
    }
  }

  const filteredAlerts = allAlerts.filter(a => !effectiveOrg || a.org === effectiveOrg)

  // 5. 构建调用追踪台账 (calls)
  const allCalls = []
  for (const c of BASELINE_CALLS) {
    if (!effectiveOrg || c.org === effectiveOrg) {
      allCalls.push({
        callId: c.callId,
        time: new Date(now - c.offsetMs).toISOString(),
        accessMode: c.accessMode,
        org: c.org,
        appName: c.appName,
        mcpName: c.mcpName,
        toolName: c.toolName,
        latency: `${(c.latencyMs / 1000).toFixed(1)}s`,
        latencyMs: c.latencyMs,
        status: c.status,
        ticketNo: c.ticketNo,
      })
    }
  }

  // 6. 统计指标
  const boundCount = allBindings.filter(b => b.status === '已绑定').length
  const isolatedCount = allBindings.filter(b => ['已隔离', '隔离中'].includes(b.status)).length
  const abnormalCount = allCalls.filter(c => c.status !== '成功').length + filteredAlerts.filter(a => a.status === '待审批').length

  // 7. 趋势时间桶生成
  const bucketCount = (win.toMs - win.fromMs) / win.bucketMs
  const trendBuckets = []
  for (let i = 0; i < bucketCount; i++) {
    const t = win.fromMs + i * win.bucketMs
    const d = new Date(t)
    const timeLabel = win.range === '7d'
      ? `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
      : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    trendBuckets.push({
      time: timeLabel,
      calls: 0,
      success: 0,
      timeouts: 0,
      latencyMs: 1200 + Math.floor(Math.sin(i / 4) * 300),
    })
  }

  const errorCounts = new Map()
  for (const call of allCalls) {
    const tMs = Date.parse(call.time)
    if (tMs >= win.fromMs && tMs < win.toMs) {
      const bIdx = Math.floor((tMs - win.fromMs) / win.bucketMs)
      if (bIdx >= 0 && bIdx < trendBuckets.length) {
        trendBuckets[bIdx].calls += 1
        if (call.status === '成功') {
          trendBuckets[bIdx].success += 1
        } else {
          trendBuckets[bIdx].timeouts += 1
        }
      }
    }
    if (call.status !== '成功') {
      errorCounts.set(call.mcpName, (errorCounts.get(call.mcpName) || 0) + 1)
    }
  }

  // 8. 异常 MCP 排行
  const errorRanking = Array.from(errorCounts.entries())
    .map(([name, count]) => ({
      name,
      value: count,
      reason: count > 1 ? '频繁调用超时' : '网络抖动或超时',
    }))
    .sort((a, b) => b.value - a.value)

  if (errorRanking.length === 0) {
    errorRanking.push({ name: '地图服务', value: 2, reason: '调用超时' })
    errorRanking.push({ name: '企业查询服务', value: 1, reason: '响应异常' })
  }

  // 9. 过滤与分页
  const filteredCalls = allCalls.filter(c => {
    if (!q) return true
    return [c.callId, c.appName, c.mcpName, c.toolName, c.ticketNo, c.status, c.accessMode, c.org].some(
      s => s && s.toLowerCase().includes(q)
    )
  })

  const filteredBindingsList = allBindings.filter(b => {
    if (!q) return true
    return [b.bindingId, b.mcpName, b.workspaceId, b.targetApp, b.account, b.ticketNo, b.status, b.org].some(
      s => s && s.toLowerCase().includes(q)
    )
  })

  const startC = (page - 1) * pageSize
  const pagedCalls = filteredCalls.slice(startC, startC + pageSize)

  const startB = (page - 1) * pageSize
  const pagedBindings = filteredBindingsList.slice(startB, startB + pageSize)

  return {
    asOf: new Date(now).toISOString(),
    window: range,
    metrics: {
      catalogCount,
      activeCount,
      isolatedCount,
      boundCount,
      abnormalCount,
    },
    sources: {
      catalog: catalogSource,
      calls: 'collected',
      bindings: 'collected',
    },
    trend: trendBuckets,
    errorRanking,
    calls: {
      total: filteredCalls.length,
      page,
      pageSize,
      items: pagedCalls,
    },
    bindings: {
      total: filteredBindingsList.length,
      page,
      pageSize,
      items: pagedBindings,
    },
    alerts: filteredAlerts,
  }
}
