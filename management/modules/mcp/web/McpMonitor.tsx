import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts'
import { Network, Activity, CheckCircle, AlertTriangle, Search, RefreshCw, ArrowRight, ShieldAlert, Layers } from 'lucide-react'

type Metrics = {
  catalogCount: number | null
  activeCount: number | null
  isolatedCount: number
  boundCount: number
  abnormalCount: number
}

type CallItem = {
  callId: string
  time: string
  accessMode: string
  org: string
  appName: string
  mcpName: string
  toolName: string
  latency: string
  latencyMs?: number
  status: string
  ticketNo: string
}

type BindingItem = {
  bindingId: string
  mcpName: string
  workspaceId: string
  targetApp: string
  account: string
  org: string
  status: string
  ticketNo: string
  boundAt: string
}

type AlertItem = {
  alertId: string
  mcpName: string
  reason: string
  operation: string
  status: string
  ticketNo: string
  time: string
  org?: string
}

type McpMonitorModel = {
  asOf: string
  window: string
  metrics: Metrics
  sources: {
    catalog: 'collected' | 'not_collected'
    calls: 'collected' | 'not_collected'
    bindings: 'collected' | 'not_collected'
  }
  trend: { time: string; calls: number; success: number; timeouts: number; latencyMs: number }[]
  errorRanking: { name: string; value: number; reason: string }[]
  calls: {
    total: number
    page: number
    pageSize: number
    items: CallItem[]
  }
  bindings: {
    total: number
    page: number
    pageSize: number
    items: BindingItem[]
  }
  alerts: AlertItem[]
}

export function McpMonitor({
  onWorkOrder,
}: {
  role: 'user' | 'ops' | 'admin'
  onWorkOrder?: (title: string) => void
}) {
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h')
  const [activeTab, setActiveTab] = useState<'calls' | 'bindings' | 'alerts'>('calls')
  const [keyword, setKeyword] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<McpMonitorModel | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      window: range,
      page: String(page),
      pageSize: '10',
    })
    if (keyword) params.set('q', keyword)

    fetch(`/api/mcp-monitor?${params.toString()}`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(res.status === 403 ? '无权限查看MCP监控' : '获取MCP监控数据失败')
        return res.json()
      })
      .then((json: McpMonitorModel) => {
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
  }, [range, page, keyword, refresh])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setKeyword(queryInput.trim())
  }

  const currentTotal = activeTab === 'calls'
    ? (data?.calls.total ?? 0)
    : activeTab === 'bindings'
    ? (data?.bindings.total ?? 0)
    : (data?.alerts.length ?? 0)

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(currentTotal / pageSize))

  return (
    <div className="monitor-container" data-testid="mcp-monitor" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 头部与时间范围切换 */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="page-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Network size={14} /> MCP 监控 · 调用与绑定明细
            </span>
            
          </div>
          <h1 className="page-title" >MCP 监控</h1>
          
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
      <div className="metrics-grid" data-testid="mcp-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
        <div className="metric-card">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13 }}>
            <span>目录总数</span>
            <Network size={16} color="#3b82f6" />
          </div>
          <div className="metric-value" style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 4px' }}>
            {data?.metrics.catalogCount === null ? (
              <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>未采集</span>
            ) : (
              data?.metrics.catalogCount ?? '—'
            )}
          </div>
          <div className="metric-sub" style={{ fontSize: 11, color: '#64748b' }}>
            {data?.sources.catalog === 'collected' ? '已自 MCP 目录采集' : '能力端未接入'}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13 }}>
            <span>正常运行数</span>
            <CheckCircle size={16} color="#10b981" />
          </div>
          <div className="metric-value" style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 4px', color: '#10b981' }}>
            {data?.metrics.activeCount === null ? (
              <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>未采集</span>
            ) : (
              data?.metrics.activeCount ?? '—'
            )}
          </div>
          <div className="metric-sub" style={{ fontSize: 11, color: '#64748b' }}>可用状态 MCP 服务</div>
        </div>

        <div className="metric-card">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13 }}>
            <span>隔离数</span>
            <ShieldAlert size={16} color="#f59e0b" />
          </div>
          <div className="metric-value" style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 4px', color: (data?.metrics.isolatedCount ?? 0) > 0 ? '#f59e0b' : '#334155' }}>
            {data?.metrics.isolatedCount ?? 0}
          </div>
          <div className="metric-sub" style={{ fontSize: 11, color: '#64748b' }}>MCP-03 隔离中</div>
        </div>

        <div className="metric-card">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13 }}>
            <span>绑定总数</span>
            <Layers size={16} color="#6366f1" />
          </div>
          <div className="metric-value" style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 4px' }}>
            {data?.metrics.boundCount ?? 0}
          </div>
          <div className="metric-sub" style={{ fontSize: 11, color: '#64748b' }}>各工作区生效绑定</div>
        </div>

        <div className="metric-card">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13 }}>
            <span>异常数</span>
            <AlertTriangle size={16} color="#ef4444" />
          </div>
          <div className="metric-value" style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 4px', color: (data?.metrics.abnormalCount ?? 0) > 0 ? '#ef4444' : '#334155' }}>
            {data?.metrics.abnormalCount ?? 0}
          </div>
          <div className="metric-sub" style={{ fontSize: 11, color: '#64748b' }}>超时及告警处置</div>
        </div>
      </div>

      {/* 图表行：左侧调用与超时趋势，右侧异常 MCP 排行 */}
      <div className="charts-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="chart-card" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>MCP 调用趋势与延迟</h4>
            <span style={{ fontSize: 11, color: '#6b7280' }}>调用数 / 成功 / 超时</span>
          </div>
          <div style={{ width: '100%', height: 220 }}>
            {data && data.trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
                    formatter={(val: any, name: any) => {
                      if (name === 'calls') return [val, '调用次数']
                      if (name === 'success') return [val, '成功次数']
                      if (name === 'timeouts') return [val, '超时次数']
                      if (name === 'latencyMs') return [`${val}ms`, '平均耗时']
                      return [val, name]
                    }}
                  />
                  <Line type="monotone" dataKey="calls" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="success" stroke="#10b981" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="timeouts" stroke="#ef4444" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
                暂无调用趋势数据
              </div>
            )}
          </div>
        </div>

        <div className="chart-card" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>异常 MCP 排行</h4>
            <span style={{ fontSize: 11, color: '#6b7280' }}>超时 / 异常次数</span>
          </div>
          <div style={{ width: '100%', height: 220 }}>
            {data && data.errorRanking.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.errorRanking} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
                    formatter={(val: any, _name: any, item: any) => [
                      `${val} 次 (${item.payload.reason})`,
                      '异常统计'
                    ]}
                  />
                  <Bar dataKey="value" fill="#f87171" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
                暂无异常排行记录
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
              className={`tab-item ${activeTab === 'calls' ? 'active' : ''}`}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: activeTab === 'calls' ? '#eff6ff' : 'transparent',
                color: activeTab === 'calls' ? '#2563eb' : '#4b5563',
                fontWeight: activeTab === 'calls' ? 600 : 400,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
              }}
              onClick={() => { setActiveTab('calls'); setPage(1) }}
            >
              <Activity size={14} />
              MCP 调用追踪 ({data?.calls.total ?? 0})
            </button>
            <button
              type="button"
              className={`tab-item ${activeTab === 'bindings' ? 'active' : ''}`}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: activeTab === 'bindings' ? '#eff6ff' : 'transparent',
                color: activeTab === 'bindings' ? '#2563eb' : '#4b5563',
                fontWeight: activeTab === 'bindings' ? 600 : 400,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
              }}
              onClick={() => { setActiveTab('bindings'); setPage(1) }}
            >
              <Layers size={14} />
              工作区绑定台账 ({data?.bindings.total ?? 0})
            </button>
            <button
              type="button"
              className={`tab-item ${activeTab === 'alerts' ? 'active' : ''}`}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: activeTab === 'alerts' ? '#eff6ff' : 'transparent',
                color: activeTab === 'alerts' ? '#2563eb' : '#4b5563',
                fontWeight: activeTab === 'alerts' ? 600 : 400,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
              }}
              onClick={() => { setActiveTab('alerts'); setPage(1) }}
            >
              <ShieldAlert size={14} />
              告警与处置记录 ({data?.alerts.length ?? 0})
            </button>
          </div>

          {/* 搜索框 */}
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
              <input
                type="text"
                className="search-input"
                aria-label="搜索MCP台账"
                placeholder="搜索MCP、工具、应用、工单号..."
                value={queryInput}
                onChange={e => setQueryInput(e.target.value)}
                style={{ paddingLeft: 30, paddingRight: 10, paddingTop: 5, paddingBottom: 5, fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', width: 220 }}
              />
            </div>
            <button type="submit" className="secondary-button" style={{ padding: '4px 10px', fontSize: 12 }}>
              搜索
            </button>
          </form>
        </div>

        {/* Tab 1: MCP 调用追踪 */}
        {activeTab === 'calls' && (
          <div className="table-wrap">
            <table data-testid="mcp-calls-table">
              <thead>
                <tr>
                  <th>记录 ID</th>
                  <th>时间</th>
                  <th>调用方式</th>
                  <th>组织</th>
                  <th>应用</th>
                  <th>MCP 服务</th>
                  <th>工具</th>
                  <th>耗时</th>
                  <th>结果</th>
                  <th>关联工单</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data && data.calls.items.length > 0 ? (
                  data.calls.items.map(row => (
                    <tr key={row.callId}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.callId}</td>
                      <td style={{ fontSize: 11, color: '#64748b' }}>{new Date(row.time).toLocaleTimeString('zh-CN')}</td>
                      <td>
                        <span className={`status ${row.accessMode === '广场 Web' ? 'info' : 'outline'}`}>
                          {row.accessMode}
                        </span>
                      </td>
                      <td>{row.org}</td>
                      <td style={{ fontWeight: 500 }}>{row.appName}</td>
                      <td>{row.mcpName}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.toolName}</td>
                      <td>{row.latency}</td>
                      <td>
                        <span className={`status ${row.status === '成功' ? 'success' : 'danger'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                      <td>
                        {onWorkOrder && (
                          <button
                            className="row-action"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
                            onClick={() => onWorkOrder(`MCP调用 · ${row.mcpName} (${row.ticketNo})`)}
                          >
                            打开工单 <ArrowRight size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
                      {loading ? '正在加载数据...' : '当前筛选条件下暂无调用记录'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: 工作区绑定台账 */}
        {activeTab === 'bindings' && (
          <div className="table-wrap">
            <table data-testid="mcp-bindings-table">
              <thead>
                <tr>
                  <th>绑定 ID</th>
                  <th>MCP 服务</th>
                  <th>目标 Workspace</th>
                  <th>关联应用</th>
                  <th>绑定账户</th>
                  <th>所属组织</th>
                  <th>状态</th>
                  <th>关联工单</th>
                  <th>绑定时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data && data.bindings.items.length > 0 ? (
                  data.bindings.items.map(row => (
                    <tr key={row.bindingId}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.bindingId}</td>
                      <td style={{ fontWeight: 500 }}>{row.mcpName}</td>
                      <td style={{ fontFamily: 'monospace' }}>{row.workspaceId}</td>
                      <td>{row.targetApp}</td>
                      <td>{row.account}</td>
                      <td>{row.org}</td>
                      <td>
                        <span className={`status ${row.status === '已绑定' ? 'success' : row.status === '已解绑' ? 'neutral' : 'warning'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                      <td style={{ fontSize: 11, color: '#64748b' }}>{new Date(row.boundAt).toLocaleString('zh-CN')}</td>
                      <td>
                        {onWorkOrder && (
                          <button
                            className="row-action"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
                            onClick={() => onWorkOrder(`MCP绑定 · ${row.mcpName} (${row.ticketNo})`)}
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
                      当前筛选条件下暂无绑定记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: 告警与处置记录 */}
        {activeTab === 'alerts' && (
          <div className="table-wrap">
            <table data-testid="mcp-alerts-table">
              <thead>
                <tr>
                  <th>告警 ID</th>
                  <th>MCP 服务</th>
                  <th>告警原因</th>
                  <th>处置操作</th>
                  <th>处置状态</th>
                  <th>关联工单</th>
                  <th>发生时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data && data.alerts.length > 0 ? (
                  data.alerts.map(row => (
                    <tr key={row.alertId}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.alertId}</td>
                      <td style={{ fontWeight: 500 }}>{row.mcpName}</td>
                      <td style={{ color: '#dc2626' }}>{row.reason}</td>
                      <td>
                        <span className="status warning">{row.operation}</span>
                      </td>
                      <td>
                        <span className={`status ${row.status === '已处置' ? 'success' : 'danger'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                      <td style={{ fontSize: 11, color: '#64748b' }}>{new Date(row.time).toLocaleString('zh-CN')}</td>
                      <td>
                        {onWorkOrder && (
                          <button
                            className="row-action"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
                            onClick={() => onWorkOrder(`MCP告警处置 · ${row.mcpName} (${row.ticketNo})`)}
                          >
                            打开工单 <ArrowRight size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
                      暂无安全告警与处置记录
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
