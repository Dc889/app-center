import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts'
import { Users, CheckCircle, AlertTriangle, RefreshCw, Search, ArrowRight, ShieldCheck, Server, Activity } from 'lucide-react'

type Metrics = {
  totalCount: number | null
  consistentCount: number | null
  missingRagflowCount: number
  missingDifyCount: number
  conflictCount: number
}

type MappingItem = {
  account: string
  name: string
  org: string
  ragflowId: string
  difyId: string
  workspaceId: string
  consistency: string
  checkedAt: string
  ticketNo: string
}

type SyncJobItem = {
  jobId: string
  targetSystem: string
  jobType: string
  triggerMode: string
  syncedCount: number
  errorCount: number
  status: string
  executedAt: string
}

type ProbeItem = {
  name: string
  status: string
  latency: string
  interval: string
  lastProbe: string
}

type AccountMonitorModel = {
  asOf: string
  window: string
  metrics: Metrics
  sources: {
    directory: 'collected' | 'not_collected'
    probes: 'collected' | 'not_collected'
    syncJobs: 'collected' | 'not_collected'
  }
  trend: {
    time: string
    ragflowSuccessRate: number
    difySuccessRate: number
    ragflowLatencyMs: number
    difyLatencyMs: number
  }[]
  diffDistribution: { name: string; value: number }[]
  mappings: {
    total: number
    page: number
    pageSize: number
    items: MappingItem[]
  }
  syncJobs: {
    total: number
    page: number
    pageSize: number
    items: SyncJobItem[]
  }
  probes: ProbeItem[]
}

export function AccountMonitor({
  role,
  onWorkOrder,
}: {
  role: 'user' | 'ops' | 'admin'
  onWorkOrder?: (title: string) => void
}) {
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h')
  const [activeTab, setActiveTab] = useState<'mappings' | 'syncJobs' | 'probes'>('mappings')
  const [consistencyFilter, setConsistencyFilter] = useState('全部')
  const [keyword, setKeyword] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AccountMonitorModel | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      window: range,
      page: String(page),
      pageSize: '10',
    })
    if (consistencyFilter !== '全部') params.set('consistency', consistencyFilter)
    if (keyword) params.set('q', keyword)

    fetch(`/api/account-monitor?${params.toString()}`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(res.status === 403 ? '无权限查看账号与集成监控' : '获取账号与集成监控数据失败')
        return res.json()
      })
      .then((json: AccountMonitorModel) => {
        if (!controller.signal.aborted) {
          setData(json)
          setError(null)
        }
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) {
          setError(err.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [range, page, consistencyFilter, keyword, refresh])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setKeyword(queryInput.trim())
  }

  const currentTotal = activeTab === 'mappings'
    ? (data?.mappings.total ?? 0)
    : activeTab === 'syncJobs'
    ? (data?.syncJobs.total ?? 0)
    : (data?.probes.length ?? 0)

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(currentTotal / pageSize))

  return (
    <div className="monitor-container" data-testid="account-monitor" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 头部与时间范围切换 */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="page-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Users size={14} /> 账号与集成 · 映射与同步核对
            </span>
            <span
              className="badge"
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                background: role === 'admin' ? '#e0e7ff' : '#fef3c7',
                color: role === 'admin' ? '#3730a3' : '#92400e',
              }}
            >
              {role === 'admin' ? '系统管理员视角（全量审计）' : '运维视角（所属组织隔离）'}
            </span>
          </div>
          <h2 className="page-title" style={{ margin: '4px 0 0' }}>账号与集成监控</h2>
          <p className="page-desc" style={{ margin: '4px 0 0', color: '#64748b' }}>
            核对平台、RAGFlow 与 Dify 三方身份一致性，监控接口探针健康、响应延迟与目录同步任务流水。
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="segmented-control" role="group" aria-label="统计时间范围">
            {(['1h', '24h', '7d'] as const).map(w => (
              <button
                key={w}
                type="button"
                className={`segmented-button ${range === w ? 'active' : ''}`}
                onClick={() => { setRange(w); setPage(1) }}
              >
                {w}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="secondary-button"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px' }}
            onClick={() => setRefresh(r => r + 1)}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert" style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 6 }}>
          {error}
        </div>
      )}

      {/* 指标卡（五项指标） */}
      <div className="metrics-grid" data-testid="account-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <div className="metric-card">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13 }}>
            <span>映射总数</span>
            <Users size={16} color="#3b82f6" />
          </div>
          <div className="metric-value" style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 4px' }}>
            {data?.metrics.totalCount === null ? (
              <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>未采集</span>
            ) : (
              data?.metrics.totalCount ?? '—'
            )}
          </div>
          <div className="metric-sub" style={{ fontSize: 11, color: '#64748b' }}>已纳管三方人员</div>
        </div>

        <div className="metric-card">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13 }}>
            <span>三方一致</span>
            <CheckCircle size={16} color="#10b981" />
          </div>
          <div className="metric-value" style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 4px', color: '#10b981' }}>
            {data?.metrics.consistentCount === null ? (
              <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>未采集</span>
            ) : (
              data?.metrics.consistentCount ?? '—'
            )}
          </div>
          <div className="metric-sub" style={{ fontSize: 11, color: '#64748b' }}>状态与角色完全匹配</div>
        </div>

        <div className="metric-card">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13 }}>
            <span>缺 RAGFlow</span>
            <AlertTriangle size={16} color="#f59e0b" />
          </div>
          <div className="metric-value" style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 4px', color: (data?.metrics.missingRagflowCount ?? 0) > 0 ? '#f59e0b' : '#334155' }}>
            {data?.metrics.missingRagflowCount ?? 0}
          </div>
          <div className="metric-sub" style={{ fontSize: 11, color: '#64748b' }}>待同步知识库账号</div>
        </div>

        <div className="metric-card">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13 }}>
            <span>缺 Dify</span>
            <AlertTriangle size={16} color="#f59e0b" />
          </div>
          <div className="metric-value" style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 4px', color: (data?.metrics.missingDifyCount ?? 0) > 0 ? '#f59e0b' : '#334155' }}>
            {data?.metrics.missingDifyCount ?? 0}
          </div>
          <div className="metric-sub" style={{ fontSize: 11, color: '#64748b' }}>待分配开发空间</div>
        </div>

        <div className="metric-card">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13 }}>
            <span>差异与冲突</span>
            <ShieldCheck size={16} color="#ef4444" />
          </div>
          <div className="metric-value" style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 4px', color: (data?.metrics.conflictCount ?? 0) > 0 ? '#ef4444' : '#334155' }}>
            {data?.metrics.conflictCount ?? 0}
          </div>
          <div className="metric-sub" style={{ fontSize: 11, color: '#64748b' }}>待安全处置工单</div>
        </div>
      </div>

      {/* 图表行：左侧接口健康趋势，右侧账号差异分布 */}
      <div className="charts-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="chart-card" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>接口健康趋势与延迟</h4>
            <span style={{ fontSize: 11, color: '#6b7280' }}>RAGFlow / Dify 请求成功率与延迟</span>
          </div>
          <div style={{ width: '100%', height: 220 }}>
            {data && data.trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={[95, 100]} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
                    formatter={(val: any, name: any) => {
                      if (name === 'ragflowSuccessRate') return [`${val}%`, 'RAGFlow 成功率']
                      if (name === 'difySuccessRate') return [`${val}%`, 'Dify 成功率']
                      return [val, name]
                    }}
                  />
                  <Line type="monotone" dataKey="ragflowSuccessRate" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="difySuccessRate" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
                暂无接口健康趋势数据
              </div>
            )}
          </div>
        </div>

        <div className="chart-card" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>账号差异分布</h4>
            <span style={{ fontSize: 11, color: '#6b7280' }}>状态分类分布</span>
          </div>
          <div style={{ width: '100%', height: 220 }}>
            {data && data.diffDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.diffDistribution} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
                    formatter={(val: any) => [`${val} 人`, '数量']}
                  />
                  <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
                暂无差异分布记录
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 台账与明细区块 */}
      <section className="monitor-section" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <div className="section-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f3f4f6' }}>
          {/* Tab 切换 */}
          <div className="tab-group" style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={`tab-item ${activeTab === 'mappings' ? 'active' : ''}`}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: activeTab === 'mappings' ? '#eff6ff' : 'transparent',
                color: activeTab === 'mappings' ? '#2563eb' : '#4b5563',
                fontWeight: activeTab === 'mappings' ? 600 : 400,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
              }}
              onClick={() => { setActiveTab('mappings'); setPage(1) }}
            >
              <Users size={14} />
              账号映射核对 ({data?.mappings.total ?? 0})
            </button>
            <button
              type="button"
              className={`tab-item ${activeTab === 'syncJobs' ? 'active' : ''}`}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: activeTab === 'syncJobs' ? '#eff6ff' : 'transparent',
                color: activeTab === 'syncJobs' ? '#2563eb' : '#4b5563',
                fontWeight: activeTab === 'syncJobs' ? 600 : 400,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
              }}
              onClick={() => { setActiveTab('syncJobs'); setPage(1) }}
            >
              <Activity size={14} />
              同步作业台账 ({data?.syncJobs.total ?? 0})
            </button>
            <button
              type="button"
              className={`tab-item ${activeTab === 'probes' ? 'active' : ''}`}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: activeTab === 'probes' ? '#eff6ff' : 'transparent',
                color: activeTab === 'probes' ? '#2563eb' : '#4b5563',
                fontWeight: activeTab === 'probes' ? 600 : 400,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
              }}
              onClick={() => { setActiveTab('probes'); setPage(1) }}
            >
              <Server size={14} />
              接口健康与探针 ({data?.probes.length ?? 0})
            </button>
          </div>

          {/* 筛选与搜索 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {activeTab === 'mappings' && (
              <select
                value={consistencyFilter}
                onChange={e => { setConsistencyFilter(e.target.value); setPage(1) }}
                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
              >
                {['全部', '一致', '缺 RAGFlow', '缺 Dify', '角色不一致', '账户名冲突'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <input
                  type="text"
                  className="search-input"
                  aria-label="搜索账号映射"
                  placeholder="搜索账户名、姓名、工单号..."
                  value={queryInput}
                  onChange={e => setQueryInput(e.target.value)}
                  style={{ paddingLeft: 30, paddingRight: 10, paddingTop: 5, paddingBottom: 5, fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', width: 200 }}
                />
              </div>
              <button type="submit" className="secondary-button" style={{ padding: '4px 10px', fontSize: 12 }}>
                搜索
              </button>
            </form>
          </div>
        </div>

        {/* Tab 1: 账号映射核对 */}
        {activeTab === 'mappings' && (
          <div className="table-wrap">
            <table data-testid="account-mappings-table">
              <thead>
                <tr>
                  <th>平台账户名</th>
                  <th>姓名</th>
                  <th>组织</th>
                  <th>RAGFlow ID</th>
                  <th>Dify ID</th>
                  <th>Workspace</th>
                  <th>一致性</th>
                  <th>关联工单</th>
                  <th>最近核对</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data && data.mappings.items.length > 0 ? (
                  data.mappings.items.map(row => (
                    <tr key={row.account}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.account}</td>
                      <td style={{ fontWeight: 500 }}>{row.name}</td>
                      <td>{row.org}</td>
                      <td style={{ fontFamily: 'monospace' }}>{row.ragflowId}</td>
                      <td style={{ fontFamily: 'monospace' }}>{row.difyId}</td>
                      <td style={{ fontFamily: 'monospace' }}>{row.workspaceId}</td>
                      <td>
                        <span className={`status ${row.consistency === '一致' ? 'success' : row.consistency === '角色不一致' ? 'warning' : 'danger'}`}>
                          {row.consistency}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                      <td style={{ fontSize: 11, color: '#64748b' }}>{new Date(row.checkedAt).toLocaleTimeString('zh-CN')}</td>
                      <td>
                        {onWorkOrder && row.ticketNo && row.ticketNo !== '—' && (
                          <button
                            className="row-action"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
                            onClick={() => onWorkOrder(`账号工单 · ${row.name} (${row.ticketNo})`)}
                          >
                            打开工单 <ArrowRight size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
                      {loading ? '正在加载数据...' : '当前筛选条件下暂无账号映射记录'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: 适配同步作业台账 */}
        {activeTab === 'syncJobs' && (
          <div className="table-wrap">
            <table data-testid="account-sync-table">
              <thead>
                <tr>
                  <th>作业 ID</th>
                  <th>目标系统</th>
                  <th>作业类型</th>
                  <th>触发方式</th>
                  <th>同步条数</th>
                  <th>异常数</th>
                  <th>状态</th>
                  <th>执行时间</th>
                </tr>
              </thead>
              <tbody>
                {data && data.syncJobs.items.length > 0 ? (
                  data.syncJobs.items.map(job => (
                    <tr key={job.jobId}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{job.jobId}</td>
                      <td>
                        <span className="status info">{job.targetSystem}</span>
                      </td>
                      <td>{job.jobType}</td>
                      <td>{job.triggerMode}</td>
                      <td style={{ fontWeight: 600 }}>{job.syncedCount} 条</td>
                      <td style={{ color: job.errorCount > 0 ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                        {job.errorCount}
                      </td>
                      <td>
                        <span className={`status ${job.status === '成功' ? 'success' : job.status === '警告' ? 'warning' : 'danger'}`}>
                          {job.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: '#64748b' }}>{new Date(job.executedAt).toLocaleString('zh-CN')}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
                      暂无同步作业记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: 接口健康与探针 */}
        {activeTab === 'probes' && (
          <div className="table-wrap">
            <table data-testid="account-probes-table">
              <thead>
                <tr>
                  <th>接口名称</th>
                  <th>运行状态</th>
                  <th>探测耗时</th>
                  <th>探针频率</th>
                  <th>最近检查时间</th>
                </tr>
              </thead>
              <tbody>
                {data && data.probes.length > 0 ? (
                  data.probes.map(probe => (
                    <tr key={probe.name}>
                      <td style={{ fontWeight: 600 }}>{probe.name}</td>
                      <td>
                        <span className={`status ${probe.status === '健康' ? 'success' : 'danger'}`}>
                          {probe.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', color: '#2563eb' }}>{probe.latency}</td>
                      <td>每 {probe.interval}</td>
                      <td style={{ fontSize: 11, color: '#64748b' }}>{new Date(probe.lastProbe).toLocaleTimeString('zh-CN')}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
                      暂无探针记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页控制 */}
        {totalPages > 1 && (
          <div className="pagination" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid #f3f4f6' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              共 {currentTotal} 条记录，第 {page} / {totalPages} 页
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="secondary-button"
                style={{ padding: '4px 10px', fontSize: 12 }}
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <button
                className="secondary-button"
                style={{ padding: '4px 10px', fontSize: 12 }}
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
