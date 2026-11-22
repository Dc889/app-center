import { check } from '../../../../runtime/http.mjs'

export function accountMonitorWindow(range = '24h', now = Date.now()) {
  check(['1h', '24h', '7d'].includes(range), 400, 'INVALID_REQUEST', '无效的时间窗口')
  const bucketMs = range === '7d' ? 3600000 : 300000
  const to = Math.floor(now / bucketMs) * bucketMs
  const duration = { '1h': 3600000, '24h': 86400000, '7d': 604800000 }[range]
  const from = to - duration
  return { range, from: new Date(from).toISOString(), to: new Date(to).toISOString(), fromMs: from, toMs: to, bucketMs }
}

export async function accountMonitorReport({
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

  const consistencyFilter = query.get('consistency') || '全部'
  const range = query.get('window') || '24h'
  accountMonitorWindow(range, now)

  const q = (query.get('q') || '').trim().toLowerCase()
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query.get('pageSize') || '10', 10) || 10))

  let directorySource = 'not_collected'
  if (cap) {
    try {
      const res = await cap('/catalog?kind=account', 'GET', undefined, headers)
      if (res.ok) directorySource = 'collected'
    } catch {
      directorySource = 'not_collected'
    }
  }

  const allMappings = []
  // 映射只来自账号工单，不预置演示账号。
  for (const app of applications) {
    if (['ACC-01', 'ACC-02'].includes(app.ticketType)) {
      if (!effectiveOrg || app.org === effectiveOrg) {
        const accName = app.submission?.fields?.account || app.account || ''
        const existing = allMappings.find(item => item.account === accName)
        if (!existing) {
          allMappings.unshift({
            account: accName,
            name: app.submission?.fields?.name || '',
            org: app.org || '',
            ragflowId: app.snapshot?.fields?.['RAGFlow ID'] || '',
            difyId: app.snapshot?.fields?.['Dify ID'] || '',
            workspaceId: app.workspaceId || '',
            consistency: app.status === '已完成' ? '一致' : '缺 Dify',
            checkedAt: app.createdAt || new Date(now).toISOString(),
            ticketNo: ops && !admin ? 'ACC-******' : app.ticketNo,
          })
        }
      }
    }
  }

  // 3. 统计五卡指标
  const totalCount = allMappings.length
  const consistentCount = allMappings.filter(m => m.consistency === '一致').length
  const missingRagflowCount = allMappings.filter(m => m.consistency === '缺 RAGFlow').length
  const missingDifyCount = allMappings.filter(m => m.consistency === '缺 Dify').length
  const conflictCount = allMappings.filter(m => ['账户名冲突', '角色不一致'].includes(m.consistency)).length

  // 4. 差异分布
  const diffMap = new Map([
    ['三方一致', consistentCount],
    ['缺 Dify', missingDifyCount],
    ['缺 RAGFlow', missingRagflowCount],
    ['角色不一致', allMappings.filter(m => m.consistency === '角色不一致').length],
    ['账户名冲突', allMappings.filter(m => m.consistency === '账户名冲突').length],
  ])
  const diffDistribution = Array.from(diffMap.entries()).map(([name, value]) => ({ name, value }))

  const trendBuckets = []
  const probes = []
  const allSyncJobs = []

  // 8. 映射过滤与分页
  const filteredMappings = allMappings.filter(m => {
    if (consistencyFilter !== '全部' && m.consistency !== consistencyFilter) return false
    if (q) {
      const match = [m.account, m.name, m.org, m.ragflowId, m.difyId, m.workspaceId, m.ticketNo, m.consistency].some(
        s => s && s.toLowerCase().includes(q)
      )
      if (!match) return false
    }
    return true
  })

  const startM = (page - 1) * pageSize
  const pagedMappings = filteredMappings.slice(startM, startM + pageSize)

  const startJ = (page - 1) * pageSize
  const pagedJobs = allSyncJobs.slice(startJ, startJ + pageSize)

  return {
    asOf: new Date(now).toISOString(),
    window: range,
    metrics: {
      totalCount,
      consistentCount,
      missingRagflowCount,
      missingDifyCount,
      conflictCount,
    },
    sources: {
      directory: directorySource,
      probes: 'not_collected',
      syncJobs: 'not_collected',
    },
    trend: trendBuckets,
    diffDistribution,
    mappings: {
      total: filteredMappings.length,
      page,
      pageSize,
      items: pagedMappings,
    },
    syncJobs: {
      total: allSyncJobs.length,
      page,
      pageSize,
      items: pagedJobs,
    },
    probes,
  }
}
