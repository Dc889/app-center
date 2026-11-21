import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts'
import { Database, Activity, AlertTriangle, ShieldCheck, RefreshCw, Search, ArrowRight, Layers, FileCheck } from 'lucide-react'

type Metrics = {
  managedCount: number | null
  sharedCount: number | null
  buildingCount: number | null
  abnormalCount: number | null
  pendingDocCount: number
}

type TaskItem = {
  taskId: string
  source: string
  datasetName: string
  stage: string
  progress: string
  duration: string
  status: string
  ticketNo: string
  updatedAt: string
}

type DocumentAuditItem = {
  documentId: string
  documentName: string
  datasetName: string
  sourceSystem: string
  sha256: string
  autoVerdict: string
  manualVerdict: string
  status: string
  ticketNo: string
  updatedAt: string
}

type AlertItem = {
  alertId: string
  datasetName: string
  reason: string
  operation: string
  status: string
  ticketNo: string
  time: string
}

type KnowledgeMonitorModel = {
  asOf: string
  window: string
  metrics: Metrics
  sources: {
    catalog: 'collected' | 'not_collected'
    tasks: 'collected' | 'not_collected'
  }
  trend: { time: string; total: number; success: number; alert: number; failed: number }[]
  distribution: {
    sources: { name: string; value: number }[]
    status: { name: string; value: number }[]
  }
  failureCategories: { category: string; code: string; count: number }[]
  embeddingModels: { modelName: string; sourceSystem: string; status: string; datasetsCount: number }[]
  tasks: {
    total: number
    page: number
    pageSize: number
    items: TaskItem[]
  }
  documentAudits: DocumentAuditItem[]
  alerts: AlertItem[]
}

export function KnowledgeMonitor({
  role,
  onWorkOrder,
}: {
  role: 'user' | 'ops' | 'admin'
  onWorkOrder?: (title: string) => void
}) {
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h')
  const [sourceSystem, setSourceSystem] = useState<'全部' | 'RAGFlow' | 'Dify'>('全部')
  const [activeTab, setActiveTab] = useState<'tasks' | 'audits' | 'alerts'>('tasks')
  const [keyword, setKeyword] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<KnowledgeMonitorModel | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      window: range,
      page: String(page),
      pageSize: '10',
      sourceSystem,
    })
    if (keyword) params.set('q', keyword)

    fetch(`/api/knowledge-monitor?${params.toString()}`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(res.status === 403 ? '无权限查看知识库监控' : '获取知识库监控数据失败')
        return res.json()
      })
      .then((json: KnowledgeMonitorModel) => {
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
  }, [range, sourceSystem, page, keyword, refresh, role])

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

  const totalPages = data ? Math.max(1, Math.ceil(data.tasks.total / data.tasks.pageSize)) : 1

  return (
    <div className="monitor-container" data-testid="knowledge-monitor">
      <header className="page-header">
        <div>
          
          <h1>知识库监控</h1>
          
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="filter-group" style={{ display: 'flex', gap: 4 }}>
            {(['全部', 'RAGFlow', 'Dify'] as const).map(sys => (
              <button
                key={sys}
                className={`secondary-button ${sourceSystem === sys ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: 12, fontWeight: sourceSystem === sys ? 600 : 400 }}
                onClick={() => { setSourceSystem(sys); setPage(1) }}
              >
                {sys}
              </button>
            ))}
          </div>
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
          <AlertTriangle size={16} /> <span>{error}</span>
        </div>
      )}

      {/* 五大指标卡 */}
      <div className="metric-grid five" data-testid="knowledge-metric-grid" >
        <article className="metric-card">
          <div className="metric-icon tone-1"><Database size={19} /></div>
          <span>纳入管理库</span>
          <strong>{data?.metrics.managedCount !== null && data?.metrics.managedCount !== undefined ? data.metrics.managedCount : '未采集'}</strong>
          <small>{data?.sources.catalog === 'collected' ? '两产品库盘点' : '能力端未接入'}</small>
        </article>

        <article className="metric-card">
          <div className="metric-icon tone-2"><ShieldCheck size={19} /></div>
          <span>已分享库</span>
          <strong>{data?.metrics.sharedCount !== null && data?.metrics.sharedCount !== undefined ? data.metrics.sharedCount : '—'}</strong>
          <small>已安全审批</small>
        </article>

        <article className="metric-card">
          <div className="metric-icon tone-3"><Activity size={19} /></div>
          <span>构建中任务</span>
          <strong>{data?.metrics.buildingCount !== null && data?.metrics.buildingCount !== undefined ? data.metrics.buildingCount : '未采集'}</strong>
          <small>解析 / 切片 / 索引</small>
        </article>

        <article className="metric-card">
          <div className="metric-icon tone-4"><AlertTriangle size={19} /></div>
          <span>异常/处置库</span>
          <strong style={{ color: (data?.metrics.abnormalCount ?? 0) > 0 ? '#dc2626' : undefined }}>
            {data?.metrics.abnormalCount !== null && data?.metrics.abnormalCount !== undefined ? data.metrics.abnormalCount : '未采集'}
          </strong>
          <small>进度停滞或告警</small>
        </article>

        <article className="metric-card">
          <div className="metric-icon tone-5"><FileCheck size={19} /></div>
          <span>待确认文档</span>
          <strong style={{ color: (data?.metrics.pendingDocCount ?? 0) > 0 ? '#d97706' : undefined }}>
            {data ? data.metrics.pendingDocCount : '—'}
          </strong>
          <small>需运维确认</small>
        </article>
      </div>

      {/* 嵌入模型核对与失败分类横幅 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <section className="panel" >
          <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={15} color="#4f46e5" /> 嵌入模型核对
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data?.embeddingModels.map(m => (
              <div key={m.modelName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '6px 10px', background: '#f9fafb', borderRadius: 4 }}>
                <span style={{ fontWeight: 500 }}>{m.modelName} <small style={{ color: '#6b7280' }}>({m.sourceSystem})</small></span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#059669', background: '#ecfdf5', padding: '1px 6px', borderRadius: 3 }}>核对一致</span>
                  <span style={{ color: '#4b5563' }}>{m.datasetsCount} 个库在用</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel" >
          <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={15} color="#dc2626" /> 构建失败分类
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {data?.failureCategories.map(c => (
              <div key={c.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 10px', background: '#f9fafb', borderRadius: 4 }}>
                <span style={{ color: '#4b5563' }}>{c.category}</span>
                <strong style={{ color: c.count > 0 ? '#dc2626' : '#111827' }}>{c.count}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 双列图表 */}
      <div className="dashboard-grid two-column" >
        <section className="panel chart-panel wide">
          <div className="panel-title">
            <div>
              <h3>构建任务趋势</h3>
              
            </div>
          </div>
          <div className="chart-body" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.trend || []} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#edf0f5" vertical={false} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                <YAxis dataKey="total" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e8ebf2', fontSize: 12 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="total" name="任务总量" stroke="#5b6cf9" strokeWidth={2.2} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="success" name="已完成" stroke="#22a98a" strokeWidth={2} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="alert" name="进行中" stroke="#eab308" strokeWidth={1.8} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="failed" name="异常/停滞" stroke="#ef4444" strokeWidth={1.8} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel chart-panel">
          <div className="panel-title">
            <div>
              <h3>来源与状态分布</h3>
              <p>两产品库与在册状态分布</p>
            </div>
          </div>
          <div className="chart-body" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.distribution.sources || []} layout="vertical" margin={{ top: 15, right: 15, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="#edf0f5" horizontal={false} />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={64} axisLine={false} tickLine={false} tick={{ fill: '#667085', fontSize: 11 }} />
                <Tooltip cursor={{ fill: '#f6f7fb' }} contentStyle={{ borderRadius: 8, border: '1px solid #e8ebf2', fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="value" name="知识库数量" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* 台账面板（带 Tab 切换与搜索分页） */}
      <section className="panel table-panel">
        <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div className="tab-group" style={{ display: 'flex', gap: 6, background: '#f3f4f6', padding: 3, borderRadius: 6 }}>
              <button
                className={`tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
                style={{
                  padding: '5px 12px', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer',
                  background: activeTab === 'tasks' ? '#ffffff' : 'transparent',
                  fontWeight: activeTab === 'tasks' ? 600 : 400,
                  boxShadow: activeTab === 'tasks' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
                onClick={() => setActiveTab('tasks')}
              >
                构建任务追踪 ({data?.tasks.total ?? 0})
              </button>
              <button
                className={`tab-btn ${activeTab === 'audits' ? 'active' : ''}`}
                style={{
                  padding: '5px 12px', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer',
                  background: activeTab === 'audits' ? '#ffffff' : 'transparent',
                  fontWeight: activeTab === 'audits' ? 600 : 400,
                  boxShadow: activeTab === 'audits' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
                onClick={() => setActiveTab('audits')}
              >
                逐文档审查台账 ({data?.documentAudits.length ?? 0})
              </button>
              <button
                className={`tab-btn ${activeTab === 'alerts' ? 'active' : ''}`}
                style={{
                  padding: '5px 12px', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer',
                  background: activeTab === 'alerts' ? '#ffffff' : 'transparent',
                  fontWeight: activeTab === 'alerts' ? 600 : 400,
                  boxShadow: activeTab === 'alerts' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
                onClick={() => setActiveTab('alerts')}
              >
                安全与处置追踪 ({data?.alerts.length ?? 0})
              </button>
            </div>
          </div>

          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="搜索任务/文档/知识库/工单号..."
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

        {/* Tab 1: 构建任务追踪 */}
        {activeTab === 'tasks' && (
          <div className="table-wrap">
            <table data-testid="knowledge-tasks-table">
              <thead>
                <tr>
                  <th>任务 ID</th>
                  <th>来源系统</th>
                  <th>知识库名称</th>
                  <th>当前阶段</th>
                  <th>进度</th>
                  <th>持续时长</th>
                  <th>状态</th>
                  <th>关联工单</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data && data.tasks.items.length > 0 ? (
                  data.tasks.items.map(row => (
                    <tr key={row.taskId}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.taskId}</td>
                      <td>
                        <span style={{
                          padding: '2px 6px', borderRadius: 3, fontSize: 11,
                          background: row.source === 'RAGFlow' ? '#e0e7ff' : '#ecfdf5',
                          color: row.source === 'RAGFlow' ? '#3730a3' : '#065f46'
                        }}>
                          {row.source}
                        </span>
                      </td>
                      <td style={{ fontWeight: 500 }}>{row.datasetName}</td>
                      <td>{row.stage}</td>
                      <td>{row.progress}</td>
                      <td>{row.duration}</td>
                      <td>
                        <span className={`status ${row.status === '正常' ? 'success' : row.status === '进行中' ? 'warning' : 'danger'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                      <td>
                        {onWorkOrder && (
                          <button
                            className="row-action"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
                            onClick={() => onWorkOrder(`知识库任务 · ${row.datasetName} (${row.ticketNo})`)}
                          >
                            打开工单 <ArrowRight size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
                      {loading ? '正在加载数据...' : '当前筛选条件下暂无构建任务'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: 逐文档审查台账 */}
        {activeTab === 'audits' && (
          <div className="table-wrap">
            <table data-testid="knowledge-audits-table">
              <thead>
                <tr>
                  <th>文档 ID</th>
                  <th>文档名称</th>
                  <th>知识库</th>
                  <th>来源</th>
                  <th>指纹 (SHA-256)</th>
                  <th>自动结论</th>
                  <th>运维确认</th>
                  <th>关联工单</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data && data.documentAudits.length > 0 ? (
                  data.documentAudits.map(row => (
                    <tr key={row.documentId + row.ticketNo}>
                      <td style={{ fontFamily: 'monospace' }}>{row.documentId}</td>
                      <td style={{ fontWeight: 500 }}>{row.documentName}</td>
                      <td>{row.datasetName}</td>
                      <td>{row.sourceSystem}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.sha256}</td>
                      <td>
                        <span className={`status ${row.autoVerdict === '通过' ? 'success' : 'danger'}`}>
                          {row.autoVerdict}
                        </span>
                      </td>
                      <td>
                        <span className={`status ${row.manualVerdict === '通过' ? 'success' : row.manualVerdict === '不通过' ? 'danger' : 'warning'}`}>
                          {row.manualVerdict}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                      <td>
                        {onWorkOrder && (
                          <button
                            className="row-action"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
                            onClick={() => onWorkOrder(`文档审查 · ${row.documentName} (${row.ticketNo})`)}
                          >
                            打开工单 <ArrowRight size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
                      当前筛选条件下暂无文档审查台账记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: 安全与处置追踪 */}
        {activeTab === 'alerts' && (
          <div className="table-wrap">
            <table data-testid="knowledge-alerts-table">
              <thead>
                <tr>
                  <th>告警编号</th>
                  <th>知识库</th>
                  <th>处置原因</th>
                  <th>处置动作</th>
                  <th>工单状态</th>
                  <th>关联工单</th>
                  <th>触发时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data && data.alerts.length > 0 ? (
                  data.alerts.map(row => (
                    <tr key={row.alertId}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{row.alertId}</td>
                      <td style={{ fontWeight: 500 }}>{row.datasetName}</td>
                      <td>{row.reason}</td>
                      <td>{row.operation}</td>
                      <td>
                        <span className={`status ${row.status === '已完成' ? 'success' : 'warning'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                      <td style={{ fontSize: 11, color: '#6b7280' }}>{new Date(row.time).toLocaleString('zh-CN')}</td>
                      <td>
                        {onWorkOrder && (
                          <button
                            className="row-action"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
                            onClick={() => onWorkOrder(`知识库处置 · ${row.datasetName} (${row.ticketNo})`)}
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
                      当前暂无知识库处置或告警记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页控制 */}
        {activeTab === 'tasks' && totalPages > 1 && (
          <div className="pagination" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid #f3f4f6' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              共 {data?.tasks.total ?? 0} 条任务，第 {page} / {totalPages} 页
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
