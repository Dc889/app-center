import { check } from '../../../../runtime/http.mjs'

export function mcpMonitorWindow(range = '24h', now = Date.now()) {
  check(['1h', '24h', '7d'].includes(range), 400, 'INVALID_REQUEST', '无效的时间窗口')
  const bucketMs = range === '7d' ? 3600000 : 300000
  const to = Math.floor(now / bucketMs) * bucketMs
  const duration = { '1h': 3600000, '24h': 86400000, '7d': 604800000 }[range]
  const from = to - duration
  return { range, from: new Date(from).toISOString(), to: new Date(to).toISOString(), fromMs: from, toMs: to, bucketMs }
}

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

  const allBindings = []
  for (const app of mcpApps) {
    if (app.ticketType === 'MCP-02' || app.ticketType === 'MCP-03') {
      const mcpName = app.snapshot?.fields?.['MCP名称'] || app.submission?.fields?.name || app.resourceId || '未采集'
      const wsId = app.workspaceId || app.snapshot?.fields?.['workspace ID'] || ''
      const targetApp = app.snapshot?.fields?.['关联应用'] || app.submission?.fields?.targetApp || ''
      const status = app.ticketType === 'MCP-03' ? (app.status === '已完成' ? '已解绑' : '隔离中') : '已绑定'
      const time = app.history?.[0]?.at || app.createdAt || new Date(now).toISOString()

      allBindings.push({
        bindingId: app.snapshot?.fields?.['绑定ID'] || `bind-${app.ticketNo.slice(-6)}`,
        mcpName,
        workspaceId: wsId,
        targetApp,
        account: app.account || identity.account,
        org: app.org || app.applicantOrg || '',
        status,
        ticketNo: app.ticketNo,
        boundAt: time,
      })
    }
  }

  // 4. 构建告警与处置记录 (alerts)
  const allAlerts = []
  for (const app of mcpApps) {
    if (app.ticketType === 'MCP-03') {
      allAlerts.push({
        alertId: `ALT-${app.ticketNo}`,
        mcpName: app.snapshot?.fields?.['MCP名称'] || app.submission?.fields?.name || app.resourceId || '未采集',
        reason: app.snapshot?.fields?.['告警原因'] || '',
        operation: app.snapshot?.fields?.['处置类型'] || '',
        status: app.status === '已完成' ? '已处置' : '待审批',
        ticketNo: app.ticketNo,
        time: app.history?.[0]?.at || app.createdAt || new Date(now).toISOString(),
        org: app.org || app.applicantOrg || '',
      })
    }
  }

  const filteredAlerts = allAlerts.filter(a => !effectiveOrg || a.org === effectiveOrg)

  // 5. 构建调用追踪台账 (calls)
  const allCalls = []

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
      latencyMs: null,
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
