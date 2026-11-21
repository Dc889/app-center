import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts'
import { PlugZap, ShieldAlert, Cpu, ArrowUpCircle, CheckCircle, RefreshCw, Search, ArrowRight, Server } from 'lucide-react'

type Metrics = {
  publishedCount: number | null
  installedCount: number
  runningCount: number | null
  disabledCount: number
  upgradableCount: number
  vulnerableCount: number
}

type DisableItem = {
  disabledAt: string
  pluginName: string
  version: string
  workspaceId: string
  installationId: string
  rule: string
  threshold: string
  actualValue: string
  recoveryStatus: string
  ticketNo: string
}

type InstanceItem = {
  installationId: string
  pluginName: string
  version: string
  workspaceId: string
  account: string
  org: string
  status: string
  ticketNo: string
  installedAt: string
}

type PluginMonitorModel = {
  asOf: string
  window: string
  metrics: Metrics
  sources: {
    catalog: 'collected' | 'not_collected'
    daemon: 'collected' | 'not_collected'
    safety: 'collected' | 'not_collected'
  }
  trend: { time: string; memoryUsedMb: number; memoryLimitMb: number; calls: number; failures: number; timeouts: number }[]
  errorRanking: { name: string; value: number; reason: string }[]
  daemonHealth: {
    status: string
    checkedAt: string
    instances: number
    evidenceRef: string
  }
  disables: {
    total: number
    page: number
    pageSize: number
    items: DisableItem[]
  }
  instances: {
    total: number
    page: number
    pageSize: number
    items: InstanceItem[]
  }
}

export function PluginMonitor({
  role,
  onWorkOrder,
}: {
  role: 'user' | 'ops' | 'admin'
  onWorkOrder?: (title: string) => void
}) {
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h')
  const [activeTab, setActiveTab] = useState<'disables' | 'instances'>('disables')
  const [keyword, setKeyword] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PluginMonitorModel | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      window: range,
      page: String(page),
      pageSize: '10',
    })
    if (keyword) params.set('q', keyword)

    fetch(`/api/plugin-monitor?${params.toString()}`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(res.status === 403 ? '无权限查看插件监控' : '获取插件监控数据失败')
        return res.json()
      })
      .then((json: PluginMonitorModel) => {
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
  }, [range, page, keyword, refresh, role])

  const reload = (nextRange = range) => {
    setLoading(true)
    setError(null)
    setRange(nextRange)
    setRefresh(n => n + 1)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setKeyword(queryInput.trim())
    setPage(1)
  }

  const currentTotal = activeTab === 'disables' ? (data?.disables.total ?? 0) : (data?.instances.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(currentTotal / 10))

  return (
    <div className="monitor-container" data-testid="plugin-monitor">
      <header className="page-header">
        <div>
          
          <h1>插件监控</h1>
          
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="time-filter">
            <button className={range === '1h' ? 'active' : ''} onClick={() => reload('1h')}>1 小时</button>
            <button className={range === '24h' ? 'active' : ''} onClick={() => reload('24h')}>24 小时</button>
            <button className={range === '7d' ? 'active' : ''} onClick={() => reload('7d')}>7 天</button>
          </div>
          <button className="icon-button" onClick={() => reload()} title="刷新" disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </header>

      {error && (
        <div className="alert-banner error" style={{ margin: '16px 0', padding: 12, borderRadius: 6, background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c' }}>
          <ShieldAlert size={16} /> <span>{error}</span>
        </div>
      )}

      {/* 六大指标卡 */}
      <div className="metric-grid six" data-testid="plugin-metric-grid" >
        <article className="metric-card">
          <div className="metric-icon tone-1"><PlugZap size={19} /></div>
          <span>已上架插件</span>
          <strong>{data?.metrics.publishedCount !== null && data?.metrics.publishedCount !== undefined ? data.metrics.publishedCount : '未采集'}</strong>
          <small>{data?.sources.catalog === 'collected' ? '插件仓库盘点' : '能力端未接入'}</small>
        </article>

        <article className="metric-card">
          <div className="metric-icon tone-2"><Server size={19} /></div>
          <span>已安装实例</span>
          <strong>{data ? data.metrics.installedCount : '—'}</strong>
          <small>跨工作区实例</small>
        </article>

        <article className="metric-card">
          <div className="metric-icon tone-3"><CheckCircle size={19} /></div>
          <span>运行中实例</span>
          <strong>{data?.metrics.runningCount !== null && data?.metrics.runningCount !== undefined ? data.metrics.runningCount : '未采集'}</strong>
          <small>Daemon 纳管</small>
        </article>

        <article className="metric-card">
          <div className="metric-icon tone-4"><ShieldAlert size={19} /></div>
          <span>自动禁用</span>
          <strong style={{ color: (data?.metrics.disabledCount ?? 0) > 0 ? '#dc2626' : undefined }}>
            {data ? data.metrics.disabledCount : '—'}
          </strong>
          <small>需运维确认</small>
        </article>

        <article className="metric-card">
          <div className="metric-icon tone-5"><ArrowUpCircle size={19} /></div>
          <span>待升级实例</span>
          <strong style={{ color: (data?.metrics.upgradableCount ?? 0) > 0 ? '#d97706' : undefined }}>
            {data ? data.metrics.upgradableCount : '—'}
          </strong>
          <small>新版本可用</small>
        </article>

        <article className="metric-card">
          <div className="metric-icon tone-1"><Cpu size={19} /></div>
          <span>安全告警</span>
          <strong style={{ color: (data?.metrics.vulnerableCount ?? 0) > 0 ? '#dc2626' : undefined }}>
            {data ? data.metrics.vulnerableCount : '—'}
          </strong>
          <small>待处理告警</small>
        </article>
      </div>

      {/* Daemon 探测横幅 */}
      <div style={{ marginBottom: 20, padding: '12px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: data?.daemonHealth.status === 'healthy' ? '#10b981' : '#f59e0b' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Plugin Daemon 容器守护进程</span>
          <span style={{ fontSize: 12, color: '#64748b' }}>探测状态：正常，纳管容器实例：{data?.daemonHealth.instances ?? 0} 个</span>
        </div>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          最后健康采样：{data?.daemonHealth.checkedAt ? new Date(data.daemonHealth.checkedAt).toLocaleTimeString('zh-CN') : '—'}
        </span>
      </div>

      {/* 双列图表 */}
      <div className="dashboard-grid two-column" >
        <section className="panel chart-panel wide">
          <div className="panel-title">
            <div>
              <h3>容器内存与调用趋势</h3>
              
            </div>
          </div>
          <div className="chart-body" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.trend || []} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#edf0f5" vertical={false} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                <YAxis dataKey="memoryUsedMb" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e8ebf2', fontSize: 12 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="memoryUsedMb" name="已用内存 (MB)" stroke="#7c3aed" strokeWidth={2.2} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="memoryLimitMb" name="内存上限 (MB)" stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1.5} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="failures" name="调用失败" stroke="#ef4444" strokeWidth={1.8} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="timeouts" name="调用超时" stroke="#f59e0b" strokeWidth={1.8} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel chart-panel">
          <div className="panel-title">
            <div>
              <h3>插件错误排行</h3>
              <p>失败率与超时告警排行</p>
            </div>
          </div>
          <div className="chart-body" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.errorRanking || []} layout="vertical" margin={{ top: 15, right: 15, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="#edf0f5" horizontal={false} />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fill: '#667085', fontSize: 11 }} />
                <Tooltip cursor={{ fill: '#f6f7fb' }} contentStyle={{ borderRadius: 8, border: '1px solid #e8ebf2', fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="value" name="异常次数" fill="#f43f5e" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* 台账面板 */}
      <section className="panel table-panel">
        <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div className="tab-group" style={{ display: 'flex', gap: 6, background: '#f3f4f6', padding: 3, borderRadius: 6 }}>
              <button
                className={`tab-btn ${activeTab === 'disables' ? 'active' : ''}`}
                style={{
                  padding: '5px 12px', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer',
                  background: activeTab === 'disables' ? '#ffffff' : 'transparent',
                  fontWeight: activeTab === 'disables' ? 600 : 400,
                  boxShadow: activeTab === 'disables' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
                onClick={() => { setActiveTab('disables'); setPage(1) }}
              >
                自动禁用记录 ({data?.disables.total ?? 0})
              </button>
              <button
                className={`tab-btn ${activeTab === 'instances' ? 'active' : ''}`}
                style={{
                  padding: '5px 12px', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer',
                  background: activeTab === 'instances' ? '#ffffff' : 'transparent',
                  fontWeight: activeTab === 'instances' ? 600 : 400,
                  boxShadow: activeTab === 'instances' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
                onClick={() => { setActiveTab('instances'); setPage(1) }}
              >
                工作区安装实例 ({data?.instances.total ?? 0})
              </button>
            </div>
          </div>

          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="搜索插件/Workspace/工单号..."
                value={queryInput}
                onChange={e => setQueryInput(e.target.value)}
                style={{ padding: '6px 12px 6px 28px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', width: 220 }}
              />
              <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
            </div>
            <button type="submit" className="secondary-button" style={{ padding: '6px 12px', fontSize: 12 }}>
              搜索
            </button>
            {keyword && (
              <button
                type="button"
                className="secondary-button"
                style={{ padding: '6px 8px', fontSize: 12 }}
                onClick={() => { setKeyword(''); setQueryInput(''); setPage(1) }}
              >
                清除
              </button>
            )}
          </form>
        </div>

        {/* Tab 1: 自动禁用记录 */}
        {activeTab === 'disables' && (
          <div className="table-wrap">
            <table data-testid="plugin-disables-table">
              <thead>
                <tr>
                  <th>禁用时间</th>
                  <th>插件名称</th>
                  <th>版本</th>
                  <th>Workspace</th>
                  <th>触发规则</th>
                  <th>阈值</th>
                  <th>实测值</th>
                  <th>恢复状态</th>
                  <th>关联工单</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data && data.disables.items.length > 0 ? (
                  data.disables.items.map(row => (
                    <tr key={row.ticketNo}>
                      <td style={{ fontSize: 11, color: '#64748b' }}>{new Date(row.disabledAt).toLocaleString('zh-CN')}</td>
                      <td style={{ fontWeight: 600, color: '#1e293b' }}>{row.pluginName}</td>
                      <td>{row.version}</td>
                      <td style={{ fontFamily: 'monospace' }}>{row.workspaceId}</td>
                      <td>{row.rule}</td>
                      <td>{row.threshold}</td>
                      <td style={{ color: '#dc2626', fontWeight: 600 }}>{row.actualValue}</td>
                      <td>
                        <span className={`status ${row.recoveryStatus === '已恢复' ? 'success' : row.recoveryStatus === '观察中' ? 'warning' : 'danger'}`}>
                          {row.recoveryStatus}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                      <td>
                        {onWorkOrder && (
                          <button
                            className="row-action"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
                            onClick={() => onWorkOrder(`插件自动禁用 · ${row.pluginName} (${row.ticketNo})`)}
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
                      {loading ? '正在加载数据...' : '当前筛选条件下暂无自动禁用记录'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: 工作区安装实例 */}
        {activeTab === 'instances' && (
          <div className="table-wrap">
            <table data-testid="plugin-instances-table">
              <thead>
                <tr>
                  <th>安装实例 ID</th>
                  <th>插件名称</th>
                  <th>版本</th>
                  <th>Workspace</th>
                  <th>安装人员</th>
                  <th>所属组织</th>
                  <th>状态</th>
                  <th>关联工单</th>
                  <th>安装时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data && data.instances.items.length > 0 ? (
                  data.instances.items.map(row => (
                    <tr key={row.installationId}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.installationId}</td>
                      <td style={{ fontWeight: 500 }}>{row.pluginName}</td>
                      <td>{row.version}</td>
                      <td style={{ fontFamily: 'monospace' }}>{row.workspaceId}</td>
                      <td>{row.account}</td>
                      <td>{row.org}</td>
                      <td>
                        <span className={`status ${row.status === '运行中' ? 'success' : row.status === '待升级' ? 'warning' : 'danger'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                      <td style={{ fontSize: 11, color: '#64748b' }}>{new Date(row.installedAt).toLocaleString('zh-CN')}</td>
                      <td>
                        {onWorkOrder && (
                          <button
                            className="row-action"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
                            onClick={() => onWorkOrder(`插件实例 · ${row.pluginName} (${row.ticketNo})`)}
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
                      当前筛选条件下暂无安装实例
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
