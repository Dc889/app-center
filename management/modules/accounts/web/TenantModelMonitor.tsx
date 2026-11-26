import {useEffect, useRef, useState} from 'react'
import {Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts'
import {ArrowRight, Cpu, RefreshCw, Search, ShieldAlert, Users} from 'lucide-react'
import type {View} from '../../../shared-ui/UiContextData'

type TenantRow = {
  account: string
  name: string
  email: string
  org: string
  active: boolean
  workspaceId: string
  workspaceName: string
  appsCount: number
  datasetsCount: number
  pluginsCount: number
  mcpCount: number
  apiKeysCount: number
  monthlyTokens: number
  totalTokens: number
  monthlyCalls: number
  totalCalls: number
  modelsCount: number
  exceededModels: number
  warningModels: number
  disabledModels: number
}

type ModelQuotaItem = {
  key: string
  workspaceId: string
  workspaceName: string
  ownerAccount: string
  ownerName: string
  org: string
  providerName: string
  modelName: string
  modelType: string
  enabled: boolean
  period: 'monthly' | 'total'
  usedTokens: number
  usedCalls: number
  monthlyTokens: number
  monthlyCalls: number
  totalTokens: number
  totalCalls: number
  tokenLimit: number | null
  callLimit: number | null
  tokenPercent: number | null
  callPercent: number | null
  autoDisable: boolean
  exceeded: boolean
  warning: boolean
  quotaStatus: string
  note: string
}

type ModelQuotaTicket = {
  ticketNo: string
  operationType?: string
  workspaceName: string
  modelName: string
  requestedTokenLimit: number | null
  requestedCallLimit: number | null
  reason: string
  applicantName: string
  org: string
  status: string
  createdAt: string
  reviewNote: string | null
}

type Report = {
  capturedAt: string
  syncedAt: string | null
  summary: {
    total: number
    configured: number
    exceeded: number
    warning: number
    disabled: number
    pendingTickets: number
    totalTenants: number
    totalMonthlyTokens: number
    totalMonthlyCalls: number
    totalApps: number
    totalDatasets: number
  }
  tenants: TenantRow[]
  items: ModelQuotaItem[]
  tickets: ModelQuotaTicket[]
}

function pillTone(status: string) {
  if (status === '已批准' || status === '正常' || status === '已启用') return 'tone-success'
  if (status === '已驳回' || status === '已禁用' || status.includes('超限')) return 'tone-danger'
  if (status === '待审批' || status.includes('预警')) return 'tone-pending'
  return 'tone-muted'
}

type ModelBatchSnapshot = {
  canApprove: boolean
  uniqueModels: {
    key: string
    providerName: string
    modelName: string
    modelType: string
    configuredWorkspacesCount: number
    enabledWorkspacesCount: number
    totalWorkspacesCount: number
    monthlyTokens: number
    monthlyCalls: number
  }[]
  templates: {providerName: string; modelName: string; endpointUrl: string}[]
  tickets: {
    ticketNo: string
    operationType: string
    providerName: string | null
    modelName: string | null
    targetWorkspaceName: string | null
    reason: string
    applicantName: string
    status: string
    executionSummary: string | null
    reviewNote: string | null
  }[]
}

export function TenantModelMonitor({
  role,
  onNavigate,
}: {
  role: 'user' | 'ops' | 'admin'
  onNavigate?: (view: View, ticketType?: string | null) => void
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [batchData, setBatchData] = useState<ModelBatchSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [revision, setRevision] = useState(0)

  const [tenantSearch, setTenantSearch] = useState('')
  const [selectedWs, setSelectedWs] = useState('')
  const modelSectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const c = new AbortController()
    setLoading(true)
    Promise.all([
      fetch('/api/model-quotas', {signal: c.signal}).then(async r => {
        if (!r.ok) throw new Error('读取租户与模型监控数据失败')
        return r.json()
      }),
      fetch('/api/model-batch', {signal: c.signal}).then(async r => (r.ok ? r.json() : null)),
    ])
      .then(([data, batch]) => {
        if (!c.signal.aborted) {
          setReport(data)
          if (batch) setBatchData(batch)
          setErr('')
        }
      })
      .catch(e => {
        if (!c.signal.aborted) setErr(e?.message || '读取失败')
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false)
      })
    return () => c.abort()
  }, [revision, role])

  const openMod01Ticket = (item: ModelQuotaItem, operationType: '配置额度' | '禁用模型' | '恢复启用') => {
    try {
      sessionStorage.setItem('mod01-prefill', JSON.stringify({key: item.key, operationType}))
    } catch {}
    onNavigate?.('manual', 'MOD-01')
  }

  const openMod02Ticket = (prefill: Record<string, string>) => {
    try {
      sessionStorage.setItem('mod02-prefill', JSON.stringify(prefill))
    } catch {}
    onNavigate?.('manual', 'MOD-02')
  }

  const reviewBatchTicket = async (ticketNo: string, decision: 'approve' | 'reject') => {
    setBusy(ticketNo); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/model-batch/approve', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ticketNo, decision}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || body?.error?.message || '审批执行失败')
      setMsg(decision === 'approve' ? (body.executionSummary || `工单 ${ticketNo} 已审批执行`) : `工单 ${ticketNo} 已驳回`)
      setRevision(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '审批执行失败')
    } finally {
      setBusy('')
    }
  }

  const focusWorkspaceModels = (workspaceId: string) => {
    setSelectedWs(workspaceId)
    setTimeout(() => {
      modelSectionRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'})
    }, 50)
  }

  const runSweep = async () => {
    setBusy('sweep'); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/model-quotas/enforce', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: '{}',
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '同步与巡检失败')
      setMsg(`已完成 Dify 资产与模型用量同步，核查 ${body.checked ?? 0} 个模型实例，新触发超限熔断 ${body.disabled?.length ?? 0} 个`)
      setRevision(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '同步与巡检失败')
    } finally {
      setBusy('')
    }
  }

  const reviewTicket = async (ticketNo: string, decision: 'approve' | 'reject') => {
    setBusy(ticketNo); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/model-quotas/approve', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ticketNo, decision}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '审批失败')
      setMsg(decision === 'approve' ? `工单 ${ticketNo} 已批准并执行生效` : `工单 ${ticketNo} 已驳回`)
      setRevision(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '审批失败')
    } finally {
      setBusy('')
    }
  }

  const q = tenantSearch.trim().toLowerCase()
  const filteredTenants = (report?.tenants ?? []).filter(t =>
    !q || [t.account, t.name, t.org, t.workspaceName, t.email].some(v => String(v || '').toLowerCase().includes(q)),
  )
  const filteredModels = (report?.items ?? []).filter(m => !selectedWs || m.workspaceId === selectedWs)
  const selectedTenant = (report?.tenants ?? []).find(t => t.workspaceId === selectedWs) ?? null
  const chartData = (report?.tenants ?? []).slice(0, 10).map(t => ({
    name: t.name || t.account,
    appsCount: t.appsCount,
    datasetsCount: t.datasetsCount,
    monthlyTokens: t.monthlyTokens,
  }))

  return (
    <div data-testid="tenant-model-monitor" className="org-page-stack">
      <div className="page-header">
        <div>
          <h1>租户资产与模型用量监控</h1>
          <p>
            实时汇总各账号应用、知识库、插件、MCP 规模与模型消耗；所有配额调整与模型禁启操作均须通过 MOD-01 工单审批执行。
            {report?.syncedAt ? ` 最近同步：${new Date(report.syncedAt).toLocaleString('zh-CN', {hour12: false})}` : ''}
          </p>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button type="button" className="secondary-button" disabled={!!busy || loading} onClick={runSweep} style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
            <RefreshCw size={14} />
            {busy === 'sweep' ? '同步巡检中…' : '刷新用量并巡检'}
          </button>
          <button type="button" className="primary-button" onClick={() => onNavigate?.('manual', 'MOD-01')} style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
            发起配额工单 <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {err && <p role="alert" style={{color: '#b42318', margin: 0, fontSize: 13}}>{err}</p>}
      {msg && <p role="status" style={{color: '#027a48', fontWeight: 500, margin: 0, fontSize: 13}}>{msg}</p>}
      {loading && !report && <p role="status">正在加载租户资产与模型用量…</p>}

      {report && (
        <>
          <div className="metric-grid five">
            <article className="metric-card">
              <span>纳管账号</span>
              <strong>{report.summary.totalTenants}</strong>
              <small>应用 {report.summary.totalApps} · 知识库 {report.summary.totalDatasets}</small>
            </article>
            <article className="metric-card">
              <span>本月总 Token</span>
              <strong>{report.summary.totalMonthlyTokens.toLocaleString()}</strong>
              <small>本月调用 {report.summary.totalMonthlyCalls.toLocaleString()} 次</small>
            </article>
            <article className="metric-card">
              <span>纳管模型实例</span>
              <strong>{report.summary.total}</strong>
              <small>已配置限额 {report.summary.configured} 个</small>
            </article>
            <article className="metric-card">
              <span>超限 / 预警</span>
              <strong style={{color: report.summary.exceeded > 0 ? '#b42318' : undefined}}>{report.summary.exceeded} / {report.summary.warning}</strong>
              <small>每 60 秒自动巡检</small>
            </article>
            <article className="metric-card">
              <span>已禁用 / 待审工单</span>
              <strong style={{color: report.summary.disabled > 0 ? '#b42318' : undefined}}>{report.summary.disabled} / {report.summary.pendingTickets}</strong>
              <small>MOD-01 审批后自动生效</small>
            </article>
          </div>

          {chartData.length > 0 && (
            <section className="panel overview-block">
              <h3 style={{marginTop: 0, display: 'flex', alignItems: 'center', gap: 6}}>
                <Users size={16} />
                各账号资产规模与本月 Token 消耗 Top 10
              </h3>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16}}>
                <div style={{height: 240}}>
                  <div style={{fontSize: 12, color: '#667085', marginBottom: 6}}>本月 Token 消耗排行</div>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={chartData}>
                      <CartesianGrid stroke="#edf0f5" />
                      <XAxis dataKey="name" tick={{fontSize: 11}} />
                      <YAxis allowDecimals={false} tick={{fontSize: 11}} />
                      <Tooltip />
                      <Bar dataKey="monthlyTokens" name="本月 Token" fill="#2563eb" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{height: 240}}>
                  <div style={{fontSize: 12, color: '#667085', marginBottom: 6}}>应用数与知识库数分布</div>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={chartData}>
                      <CartesianGrid stroke="#edf0f5" />
                      <XAxis dataKey="name" tick={{fontSize: 11}} />
                      <YAxis allowDecimals={false} tick={{fontSize: 11}} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="appsCount" name="应用数" fill="#4f46e5" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="datasetsCount" name="知识库数" fill="#10b981" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          )}

          <section className="panel overview-block">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12}}>
              <h3 style={{margin: 0}}>账号资产与模型用量全景 <span className="workorder-tab-badge">{filteredTenants.length}</span></h3>
              <div style={{position: 'relative'}}>
                <Search size={14} style={{position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#98a2b3'}} />
                <input
                  value={tenantSearch}
                  onChange={e => setTenantSearch(e.target.value)}
                  placeholder="搜索姓名、账号、组织或工作区"
                  style={{paddingLeft: 30, width: 240}}
                />
              </div>
            </div>
            <div className="org-table-wrap">
              <table className="org-table">
                <thead>
                  <tr>
                    <th>姓名 / 账号</th>
                    <th>所属组织</th>
                    <th>状态</th>
                    <th>应用数</th>
                    <th>知识库</th>
                    <th>插件</th>
                    <th>MCP</th>
                    <th>已配模型</th>
                    <th>本月 Token</th>
                    <th>本月调用</th>
                    <th>管控状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTenants.map(t => (
                    <tr key={t.account} style={{background: selectedWs && selectedWs === t.workspaceId ? '#eff8ff' : undefined}}>
                      <td>
                        <strong>{t.name}</strong>
                        <div style={{fontSize: 12, color: '#667085'}}>{t.account}{t.workspaceName ? ` · ${t.workspaceName}` : ''}</div>
                      </td>
                      <td>{t.org}</td>
                      <td>
                        <span className={`app-status-pill ${t.active ? 'tone-success' : 'tone-danger'}`}>{t.active ? '正常' : '已停用'}</span>
                      </td>
                      <td style={{fontWeight: 600}}>{t.appsCount}</td>
                      <td>{t.datasetsCount}</td>
                      <td>{t.pluginsCount}</td>
                      <td>{t.mcpCount}</td>
                      <td>{t.modelsCount}</td>
                      <td style={{fontFamily: 'monospace', fontWeight: t.monthlyTokens > 0 ? 600 : 400}}>{t.monthlyTokens.toLocaleString()}</td>
                      <td style={{fontFamily: 'monospace'}}>{t.monthlyCalls}</td>
                      <td>
                        {t.exceededModels > 0 || t.disabledModels > 0
                          ? <span className="app-status-pill tone-danger">熔断 {Math.max(t.exceededModels, t.disabledModels)}</span>
                          : t.warningModels > 0
                            ? <span className="app-status-pill tone-pending">预警 {t.warningModels}</span>
                            : <span className="app-status-pill tone-success">正常</span>}
                      </td>
                      <td>
                        {t.workspaceId ? (
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => focusWorkspaceModels(t.workspaceId)}
                          >
                            查看模型额度
                          </button>
                        ) : <span style={{fontSize: 12, color: '#98a2b3'}}>无工作区</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section ref={modelSectionRef} className="panel overview-block" style={{scrollMarginTop: 80}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
                <h3 style={{margin: 0, display: 'flex', alignItems: 'center', gap: 6}}>
                  <Cpu size={16} />
                  工作区模型额度与熔断台账 <span className="workorder-tab-badge">{filteredModels.length}</span>
                </h3>
                {selectedTenant && (
                  <span className="app-status-pill tone-progress">
                    已定位：{selectedTenant.name} · {selectedTenant.workspaceName}
                  </span>
                )}
              </div>
              {selectedWs && (
                <button type="button" className="secondary-button compact" onClick={() => setSelectedWs('')}>
                  查看全部工作区
                </button>
              )}
            </div>

            <div className="org-table-wrap">
              <table className="org-table">
                <thead>
                  <tr>
                    <th>工作区 / 负责人</th>
                    <th>所属组织</th>
                    <th>模型名称</th>
                    <th>周期</th>
                    <th>Token 消耗 / 额度</th>
                    <th>调用次数 / 上限</th>
                    <th>Dify 开关</th>
                    <th>配额状态</th>
                    <th>工单操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModels.length > 0 ? filteredModels.map(item => (
                    <tr key={item.key}>
                      <td>{item.workspaceName}<div style={{fontSize: 12, color: '#667085'}}>{item.ownerName} · {item.ownerAccount}</div></td>
                      <td>{item.org}</td>
                      <td><strong>{item.modelName}</strong><div style={{fontSize: 12, color: '#667085'}}>{item.providerName.split('/').at(-1)}</div></td>
                      <td>{item.period === 'monthly' ? '本月' : '累计'}</td>
                      <td style={{fontFamily: 'monospace', minWidth: 170}}>
                        <div>{item.usedTokens.toLocaleString()} / {item.tokenLimit ? item.tokenLimit.toLocaleString() : '不限'}{item.tokenPercent !== null ? ` · ${item.tokenPercent}%` : ''}</div>
                        {item.tokenPercent !== null && (
                          <div style={{height: 6, background: '#e4e7ec', borderRadius: 3, marginTop: 4, overflow: 'hidden'}}>
                            <div style={{height: '100%', width: `${Math.min(100, item.tokenPercent)}%`, background: item.tokenPercent >= 100 ? '#b42318' : item.tokenPercent >= 80 ? '#b54708' : '#175cd3'}} />
                          </div>
                        )}
                      </td>
                      <td style={{fontFamily: 'monospace'}}>
                        {item.usedCalls} / {item.callLimit ?? '不限'}{item.callPercent !== null ? ` · ${item.callPercent}%` : ''}
                      </td>
                      <td>
                        <span className={`app-status-pill ${item.enabled ? 'tone-success' : 'tone-danger'}`}>{item.enabled ? '已启用' : '已禁用'}</span>
                      </td>
                      <td>
                        <span className={`app-status-pill ${pillTone(item.quotaStatus)}`}>{item.quotaStatus}</span>
                      </td>
                      <td>
                        <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                          <button type="button" className="secondary-button compact" onClick={() => openMod01Ticket(item, '配置额度')}>
                            配置配额工单
                          </button>
                          {item.enabled ? (
                            <button type="button" className="secondary-button compact" style={{color: '#b42318'}} onClick={() => openMod01Ticket(item, '禁用模型')}>
                              禁用工单
                            </button>
                          ) : (
                            <button type="button" className="secondary-button compact" style={{color: '#027a48'}} onClick={() => openMod01Ticket(item, '恢复启用')}>
                              恢复工单
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={9} style={{textAlign: 'center', padding: '28px 0', color: '#667085'}}>
                        {selectedTenant
                          ? `${selectedTenant.name}（${selectedTenant.workspaceName}）暂未配置可用模型或暂无调用记录`
                          : '暂未扫描到已配置的 Dify 模型实例'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {batchData && (
            <section className="panel overview-block" data-testid="model-batch-panel">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12}}>
                <div>
                  <h3 style={{margin: 0}}>全员模型批量配置与下线管控 · MOD-02</h3>
                  <div style={{fontSize: 12, color: '#667085', marginTop: 2}}>
                    统一向全平台所有 Dify 账号配置并按租户公钥加密下发模型、新户默认配齐或全员批量删除下线
                  </div>
                </div>
                <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                  <button type="button" className="primary-button" onClick={() => openMod02Ticket({operationType: '全员统一配置模型'})}>
                    全员统一配置模型
                  </button>
                  <button type="button" className="secondary-button" onClick={() => openMod02Ticket({operationType: '新户默认配齐公共模型'})}>
                    新户默认配齐公共模型
                  </button>
                </div>
              </div>

              <div className="org-table-wrap" style={{marginBottom: batchData.tickets.length > 0 ? 16 : 0}}>
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>模型名称</th><th>供应商</th><th>模型类型</th><th>租户覆盖</th><th>本月 Token</th><th>全员批量管控工单</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchData.uniqueModels.length > 0 ? batchData.uniqueModels.map(m => (
                      <tr key={m.key}>
                        <td style={{fontWeight: 600}}>{m.modelName}</td>
                        <td><code className="org-code">{m.providerName}</code></td>
                        <td>{m.modelType}</td>
                        <td>{m.configuredWorkspacesCount} / {m.totalWorkspacesCount} 租户（启用 {m.enabledWorkspacesCount}）</td>
                        <td style={{fontFamily: 'monospace'}}>{m.monthlyTokens.toLocaleString()}</td>
                        <td>
                          <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                            <button type="button" className="secondary-button compact" onClick={() => openMod02Ticket({operationType: '全员批量启用模型', modelKey: m.key})}>
                              全员启用
                            </button>
                            <button type="button" className="secondary-button compact" onClick={() => openMod02Ticket({operationType: '全员批量禁用模型', modelKey: m.key})}>
                              全员禁用
                            </button>
                            <button type="button" className="secondary-button compact" style={{color: '#b42318'}} onClick={() => openMod02Ticket({operationType: '全员统一删除模型', modelKey: m.key})}>
                              全员删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} style={{textAlign: 'center', color: '#667085', padding: '20px 0'}}>暂无已配置的跨租户模型，可点击右上角「全员统一配置模型」发起 MOD-02 工单</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {batchData.tickets.length > 0 && (
                <div>
                  <div style={{fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 8}}>MOD-02 全员模型批量工单审批</div>
                  <div className="org-table-wrap">
                    <table className="org-table">
                      <thead>
                        <tr><th>工单号</th><th>操作类型</th><th>目标对象</th><th>申请人</th><th>申请原因</th><th>状态</th><th>审批与执行结果</th></tr>
                      </thead>
                      <tbody>
                        {batchData.tickets.slice(0, 10).map(t => (
                          <tr key={t.ticketNo}>
                            <td><code className="org-code">{t.ticketNo}</code></td>
                            <td>{t.operationType}</td>
                            <td>{t.targetWorkspaceName || t.modelName || '-'}</td>
                            <td>{t.applicantName}</td>
                            <td>{t.reason}</td>
                            <td><span className={`app-status-pill ${pillTone(t.status)}`}>{t.status}</span></td>
                            <td>
                              {t.status === '待审批' && batchData.canApprove ? (
                                <div style={{display: 'flex', gap: 6}}>
                                  <button type="button" className="secondary-button compact" style={{color: '#027a48'}} disabled={busy === t.ticketNo} onClick={() => reviewBatchTicket(t.ticketNo, 'approve')}>批准执行</button>
                                  <button type="button" className="secondary-button compact" style={{color: '#b42318'}} disabled={busy === t.ticketNo} onClick={() => reviewBatchTicket(t.ticketNo, 'reject')}>驳回</button>
                                </div>
                              ) : (t.executionSummary || t.reviewNote || '-')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {report.tickets.length > 0 && (
            <section className="panel overview-block">
              <h3 style={{marginTop: 0, display: 'flex', alignItems: 'center', gap: 6}}>
                <ShieldAlert size={16} />
                MOD-01 模型配额与开关审批单 <span className="workorder-tab-badge">{report.tickets.length}</span>
              </h3>
              <div className="org-table-wrap">
                <table className="org-table">
                  <thead>
                    <tr><th>工单号</th><th>操作类型</th><th>工作区与模型</th><th>申请人</th><th>目标额度</th><th>申请原因</th><th>状态</th><th>审批操作</th></tr>
                  </thead>
                  <tbody>
                    {report.tickets.map(t => (
                      <tr key={t.ticketNo}>
                        <td><code className="org-code">{t.ticketNo}</code></td>
                        <td>{t.operationType || '配置额度'}</td>
                        <td>{t.workspaceName} · {t.modelName}</td>
                        <td>{t.applicantName} · {t.org}</td>
                        <td>{t.operationType === '配置额度' || !t.operationType ? `Token ${t.requestedTokenLimit ?? '不限'} / 次数 ${t.requestedCallLimit ?? '不限'}` : '-'}</td>
                        <td>{t.reason}</td>
                        <td><span className={`app-status-pill ${pillTone(t.status)}`}>{t.status}</span></td>
                        <td>
                          {t.status === '待审批' ? (
                            <div style={{display: 'flex', gap: 6}}>
                              <button type="button" className="secondary-button compact" style={{color: '#027a48'}} disabled={busy === t.ticketNo} onClick={() => reviewTicket(t.ticketNo, 'approve')}>批准生效</button>
                              <button type="button" className="secondary-button compact" style={{color: '#b42318'}} disabled={busy === t.ticketNo} onClick={() => reviewTicket(t.ticketNo, 'reject')}>驳回</button>
                            </div>
                          ) : (t.reviewNote || '-')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
