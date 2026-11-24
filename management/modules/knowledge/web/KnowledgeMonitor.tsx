import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, AlertTriangle, ArrowRight, Database, FileCheck, RefreshCw, Search, ShieldCheck } from 'lucide-react'

type Metrics = {
  managedCount: number | null
  sharedCount: number | null
  buildingCount: number | null
  abnormalCount: number | null
  pendingDocCount: number
}

type SubsystemCount = { name: string; datasetCount: number; documentCount: number | null }

type SecurityAudit = {
  scene: string
  datasetName: string
  applicant: string
  org: string
  keywordScan: string
  subsystemScan: string
  shareScope: string
  status: string
  ticketNo: string
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

type KnowledgeMonitorModel = {
  metrics: Metrics
  sources: { catalog: 'collected' | 'not_collected' }
  trend: { time: string; total: number; success: number; alert: number; failed: number }[]
  tasks: { total: number; page: number; pageSize: number; items: TaskItem[] }
  quantity?: {
    subsystems: { source: 'collected' | 'not_collected'; items: SubsystemCount[] }
    warehouseListed: number
    warehousePending: number
  }
  securityAudits?: SecurityAudit[]
}

function countText(value: number | null | undefined) {
  return value === null || value === undefined ? '未采集' : String(value)
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
  const [auditScene, setAuditScene] = useState<'全部' | '上架审核' | '范围内使用申请' | '范围外使用申请'>('全部')
  const [keyword, setKeyword] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<KnowledgeMonitorModel | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ window: range, page: String(page), pageSize: '10', sourceSystem })
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
        if (!controller.signal.aborted) setError(err.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [range, sourceSystem, page, keyword, refresh, role])

  const reload = (nextRange = range) => {
    setLoading(true)
    setError(null)
    setRange(nextRange)
    setRefresh(n => n + 1)
  }
  const totalPages = data ? Math.max(1, Math.ceil(data.tasks.total / data.tasks.pageSize)) : 1
  const subsystems = data?.quantity?.subsystems
  const audits = (data?.securityAudits ?? []).filter(row => auditScene === '全部' || row.scene === auditScene)

  return (
    <div className="monitor-container" data-testid="knowledge-monitor">
      <header className="page-header">
        <div><h1>知识库监控</h1></div>
        <div className="header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="filter-group" style={{ display: 'flex', gap: 4 }}>
            {(['全部', 'RAGFlow', 'Dify'] as const).map(sys => (
              <button key={sys} className={`secondary-button ${sourceSystem === sys ? 'active' : ''}`} style={{ padding: '4px 10px', fontSize: 12, fontWeight: sourceSystem === sys ? 600 : 400 }} onClick={() => { setSourceSystem(sys); setPage(1) }}>{sys}</button>
            ))}
          </div>
          <div className="time-filter">
            <button className={range === '1h' ? 'active' : ''} onClick={() => reload('1h')}>1 小时</button>
            <button className={range === '24h' ? 'active' : ''} onClick={() => reload('24h')}>24 小时</button>
            <button className={range === '7d' ? 'active' : ''} onClick={() => reload('7d')}>7 天</button>
          </div>
          <button className="icon-button" onClick={() => reload()} title="刷新" disabled={loading}><RefreshCw size={15} className={loading ? 'spinning' : ''} /></button>
        </div>
      </header>
      {error && <div className="alert-banner error" style={{ margin: '16px 0', padding: 12, borderRadius: 6, background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c' }}><AlertTriangle size={16} /> <span>{error}</span></div>}

      <section className="panel" data-testid="knowledge-quantity" style={{ marginBottom: 16 }}>
        <div className="panel-title"><div><h3><Database size={15} /> 数量监控</h3><p>子系统数量统计的是子系统里的全部知识库，不是知识库仓库里的上架数量。</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>子系统</th><th>知识库数量</th><th>文档数量</th></tr></thead>
            <tbody>
              {subsystems?.source === 'collected' && subsystems.items.length > 0 ? subsystems.items.map(row => (
                <tr key={row.name}><td>{row.name}</td><td>{row.datasetCount}</td><td>{countText(row.documentCount)}</td></tr>
              )) : (
                <tr><td colSpan={3}>子系统库存未采集</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="metric-grid four" data-testid="knowledge-metric-grid" style={{ marginTop: 16 }}>
          <article className="metric-card"><div className="metric-icon tone-2"><ShieldCheck size={19} /></div><span>仓库已上架</span><strong>{data ? data.quantity?.warehouseListed ?? 0 : '—'}</strong><small>审核通过并进入知识库仓库</small></article>
          <article className="metric-card"><div className="metric-icon tone-5"><FileCheck size={19} /></div><span>待审核</span><strong>{data ? data.quantity?.warehousePending ?? 0 : '—'}</strong><small>上架申请尚未办结</small></article>
          <article className="metric-card"><div className="metric-icon tone-3"><Activity size={19} /></div><span>构建中任务</span><strong>{countText(data?.metrics.buildingCount)}</strong><small>{data?.sources.catalog === 'collected' ? '子系统构建任务' : '能力端未接入'}</small></article>
          <article className="metric-card"><div className="metric-icon tone-4"><AlertTriangle size={19} /></div><span>异常知识库</span><strong>{countText(data?.metrics.abnormalCount)}</strong><small>构建失败或异常状态</small></article>
        </div>
      </section>

      <section className="panel chart-panel" data-testid="knowledge-build" style={{ marginBottom: 16 }}>
        <div className="panel-title"><div><h3>构建过程监控</h3><p>构建任务趋势按所选时间窗统计，下面的表跟踪每个构建任务。</p></div></div>
        <div className="chart-body" style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data?.trend || []} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#edf0f5" vertical={false} />
              <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e8ebf2', fontSize: 12 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="total" name="任务总量" stroke="#5b6cf9" strokeWidth={2.2} dot={false} />
              <Line isAnimationActive={false} type="monotone" dataKey="success" name="已完成" stroke="#22a98a" strokeWidth={2} dot={false} />
              <Line isAnimationActive={false} type="monotone" dataKey="alert" name="进行中" stroke="#eab308" strokeWidth={1.8} dot={false} />
              <Line isAnimationActive={false} type="monotone" dataKey="failed" name="异常" stroke="#ef4444" strokeWidth={1.8} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h3>构建任务追踪 ({data?.tasks.total ?? 0})</h3>
          <form onSubmit={event => { event.preventDefault(); setKeyword(queryInput.trim()); setPage(1) }} style={{ display: 'flex', gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <input aria-label="搜索构建任务" placeholder="搜索任务、知识库或工单号..." value={queryInput} onChange={event => setQueryInput(event.target.value)} style={{ padding: '6px 12px 6px 28px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', width: 220 }} />
              <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
            </div>
            <button type="submit" className="secondary-button" style={{ padding: '6px 12px', fontSize: 12 }}>搜索</button>
          </form>
        </div>
        <div className="table-wrap">
          <table data-testid="knowledge-tasks-table">
            <thead><tr><th>任务 ID</th><th>来源系统</th><th>知识库名称</th><th>当前阶段</th><th>进度</th><th>持续时长</th><th>状态</th><th>关联工单</th><th>操作</th></tr></thead>
            <tbody>
              {data && data.tasks.items.length > 0 ? data.tasks.items.map(row => (
                <tr key={row.taskId}>
                  <td style={{ fontFamily: 'monospace' }}>{row.taskId}</td>
                  <td>{row.source}</td>
                  <td>{row.datasetName}</td>
                  <td>{row.stage}</td>
                  <td>{row.progress}</td>
                  <td>{row.duration || '未采集'}</td>
                  <td>{row.status}</td>
                  <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                  <td>{onWorkOrder && <button className="row-action" onClick={() => onWorkOrder(`知识库任务 · ${row.datasetName} (${row.ticketNo})`)}>打开工单 <ArrowRight size={12} /></button>}</td>
                </tr>
              )) : <tr><td colSpan={9}>{loading ? '正在加载数据...' : '当前筛选条件下暂无构建任务'}</td></tr>}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="pagination" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px' }}>
            <span>共 {data?.tasks.total ?? 0} 条任务，第 {page} / {totalPages} 页</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="secondary-button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
              <button className="secondary-button" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>下一页</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel table-panel" data-testid="knowledge-security-audit">
        <div className="panel-title">
          <div>
            <h3><ShieldCheck size={15} /> 安全审计监控</h3>
            <p>上架审核检查敏感词扫描、子平台安全扫描确认和分享范围。使用申请区分为仓库内可用范围，以及超出组织或指定范围的申请。</p>
          </div>
        </div>
        <div className="usable-switch" style={{ marginBottom: 12 }}>
          {(['全部', '上架审核', '范围内使用申请', '范围外使用申请'] as const).map(scene => (
            <button key={scene} type="button" className={auditScene === scene ? 'active' : ''} onClick={() => setAuditScene(scene)}>{scene}</button>
          ))}
        </div>
        <div className="table-wrap">
          <table data-testid="knowledge-audits-table">
            <thead><tr><th>审计事项</th><th>知识库</th><th>申请人</th><th>组织</th><th>敏感词扫描</th><th>子平台安全扫描</th><th>分享范围</th><th>状态</th><th>关联工单</th><th>操作</th></tr></thead>
            <tbody>
              {audits.length > 0 ? audits.map(row => (
                <tr key={row.ticketNo}>
                  <td>{row.scene}</td>
                  <td>{row.datasetName}</td>
                  <td>{row.applicant}</td>
                  <td>{row.org || '未采集'}</td>
                  <td>{row.keywordScan}</td>
                  <td>{row.subsystemScan}</td>
                  <td>{row.shareScope}</td>
                  <td>{row.status}</td>
                  <td style={{ fontFamily: 'monospace' }}>{row.ticketNo}</td>
                  <td>{onWorkOrder && <button className="row-action" onClick={() => onWorkOrder(`知识库审计 · ${row.datasetName} (${row.ticketNo})`)}>打开工单 <ArrowRight size={12} /></button>}</td>
                </tr>
              )) : <tr><td colSpan={10}>当前没有符合筛选的安全审计记录</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
