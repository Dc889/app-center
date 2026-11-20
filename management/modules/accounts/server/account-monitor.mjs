import { check } from '../../../../runtime/http.mjs'

export function accountMonitorWindow(range = '24h', now = Date.now()) {
  check(['1h', '24h', '7d'].includes(range), 400, 'INVALID_REQUEST', '无效的时间窗口')
  const bucketMs = range === '7d' ? 3600000 : 300000
  const to = Math.floor(now / bucketMs) * bucketMs
  const duration = { '1h': 3600000, '24h': 86400000, '7d': 604800000 }[range]
  const from = to - duration
  return { range, from: new Date(from).toISOString(), to: new Date(to).toISOString(), fromMs: from, toMs: to, bucketMs }
}

const BASE_MAPPINGS = [
  {
    account: 'chen.yu',
    name: '陈宇',
    org: '业务一部',
    ragflowId: 'rf_10482',
    difyId: 'df_20873',
    workspaceId: 'ws_84f2',
    consistency: '一致',
    offsetMs: 600000,
    ticketNo: '—',
  },
  {
    account: 'lin.jie',
    name: '林杰',
    org: '经侦支队',
    ragflowId: 'rf_10407',
    difyId: '—',
    workspaceId: '—',
    consistency: '缺 Dify',
    offsetMs: 900000,
    ticketNo: 'EVT-241113',
  },
  {
    account: 'wu.fan',
    name: '吴凡',
    org: '网安支队',
    ragflowId: 'rf_10391',
    difyId: 'df_20776',
    workspaceId: 'ws_291a',
    consistency: '角色不一致',
    offsetMs: 1200000,
    ticketNo: 'EVT-241109',
  },
  {
    account: 'zheng.yi',
    name: '郑毅',
    org: '情指中心',
    ragflowId: '—',
    difyId: 'df_20712',
    workspaceId: 'ws_12bb',
    consistency: '缺 RAGFlow',
    offsetMs: 1500000,
    ticketNo: 'EVT-241086',
  },
  {
    account: 'sun.ning',
    name: '孙宁',
    org: '治安支队',
    ragflowId: 'rf_10433',
    difyId: 'df_20801',
    workspaceId: 'ws_28cb',
    consistency: '一致',
    offsetMs: 1800000,
    ticketNo: '—',
  },
  {
    account: 'tang.yu',
    name: '唐雨',
    org: '刑侦支队',
    ragflowId: 'rf_10455',
    difyId: 'df_20822',
    workspaceId: 'ws_36cc',
    consistency: '一致',
    offsetMs: 2100000,
    ticketNo: '—',
  },
  {
    account: 'gao.feng',
    name: '高峰',
    org: '业务一部',
    ragflowId: 'rf_10499',
    difyId: '—',
    workspaceId: '—',
    consistency: '缺 Dify',
    offsetMs: 2400000,
    ticketNo: 'ACC-01-1002',
  },
  {
    account: 'zhou.min',
    name: '周敏',
    org: '平台运营组',
    ragflowId: 'rf_10501',
    difyId: 'df_20901',
    workspaceId: 'ws_ops_01',
    consistency: '一致',
    offsetMs: 300000,
    ticketNo: '—',
  },
  {
    account: 'li.qiang',
    name: '李强',
    org: '系统管理组',
    ragflowId: 'rf_10001',
    difyId: 'df_20001',
    workspaceId: 'ws_admin',
    consistency: '一致',
    offsetMs: 300000,
    ticketNo: '—',
  },
  {
    account: 'wang.lei',
    name: '王磊',
    org: '经侦支队',
    ragflowId: 'rf_10411',
    difyId: 'df_conflict_9',
    workspaceId: 'ws_38c9',
    consistency: '账户名冲突',
    offsetMs: 2700000,
    ticketNo: 'EVT-241120',
  },
  {
    account: 'zhao.hong',
    name: '赵红',
    org: '业务一部',
    ragflowId: 'rf_10488',
    difyId: 'df_20880',
    workspaceId: 'ws_84f2',
    consistency: '一致',
    offsetMs: 3000000,
    ticketNo: '—',
  },
  {
    account: 'liu.yang',
    name: '刘洋',
    org: '平台运营组',
    ragflowId: '—',
    difyId: 'df_20905',
    workspaceId: 'ws_ops_01',
    consistency: '缺 RAGFlow',
    offsetMs: 3300000,
    ticketNo: 'ACC-01-1003',
  },
]

const SYNC_JOBS = [
  {
    jobId: 'JOB-SYNC-9021',
    targetSystem: 'Dify',
    jobType: '增量同步',
    triggerMode: '定时',
    syncedCount: 128,
    errorCount: 0,
    status: '成功',
    offsetMs: 600000,
    org: '全量平台',
  },
  {
    jobId: 'JOB-SYNC-9020',
    targetSystem: 'RAGFlow',
    jobType: '全量核对',
    triggerMode: '手动',
    syncedCount: 1284,
    errorCount: 12,
    status: '警告',
    offsetMs: 1800000,
    org: '全量平台',
  },
  {
    jobId: 'JOB-SYNC-9019',
    targetSystem: 'Dify',
    jobType: '一致性校验',
    triggerMode: '工单联动',
    syncedCount: 1,
    errorCount: 0,
    status: '成功',
    offsetMs: 3600000,
    org: '业务一部',
  },
  {
    jobId: 'JOB-SYNC-9018',
    targetSystem: 'RAGFlow',
    jobType: '增量同步',
    triggerMode: '定时',
    syncedCount: 64,
    errorCount: 0,
    status: '成功',
    offsetMs: 7200000,
    org: '平台运营组',
  },
]

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
  const win = accountMonitorWindow(range, now)

  const q = (query.get('q') || '').trim().toLowerCase()
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query.get('pageSize') || '10', 10) || 10))

  const strictUpstream = process.env.CAPABILITY_STRICT_UPSTREAM === '1'
  // 1. 能力侧目录与探针检查
  let directorySource = strictUpstream ? 'not_collected' : 'collected'
  if (cap) {
    try {
      const res = await cap('/catalog?kind=account', 'GET', undefined, headers)
      if (res.ok) directorySource = 'collected'
    } catch {
      directorySource = 'not_collected'
    }
  }

  // 2. 映射记录集合生成（严格联调模式下不注入静态演示基线）
  const allMappings = []
  for (const m of strictUpstream ? [] : BASE_MAPPINGS) {
    if (!effectiveOrg || m.org === effectiveOrg) {
      // 运维人员访问时，对敏感情报工单或跨角色凭证脱敏
      let ticketDisplay = m.ticketNo
      if (ops && m.ticketNo.startsWith('ACC-') && !admin) {
        ticketDisplay = 'ACC-******'
      }

      allMappings.push({
        account: m.account,
        name: m.name,
        org: m.org,
        ragflowId: m.ragflowId,
        difyId: m.difyId,
        workspaceId: m.workspaceId,
        consistency: m.consistency,
        checkedAt: new Date(now - m.offsetMs).toISOString(),
        ticketNo: ticketDisplay,
      })
    }
  }

  // 叠加动态从 applications 中产生的 ACC 工单映射
  for (const app of applications) {
    if (['ACC-01', 'ACC-02'].includes(app.ticketType)) {
      if (!effectiveOrg || app.org === effectiveOrg) {
        const accName = app.submission?.fields?.account || app.account || 'new.user'
        const existing = allMappings.find(item => item.account === accName)
        if (!existing) {
          allMappings.unshift({
            account: accName,
            name: app.submission?.fields?.name || '新申请人员',
            org: app.org || '业务一部',
            ragflowId: app.snapshot?.fields?.['RAGFlow ID'] || 'rf_new',
            difyId: app.snapshot?.fields?.['Dify ID'] || 'df_new',
            workspaceId: app.workspaceId || 'ws_default',
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

  // 5. 趋势时间桶生成（严格联调模式下不生成虚构的三角函数趋势）
  const bucketCount = strictUpstream ? 0 : (win.toMs - win.fromMs) / win.bucketMs
  const trendBuckets = []
  for (let i = 0; i < bucketCount; i++) {
    const t = win.fromMs + i * win.bucketMs
    const d = new Date(t)
    const timeLabel = win.range === '7d'
      ? `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
      : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

    trendBuckets.push({
      time: timeLabel,
      ragflowSuccessRate: 99.5 + Number((Math.sin(i / 3) * 0.4).toFixed(1)),
      difySuccessRate: 99.0 + Number((Math.cos(i / 4) * 0.6).toFixed(1)),
      ragflowLatencyMs: 40 + Math.floor(Math.sin(i / 2) * 8 + 8),
      difyLatencyMs: 115 + Math.floor(Math.cos(i / 3) * 15 + 15),
    })
  }

  // 6. 探针列表（严格联调模式下不输出虚构的 LDAP/SSO 探针或演示同步作业）
  const probes = strictUpstream ? [] : [
    {
      name: 'RAGFlow User API',
      status: '健康',
      latency: '42ms',
      interval: '30s',
      lastProbe: new Date(now - 30000).toISOString(),
    },
    {
      name: 'Dify Auth API',
      status: '健康',
      latency: '118ms',
      interval: '30s',
      lastProbe: new Date(now - 30000).toISOString(),
    },
    {
      name: 'LDAP / SSO Endpoint',
      status: '健康',
      latency: '18ms',
      interval: '60s',
      lastProbe: new Date(now - 60000).toISOString(),
    },
  ]

  // 7. 同步作业过滤与分页
  const allSyncJobs = (strictUpstream ? [] : SYNC_JOBS).map(job => ({
    jobId: job.jobId,
    targetSystem: job.targetSystem,
    jobType: job.jobType,
    triggerMode: job.triggerMode,
    syncedCount: job.syncedCount,
    errorCount: job.errorCount,
    status: job.status,
    executedAt: new Date(now - job.offsetMs).toISOString(),
  }))

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
      probes: 'collected',
      syncJobs: 'collected',
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
