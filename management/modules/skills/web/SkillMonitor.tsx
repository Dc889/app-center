import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts'
import { Download, AlertTriangle, ShieldCheck, RefreshCw, Search } from 'lucide-react'

type Metrics = {
  publishedCount: number | null
  pendingCount: number
  withdrawnCount: number
  versionCount: number | null
  storageBytes: number | null
  storageFormatted: string | null
  deliveryFailures: number
}

type DeliveryItem = {
  deliveryId: string
  time: string
  account: string
  name: string
  org: string
  skillId: string
  skillName: string
  version: string
  sha256: string
  fullSha256?: string
  status: string
  ticketNo: string
}

type SkillMonitorModel = {
  asOf: string
  window: string
  metrics: Metrics
  trend: { time: string; success: number; failed: number; total: number }[]
  orgDistribution: { name: string; value: number }[]
  deliveries: {
    total: number
    page: number
    pageSize: number
    items: DeliveryItem[]
  }
  uniqueAccounts: number
  sources: {
    catalog: 'collected' | 'not_collected' | 'stale'
    deliveries: 'collected'
  }
}

export function SkillMonitor({ role }: { role: 'user' | 'ops' | 'admin' }) {
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h')
  const [keyword, setKeyword] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SkillMonitorModel | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ window: range, page: String(page), pageSize: '10' })
    if (keyword) params.set('q', keyword)

    fetch(`/api/skill-monitor?${params.toString()}`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(res.status === 403 ? '无权限查看 Skill 监控' : '获取监控数据失败')
        return res.json()
      })
      .then((json: SkillMonitorModel) => {
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
    setLoading(true)
    setPage(1)
    setKeyword(queryInput.trim())
    setRefresh(n => n + 1)
  }

  const formatTime = (ts: string) => {
    if (!ts) return '-'
    const d = new Date(ts)
    return isNaN(d.getTime()) ? ts : d.toLocaleString('zh-CN', { hour12: false })
  }

  return (
    <div className="skill-monitor-page" data-testid="real-skill-monitor">
      <div className="page-header">
        <div>
          
          <h1>Skill 监控</h1>
          
        </div>
        <div className="monitor-actions">
          <div className="time-filter">
            <button className={range === '1h' ? 'active' : ''} onClick={() => { setPage(1); reload('1h'); }}>1 小时</button>
            <button className={range === '24h' ? 'active' : ''} onClick={() => { setPage(1); reload('24h'); }}>24 小时</button>
            <button className={range === '7d' ? 'active' : ''} onClick={() => { setPage(1); reload('7d'); }}>7 天</button>
          </div>
          <button className="secondary-button" onClick={() => reload()} title="刷新数据" disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> 刷新
          </button>
        </div>
      </div>

      {loading && <p role="status">正在读取 Skill 监控数据…</p>}
      {error && <div className="alert-error" role="alert">{error}</div>}

      {data && (
        <>
          <div className="data-source-hint">
            <span>
              数据采集时间：{formatTime(data.asOf)} · 目录数据源：{data.sources.catalog === 'collected' ? '已采集 (真实Skill仓库)' : '未采集 (安全降级)'} · 结算台账：已采集 (SQLite 事务流水)
            </span>
          </div>

          {/* 五大指标卡 */}
          <div className="metric-grid five">
            <article className="metric-card">
              <div className="metric-icon tone-1"><Download size={19} /></div>
              <span>已上架 Skill</span>
              <strong>{data.metrics.publishedCount !== null ? data.metrics.publishedCount : '未采集'}</strong>
              <small>{data.sources.catalog === 'collected' ? '来自生效目录' : '目录未采集'}</small>
            </article>

            <article className="metric-card">
              <div className="metric-icon tone-2"><ShieldCheck size={19} /></div>
              <span>待审核工单</span>
              <strong>{data.metrics.pendingCount}</strong>
              <small>上架 / 变更 / 下架待办</small>
            </article>

            <article className="metric-card">
              <div className="metric-icon tone-3"><AlertTriangle size={19} /></div>
              <span>已下架 Skill</span>
              <strong>{data.metrics.withdrawnCount}</strong>
              <small>已下架完成记录</small>
            </article>

            <article className="metric-card">
              <div className="metric-icon tone-4"><Download size={19} /></div>
              <span>版本总数</span>
              <strong>{data.metrics.versionCount !== null ? data.metrics.versionCount : '未采集'}</strong>
              <small>{data.metrics.storageFormatted ? `总存储 ${data.metrics.storageFormatted}` : '存储未采集'}</small>
            </article>

            <article className="metric-card">
              <div className="metric-icon tone-5"><AlertTriangle size={19} /></div>
              <span>交付失败 / 取消</span>
              <strong>{data.metrics.deliveryFailures}</strong>
              <small>终态失败或中断次数</small>
            </article>
          </div>

          {/* 图表展示区 */}
          <div className="dashboard-grid two-column">
            <section className="chart-panel wide">
              <div className="panel-header">
                <div>
                  <h3>下载趋势</h3>
                  <small>成功下载 / 失败或取消次数（{range} 窗口）</small>
                </div>
              </div>
              <div style={{ width: '100%', height: 230 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="#edf0f5" vertical={false} />
                    <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8ebf2' }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="success" name="成功下载" stroke="#22a98a" strokeWidth={2.2} dot={false} />
                    <Line isAnimationActive={false} type="monotone" dataKey="failed" name="失败/取消" stroke="#ed795e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="chart-panel">
              <div className="panel-header">
                <div>
                  <h3>下载人组织分布</h3>
                  <small>成功交付人员所属组织（已去重 {data.uniqueAccounts} 人）</small>
                </div>
              </div>
              <div style={{ width: '100%', height: 230 }}>
                {data.orgDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.orgDistribution} layout="vertical" margin={{ top: 5, right: 10, left: 5, bottom: 0 }}>
                      <CartesianGrid stroke="#edf0f5" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={75} axisLine={false} tickLine={false} tick={{ fill: '#667085', fontSize: 11 }} />
                      <Tooltip cursor={{ fill: '#f6f7fb' }} contentStyle={{ borderRadius: 10, border: '1px solid #e8ebf2' }} />
                      <Bar isAnimationActive={false} dataKey="value" name="下载次数" fill="#7168ed" radius={[0, 5, 5, 0]} barSize={12} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-chart"><p>当前时间窗口暂无下载记录</p></div>
                )}
              </div>
            </section>
          </div>

          {/* 下载明细结算流水 */}
          <section className="panel table-panel">
            <div className="panel-header table-header">
              <div>
                <h3>下载明细（结算流水台账）</h3>
                <small>共 {data.deliveries.total} 条交付记录，当前窗口成功去重账户数：{data.uniqueAccounts}</small>
              </div>
              <form onSubmit={handleSearch} className="filter-form">
                <div className="search-box">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="搜索流水号/Skill/工单/账户..."
                    value={queryInput}
                    onChange={e => setQueryInput(e.target.value)}
                  />
                </div>
                <button type="submit" className="secondary-button">查询</button>
              </form>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>流水号</th>
                    <th>时间</th>
                    <th>账户名</th>
                    <th>姓名</th>
                    <th>组织</th>
                    <th>Skill</th>
                    <th>版本</th>
                    <th>文件指纹</th>
                    <th>状态</th>
                    <th>工单号</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deliveries.items.length > 0 ? (
                    data.deliveries.items.map(row => (
                      <tr key={row.ticketNo + row.deliveryId}>
                        <td className="code-font">{row.deliveryId || '-'}</td>
                        <td>{formatTime(row.time)}</td>
                        <td>{row.account}</td>
                        <td>{row.name}</td>
                        <td>{row.org}</td>
                        <td><strong>{row.skillName}</strong></td>
                        <td>{row.version}</td>
                        <td className="code-font" title={row.fullSha256}>{row.sha256}</td>
                        <td>
                          <span className={`status-pill ${row.status === '成功' ? 'success' : row.status === '失败' ? 'danger' : 'neutral'}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="code-font">{row.ticketNo}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '24px 0', color: '#8892a4' }}>
                        暂无符合条件的下载记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页控制栏 */}
            {data.deliveries.total > 0 && (
              <div className="pagination-bar">
                <span>
                  第 {data.deliveries.page} 页，共 {Math.ceil(data.deliveries.total / data.deliveries.pageSize)} 页（共 {data.deliveries.total} 条）
                </span>
                <div className="pagination-buttons">
                  <button
                    className="secondary-button"
                    disabled={data.deliveries.page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  <button
                    className="secondary-button"
                    disabled={data.deliveries.page * data.deliveries.pageSize >= data.deliveries.total}
                    onClick={() => setPage(p => p + 1)}
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
