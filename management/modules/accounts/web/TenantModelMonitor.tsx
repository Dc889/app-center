import {useEffect, useState} from 'react'
import {Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts'
import {Cpu, RefreshCw, Search, ShieldAlert, Users} from 'lucide-react'

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

export function TenantModelMonitor({role}: {role: 'user' | 'ops' | 'admin'}) {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [revision, setRevision] = useState(0)

  const [tenantSearch, setTenantSearch] = useState('')
  const [selectedWs, setSelectedWs] = useState('')

  const [editingQuota, setEditingQuota] = useState<ModelQuotaItem | null>(null)
  const [editTokenLimit, setEditTokenLimit] = useState('')
  const [editCallLimit, setEditCallLimit] = useState('')
  const [editPeriod, setEditPeriod] = useState<'monthly' | 'total'>('monthly')
  const [editAutoDisable, setEditAutoDisable] = useState(true)
  const [editNote, setEditNote] = useState('')

  useEffect(() => {
    const c = new AbortController()
    setLoading(true)
    fetch('/api/model-quotas', {signal: c.signal})
      .then(async r => {
        if (!r.ok) throw new Error('读取租户与模型监控数据失败')
        return r.json()
      })
      .then(data => {
        if (!c.signal.aborted) {
          setReport(data)
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

  const openEditor = (item: ModelQuotaItem) => {
    setEditingQuota(item)
    setEditTokenLimit(item.tokenLimit ? String(item.tokenLimit) : '')
    setEditCallLimit(item.callLimit ? String(item.callLimit) : '')
    setEditPeriod(item.period)
    setEditAutoDisable(item.autoDisable)
    setEditNote(item.note || '')
    setErr(''); setMsg('')
  }

  const savePolicy = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingQuota) return
    setBusy('save'); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/model-quotas/policy', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          workspaceId: editingQuota.workspaceId,
          workspaceName: editingQuota.workspaceName,
          providerName: editingQuota.providerName,
          modelName: editingQuota.modelName,
          modelType: editingQuota.modelType,
          period: editPeriod,
          tokenLimit: editTokenLimit.trim() ? Number(editTokenLimit) : null,
          callLimit: editCallLimit.trim() ? Number(editCallLimit) : null,
          autoDisable: editAutoDisable,
          note: editNote.trim(),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '保存配额失败')
      const extra = body.actionTaken === 'auto_disabled'
        ? '（当前已超限，系统已在 Dify 自动禁用该模型）'
        : body.actionTaken === 'auto_enabled'
          ? '（额度充足，已自动恢复 Dify 模型启用）'
          : ''
      setMsg(`已保存「${editingQuota.workspaceName} / ${editingQuota.modelName}」的配额策略${extra}`)
      setEditingQuota(null)
      setRevision(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '保存配额失败')
    } finally {
      setBusy('')
    }
  }

  const toggleModel = async (item: ModelQuotaItem, action: 'disable' | 'enable') => {
    setBusy(item.key); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/model-quotas/enforce', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          workspaceId: item.workspaceId,
          providerName: item.providerName,
          modelName: item.modelName,
          modelType: item.modelType,
          action,
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '切换失败')
      setMsg(action === 'disable' ? `已在 Dify 禁用「${item.workspaceName}」的模型 ${item.modelName}` : `已在 Dify 恢复启用「${item.workspaceName}」的模型 ${item.modelName}`)
      setRevision(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '切换失败')
    } finally {
      setBusy('')
    }
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
      setMsg(`已完成 Dify 全量资产与模型用量同步（核查 ${body.checked ?? 0} 个模型实例，新触发超限熔断 ${body.disabled?.length ?? 0} 个）。`)
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
      setMsg(decision === 'approve' ? `调额单 ${ticketNo} 已批准${body.modelRestored ? '，并已自动恢复模型启用' : ''}` : `调额单 ${ticketNo} 已驳回`)
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
  const chartData = (report?.tenants ?? []).slice(0, 10).map(t => ({
    name: t.name || t.account,
    appsCount: t.appsCount,
    datasetsCount: t.datasetsCount,
    monthlyTokens: t.monthlyTokens,
  }))

  return (
    <div data-testid="tenant-model-monitor">
      <div className="page-header" style={{marginBottom: 16}}>
        <div>
          <h1>租户资产与模型用量监控</h1>
          <p style={{margin: '4px 0 0', fontSize: 13, color: '#64748b'}}>
            按 Dify 账号全景统计应用、知识库、插件、MCP 数量及模型 Token / 调用次数消耗，支持按「工作区 × 模型」设置额度并自动超限禁用。
            {report?.syncedAt ? ` 最近同步：${new Date(report.syncedAt).toLocaleString('zh-CN', {hour12: false})}` : ''}
          </p>
        </div>
        <button type="button" disabled={!!busy || loading} onClick={runSweep} style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
          <RefreshCw size={14} />
          {busy === 'sweep' ? '同步巡检中…' : '刷新用量并执行超限巡检'}
        </button>
      </div>

      {err && <p role="alert" style={{color: '#dc2626', marginBottom: 12}}>{err}</p>}
      {msg && <p role="status" style={{color: '#15803d', fontWeight: 500, marginBottom: 12}}>{msg}</p>}
      {loading && !report && <p role="status">正在加载租户资产与模型用量…</p>}

      {report && (
        <>
          {/* 5 KPI Cards */}
          <div className="metric-grid five" style={{marginBottom: 16}}>
            <article className="metric-card">
              <span>纳管账号 / 租户</span>
              <strong>{report.summary.totalTenants}</strong>
              <small style={{color: '#64748b', fontSize: 12}}>应用 {report.summary.totalApps} · 知识库 {report.summary.totalDatasets}</small>
            </article>
            <article className="metric-card">
              <span>本月总 Token 消耗</span>
              <strong>{report.summary.totalMonthlyTokens.toLocaleString()}</strong>
              <small style={{color: '#64748b', fontSize: 12}}>本月调用 {report.summary.totalMonthlyCalls.toLocaleString()} 次</small>
            </article>
            <article className="metric-card">
              <span>已纳管模型实例</span>
              <strong>{report.summary.total}</strong>
              <small style={{color: '#64748b', fontSize: 12}}>已设额度限制 {report.summary.configured} 个</small>
            </article>
            <article className="metric-card">
              <span>超限 / ≥80% 预警</span>
              <strong style={{color: report.summary.exceeded > 0 ? '#dc2626' : '#0f172a'}}>{report.summary.exceeded} / {report.summary.warning}</strong>
              <small style={{color: '#64748b', fontSize: 12}}>每 60 秒自动巡检</small>
            </article>
            <article className="metric-card">
              <span>Dify 已禁用 / 待审调额</span>
              <strong style={{color: report.summary.disabled > 0 ? '#dc2626' : '#0f172a'}}>{report.summary.disabled} / {report.summary.pendingTickets}</strong>
              <small style={{color: '#64748b', fontSize: 12}}>MOD-01 审批后自动解禁</small>
            </article>
          </div>

          {/* Visual Comparison Chart */}
          {chartData.length > 0 && (
            <section className="panel overview-block" style={{marginBottom: 16}}>
              <h3 style={{marginTop: 0, display: 'flex', alignItems: 'center', gap: 6}}>
                <Users size={16} />
                各账号资产规模与本月 Token 消耗 Top 10
              </h3>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16}}>
                <div style={{height: 240}}>
                  <div style={{fontSize: 12, color: '#64748b', marginBottom: 6}}>本月 Token 消耗排行</div>
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
                  <div style={{fontSize: 12, color: '#64748b', marginBottom: 6}}>各账号应用数 & 知识库数分布</div>
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

          {/* Section 1: Per-Account Asset & Usage Overview */}
          <section className="panel overview-block" style={{marginBottom: 16}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12}}>
              <h3 style={{margin: 0}}>按账号（租户）资产与模型用量全景（共 {filteredTenants.length} 人）</h3>
              <div style={{position: 'relative'}}>
                <Search size={14} style={{position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8'}} />
                <input
                  value={tenantSearch}
                  onChange={e => setTenantSearch(e.target.value)}
                  placeholder="搜索姓名、账号、组织或工作区…"
                  style={{paddingLeft: 30, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12, width: 240}}
                />
              </div>
            </div>
            <div className="table-scroll">
              <table>
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
                    <th>模型管控状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTenants.map(t => (
                    <tr key={t.account} style={{background: selectedWs && selectedWs === t.workspaceId ? '#eff6ff' : undefined}}>
                      <td>
                        <strong>{t.name}</strong>
                        <div style={{fontSize: 11, color: '#64748b'}}>{t.account}{t.workspaceName ? ` · ${t.workspaceName}` : ''}</div>
                      </td>
                      <td>{t.org}</td>
                      <td>
                        <span className={`status ${t.active ? 'success' : 'danger'}`}>{t.active ? '正常' : '已停用'}</span>
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
                          ? <span className="status danger">熔断/禁用 {Math.max(t.exceededModels, t.disabledModels)}</span>
                          : t.warningModels > 0
                            ? <span className="status warning">预警 {t.warningModels}</span>
                            : <span className="status success">正常</span>}
                      </td>
                      <td>
                        {t.workspaceId ? (
                          <button
                            type="button"
                            className="secondary-button"
                            style={{padding: '3px 8px', fontSize: 12}}
                            onClick={() => setSelectedWs(prev => prev === t.workspaceId ? '' : t.workspaceId)}
                          >
                            {selectedWs === t.workspaceId ? '显示全部模型' : '查看模型额度'}
                          </button>
                        ) : <span style={{fontSize: 12, color: '#94a3b8'}}>无工作区</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 2: Workspace x Model Quota Enforcement */}
          <section className="panel overview-block" style={{marginBottom: 16}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12}}>
              <h3 style={{margin: 0, display: 'flex', alignItems: 'center', gap: 6}}>
                <Cpu size={16} />
                工作区 × 模型额度与超限熔断管控（{filteredModels.length} 项）
              </h3>
              {selectedWs && (
                <button type="button" className="secondary-button" style={{padding: '4px 10px', fontSize: 12}} onClick={() => setSelectedWs('')}>
                  清除工作区筛选
                </button>
              )}
            </div>

            {editingQuota && (
              <form onSubmit={savePolicy} style={{background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: 14, marginBottom: 14}}>
                <h4 style={{margin: '0 0 10px', fontSize: 13}}>
                  配置模型额度：{editingQuota.workspaceName}（{editingQuota.ownerName}） / {editingQuota.modelName}
                </h4>
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 10}}>
                  <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
                    Token 额度上限（留空不限）
                    <input type="number" min={0} value={editTokenLimit} onChange={e => setEditTokenLimit(e.target.value)} placeholder="如：100000" style={{padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1'}} />
                  </label>
                  <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
                    调用次数上限（留空不限）
                    <input type="number" min={0} value={editCallLimit} onChange={e => setEditCallLimit(e.target.value)} placeholder="如：500" style={{padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1'}} />
                  </label>
                  <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
                    统计周期
                    <select value={editPeriod} onChange={e => setEditPeriod(e.target.value as 'monthly' | 'total')} style={{padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1'}}>
                      <option value="monthly">按自然月统计</option>
                      <option value="total">按历史累计统计</option>
                    </select>
                  </label>
                  <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
                    策略说明
                    <input value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="备注依据" style={{padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1'}} />
                  </label>
                </div>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8}}>
                  <label style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12}}>
                    <input type="checkbox" checked={editAutoDisable} onChange={e => setEditAutoDisable(e.target.checked)} />
                    超限时自动在 Dify 禁用该工作区的此模型并生成告警事件
                  </label>
                  <div style={{display: 'flex', gap: 8}}>
                    <button type="button" className="secondary-button" style={{padding: '5px 12px', fontSize: 12}} onClick={() => setEditingQuota(null)}>取消</button>
                    <button type="submit" disabled={busy === 'save'} style={{padding: '5px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, cursor: 'pointer'}}>
                      {busy === 'save' ? '保存中…' : '保存并立即生效'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>工作区 / 负责人</th>
                    <th>所属组织</th>
                    <th>模型名称</th>
                    <th>周期</th>
                    <th>Token 消耗 / 额度</th>
                    <th>调用次数 / 上限</th>
                    <th>Dify 模型开关</th>
                    <th>配额状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModels.length > 0 ? filteredModels.map(item => (
                    <tr key={item.key}>
                      <td>{item.workspaceName}<div style={{fontSize: 11, color: '#64748b'}}>{item.ownerName} ({item.ownerAccount})</div></td>
                      <td>{item.org}</td>
                      <td><strong>{item.modelName}</strong><div style={{fontSize: 11, color: '#64748b'}}>{item.providerName.split('/').at(-1)}</div></td>
                      <td style={{fontSize: 12}}>{item.period === 'monthly' ? '本月' : '累计'}</td>
                      <td style={{fontFamily: 'monospace', fontSize: 12, minWidth: 160}}>
                        <div>{item.usedTokens.toLocaleString()} / {item.tokenLimit ? item.tokenLimit.toLocaleString() : '不限'}{item.tokenPercent !== null ? ` (${item.tokenPercent}%)` : ''}</div>
                        {item.tokenPercent !== null && (
                          <div style={{height: 6, background: '#e2e8f0', borderRadius: 3, marginTop: 4, overflow: 'hidden'}}>
                            <div style={{height: '100%', width: `${Math.min(100, item.tokenPercent)}%`, background: item.tokenPercent >= 100 ? '#dc2626' : item.tokenPercent >= 80 ? '#f59e0b' : '#2563eb'}} />
                          </div>
                        )}
                      </td>
                      <td style={{fontFamily: 'monospace', fontSize: 12}}>
                        {item.usedCalls} / {item.callLimit ?? '不限'}{item.callPercent !== null ? ` (${item.callPercent}%)` : ''}
                      </td>
                      <td>
                        <span className={`status ${item.enabled ? 'success' : 'danger'}`}>{item.enabled ? '已启用' : '已禁用'}</span>
                      </td>
                      <td>
                        <span className={`status ${item.exceeded ? 'danger' : item.warning ? 'warning' : 'success'}`}>{item.quotaStatus}</span>
                      </td>
                      <td>
                        <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                          <button type="button" className="secondary-button" style={{padding: '3px 8px', fontSize: 12}} onClick={() => openEditor(item)}>设置额度</button>
                          {item.enabled
                            ? <button type="button" className="secondary-button" style={{padding: '3px 8px', fontSize: 12, color: '#dc2626'}} disabled={busy === item.key} onClick={() => toggleModel(item, 'disable')}>禁用</button>
                            : <button type="button" className="secondary-button" style={{padding: '3px 8px', fontSize: 12, color: '#15803d'}} disabled={busy === item.key} onClick={() => toggleModel(item, 'enable')}>恢复启用</button>}
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={9} style={{textAlign: 'center', padding: '24px 0', color: '#94a3b8'}}>当前筛选下暂无已配置模型记录</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3: MOD-01 Quota Requests */}
          {report.tickets.length > 0 && (
            <section className="panel overview-block">
              <h3 style={{marginTop: 0, display: 'flex', alignItems: 'center', gap: 6}}>
                <ShieldAlert size={16} />
                MOD-01 模型调额申请单（{report.tickets.length}）
              </h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>单号</th><th>工作区 / 模型</th><th>申请人</th><th>申请额度</th><th>理由</th><th>状态</th><th>操作</th></tr>
                  </thead>
                  <tbody>
                    {report.tickets.map(t => (
                      <tr key={t.ticketNo}>
                        <td style={{fontFamily: 'monospace'}}>{t.ticketNo}</td>
                        <td>{t.workspaceName} / {t.modelName}</td>
                        <td>{t.applicantName} ({t.org})</td>
                        <td style={{fontSize: 12}}>Token: {t.requestedTokenLimit ?? '-'} · 次数: {t.requestedCallLimit ?? '-'}</td>
                        <td>{t.reason}</td>
                        <td>{t.status}</td>
                        <td>
                          {t.status === '待审批' ? (
                            <div style={{display: 'flex', gap: 6}}>
                              <button type="button" className="secondary-button" style={{padding: '3px 8px', fontSize: 12, color: '#15803d'}} disabled={busy === t.ticketNo} onClick={() => reviewTicket(t.ticketNo, 'approve')}>批准并解禁</button>
                              <button type="button" className="secondary-button" style={{padding: '3px 8px', fontSize: 12, color: '#dc2626'}} disabled={busy === t.ticketNo} onClick={() => reviewTicket(t.ticketNo, 'reject')}>驳回</button>
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
