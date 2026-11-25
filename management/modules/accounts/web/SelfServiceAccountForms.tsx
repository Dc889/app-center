import {useEffect, useState} from 'react'
import {FormField} from '../../../shared-ui/UiPrimitives'

type AccountOption = {account: string; name: string; org: string; active: boolean}
type HandoverPreview = {
  account: string
  name: string
  org: string
  applicationsCount: number
  ticketsCount: number
  openEventsCount: number
  difyApps: number
  difyDatasets: number
  difyPlugins: number
  difyMcp: number
  difyKeys: number
}
type HandoverRow = {
  ticketNo: string
  handoverType: string
  fromName: string
  fromAccount: string
  toName: string
  toAccount: string
  reason: string
  status: string
  createdAt: string
  reviewNote?: string
}

function pillTone(status: string) {
  if (status === '已完成' || status === '已批准') return 'tone-success'
  if (status === '已驳回') return 'tone-danger'
  return 'tone-pending'
}

export function HandoverTicketForm() {
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [currentAccount, setCurrentAccount] = useState('')
  const [isStaff, setIsStaff] = useState(false)
  const [fromAccount, setFromAccount] = useState('')
  const [toAccount, setToAccount] = useState('')
  const [handoverType, setHandoverType] = useState<'调岗交接' | '临时托管' | '离职交接'>('调岗交接')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<HandoverPreview | null>(null)
  const [history, setHistory] = useState<HandoverRow[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    const qs = fromAccount ? `?fromAccount=${encodeURIComponent(fromAccount)}` : ''
    fetch(`/api/resource-handover${qs}`, {signal: c.signal})
      .then(async r => (r.ok ? r.json() : null))
      .then(res => {
        if (!res || c.signal.aborted) return
        setAccounts(res.accounts ?? [])
        setCurrentAccount(res.currentAccount || '')
        setIsStaff(Boolean(res.isStaff))
        if (!fromAccount && res.currentAccount) setFromAccount(res.currentAccount)
        setPreview(res.preview ?? null)
        setHistory(res.history ?? [])
      })
      .catch(() => {})
    return () => c.abort()
  }, [fromAccount, rev])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg('')
    if (!toAccount) { setErr('请选择接任人'); return }
    if (!reason.trim()) { setErr('请输入交接原因'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/resource-handover', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          fromAccount: fromAccount || currentAccount,
          toAccount,
          handoverType,
          reason: reason.trim(),
          mode: isStaff ? undefined : 'request',
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '提交交接申请失败')
      setMsg(body.record?.status === '待审批'
        ? `交接工单 ${body.record.ticketNo} 已提交，待系统管理员审批后生效`
        : `交接工单 ${body.record?.ticketNo} 已执行完成`)
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="acc-03-form" className="org-page-stack">
      <form onSubmit={submit} className="form-section">
        <div className="section-heading">
          <span>02</span>
          <div><h4>交接信息</h4></div>
        </div>

        <div className="form-row">
          <FormField label="移交人" source={isStaff ? '用户' : '系统'} required>
            {isStaff ? (
              <select value={fromAccount} onChange={e => setFromAccount(e.target.value)}>
                {accounts.map(a => (
                  <option key={a.account} value={a.account}>{a.name} · {a.account} · {a.org}</option>
                ))}
              </select>
            ) : (
              <input value={currentAccount} readOnly />
            )}
          </FormField>

          <FormField label="接任人" source="用户" required>
            <select value={toAccount} onChange={e => setToAccount(e.target.value)} required>
              <option value="">请选择接任同事</option>
              {accounts.filter(a => a.active && a.account !== (fromAccount || currentAccount)).map(a => (
                <option key={a.account} value={a.account}>{a.name} · {a.account} · {a.org}</option>
              ))}
            </select>
          </FormField>

          <FormField label="交接类型" source="用户" required>
            <select value={handoverType} onChange={e => setHandoverType(e.target.value as any)}>
              <option value="调岗交接">调岗交接</option>
              <option value="临时托管">临时托管</option>
              <option value="离职交接">离职交接</option>
            </select>
          </FormField>
        </div>

        {preview && (
          <div className="app-audit-card" style={{marginTop: 4}}>
            <div className="app-audit-metrics">
              <div><span>Dify 应用</span><strong>{preview.difyApps}</strong></div>
              <div><span>知识库</span><strong>{preview.difyDatasets}</strong></div>
              <div><span>插件 / MCP</span><strong>{preview.difyPlugins} / {preview.difyMcp}</strong></div>
              <div><span>台账工单</span><strong>{preview.applicationsCount + preview.ticketsCount}</strong></div>
            </div>
          </div>
        )}

        <FormField label="交接原因" source="用户" required>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} required placeholder="请输入交接背景与注意事项" />
        </FormField>

        {err && <p role="alert" style={{color: '#b42318', fontSize: 13, margin: 0}}>{err}</p>}
        {msg && <p role="status" style={{color: '#027a48', fontSize: 13, fontWeight: 500, margin: 0}}>{msg}</p>}

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在提交…' : '提交交接申请'}
          </button>
        </div>
      </form>

      {history.length > 0 && (
        <section className="form-section">
          <div className="section-heading">
            <span>03</span>
            <div><h4>相关交接记录</h4></div>
          </div>
          <div className="org-table-wrap">
            <table className="org-table">
              <thead>
                <tr><th>工单号</th><th>类型</th><th>移交人 → 接任人</th><th>说明</th><th>状态</th><th>提交时间</th></tr>
              </thead>
              <tbody>
                {history.slice(0, 10).map(h => (
                  <tr key={h.ticketNo}>
                    <td><code className="org-code">{h.ticketNo}</code></td>
                    <td>{h.handoverType}</td>
                    <td>{h.fromName} → {h.toName}</td>
                    <td>{h.reason}</td>
                    <td><span className={`app-status-pill ${pillTone(h.status)}`}>{h.status}</span></td>
                    <td>{new Date(h.createdAt).toLocaleString('zh-CN', {hour12: false})}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

type OrgRoleRow = {
  ticketNo: string
  account: string
  name: string
  currentOrg: string
  requestType: string
  targetOrg: string | null
  targetRole: string | null
  reason: string
  status: string
  createdAt: string
  reviewNote: string | null
}

const ROLE_NAME: Record<string, string> = {
  operator: '运营审核人员',
  admin: '系统管理员',
  user: '普通用户',
}

export function OrgRoleTicketForm() {
  const [currentOrg, setCurrentOrg] = useState('')
  const [orgs, setOrgs] = useState<string[]>([])
  const [requestType, setRequestType] = useState<'组织变更' | '角色变更'>('组织变更')
  const [targetOrg, setTargetOrg] = useState('')
  const [targetRole, setTargetRole] = useState('operator')
  const [reason, setReason] = useState('')
  const [items, setItems] = useState<OrgRoleRow[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    fetch('/api/org-role-requests', {signal: c.signal})
      .then(async r => (r.ok ? r.json() : null))
      .then(res => {
        if (!res || c.signal.aborted) return
        setCurrentOrg(res.currentProfile?.org || '未归属')
        setOrgs(res.orgs ?? [])
        setItems(res.items ?? [])
      })
      .catch(() => {})
    return () => c.abort()
  }, [rev])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg('')
    if (requestType === '组织变更' && !targetOrg) { setErr('请选择目标组织'); return }
    if (!reason.trim()) { setErr('请输入变更原因'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/org-role-requests', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          requestType,
          targetOrg: requestType === '组织变更' ? targetOrg : undefined,
          targetRole: requestType === '角色变更' ? targetRole : undefined,
          reason: reason.trim(),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '提交失败')
      setMsg(`变更工单 ${body.record?.ticketNo} 已提交，待系统管理员审批后生效`)
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="acc-04-form" className="org-page-stack">
      <form onSubmit={submit} className="form-section">
        <div className="section-heading">
          <span>02</span>
          <div><h4>变更内容</h4></div>
        </div>

        <div className="form-row">
          <FormField label="当前组织" source="系统">
            <input value={currentOrg || '未归属'} readOnly />
          </FormField>

          <FormField label="申请类型" source="用户" required>
            <select value={requestType} onChange={e => setRequestType(e.target.value as any)}>
              <option value="组织变更">变更所属组织</option>
              <option value="角色变更">申请平台角色</option>
            </select>
          </FormField>

          {requestType === '组织变更' ? (
            <FormField label="目标组织" source="用户" required>
              <select value={targetOrg} onChange={e => setTargetOrg(e.target.value)} required>
                <option value="">请选择目标组织</option>
                {orgs.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </FormField>
          ) : (
            <FormField label="目标角色" source="用户" required>
              <select value={targetRole} onChange={e => setTargetRole(e.target.value)}>
                <option value="operator">运营审核人员</option>
                <option value="admin">系统管理员</option>
              </select>
            </FormField>
          )}
        </div>

        <FormField label="变更原因" source="用户" required>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} required placeholder="请输入部门调动情况或权限申请依据" />
        </FormField>

        {err && <p role="alert" style={{color: '#b42318', fontSize: 13, margin: 0}}>{err}</p>}
        {msg && <p role="status" style={{color: '#027a48', fontSize: 13, fontWeight: 500, margin: 0}}>{msg}</p>}

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在提交…' : '提交变更申请'}
          </button>
        </div>
      </form>

      {items.length > 0 && (
        <section className="form-section">
          <div className="section-heading">
            <span>03</span>
            <div><h4>历史变更记录</h4></div>
          </div>
          <div className="org-table-wrap">
            <table className="org-table">
              <thead>
                <tr><th>工单号</th><th>类型</th><th>目标值</th><th>变更原因</th><th>状态</th><th>审批意见</th></tr>
              </thead>
              <tbody>
                {items.slice(0, 10).map(item => (
                  <tr key={item.ticketNo}>
                    <td><code className="org-code">{item.ticketNo}</code></td>
                    <td>{item.requestType}</td>
                    <td>{item.targetOrg || ROLE_NAME[item.targetRole || ''] || item.targetRole}</td>
                    <td>{item.reason}</td>
                    <td><span className={`app-status-pill ${pillTone(item.status)}`}>{item.status}</span></td>
                    <td>{item.reviewNote || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

type ModelQuotaOption = {
  key: string
  workspaceId: string
  workspaceName: string
  ownerName: string
  providerName: string
  modelName: string
  modelType: string
  enabled: boolean
  usedTokens: number
  usedCalls: number
  tokenLimit: number | null
  callLimit: number | null
  period: 'monthly' | 'total'
  autoDisable: boolean
}

type ModelQuotaTicketRow = {
  ticketNo: string
  operationType?: string
  workspaceName: string
  modelName: string
  requestedTokenLimit: number | null
  requestedCallLimit: number | null
  reason: string
  applicantName: string
  status: string
  createdAt: string
  reviewNote: string | null
}

export function ModelQuotaTicketForm() {
  const [models, setModels] = useState<ModelQuotaOption[]>([])
  const [tickets, setTickets] = useState<ModelQuotaTicketRow[]>([])
  const [isStaff, setIsStaff] = useState(false)
  const [selectedKey, setSelectedKey] = useState('')
  const [operationType, setOperationType] = useState<'配置额度' | '禁用模型' | '恢复启用'>('配置额度')
  const [period, setPeriod] = useState<'monthly' | 'total'>('monthly')
  const [tokenLimit, setTokenLimit] = useState('')
  const [callLimit, setCallLimit] = useState('')
  const [autoDisable, setAutoDisable] = useState(true)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    fetch('/api/model-quotas', {signal: c.signal})
      .then(async r => (r.ok ? r.json() : null))
      .then(res => {
        if (!res || c.signal.aborted) return
        const list: ModelQuotaOption[] = res.items ?? []
        setModels(list)
        setTickets(res.tickets ?? [])
        setIsStaff(Boolean(res.isStaff))
        let prefill: any = null
        try {
          const raw = sessionStorage.getItem('mod01-prefill')
          if (raw) {
            prefill = JSON.parse(raw)
            sessionStorage.removeItem('mod01-prefill')
          }
        } catch {}
        if (prefill?.key && list.some(m => m.key === prefill.key)) {
          const target = list.find(m => m.key === prefill.key)!
          setSelectedKey(target.key)
          if (prefill.operationType && ['配置额度', '禁用模型', '恢复启用'].includes(prefill.operationType)) {
            setOperationType(prefill.operationType)
          }
          setTokenLimit(target.tokenLimit ? String(target.tokenLimit) : '')
          setCallLimit(target.callLimit ? String(target.callLimit) : '')
          setPeriod(target.period || 'monthly')
          setAutoDisable(target.autoDisable !== false)
        } else if (!selectedKey && list.length > 0) {
          setSelectedKey(list[0].key)
          setTokenLimit(list[0].tokenLimit ? String(list[0].tokenLimit) : '')
          setCallLimit(list[0].callLimit ? String(list[0].callLimit) : '')
        }
      })
      .catch(() => {})
    return () => c.abort()
  }, [rev])

  const currentModel = models.find(m => m.key === selectedKey) ?? null

  const selectModel = (key: string) => {
    setSelectedKey(key)
    const found = models.find(m => m.key === key)
    if (found) {
      setTokenLimit(found.tokenLimit ? String(found.tokenLimit) : '')
      setCallLimit(found.callLimit ? String(found.callLimit) : '')
      setPeriod(found.period || 'monthly')
      setAutoDisable(found.autoDisable !== false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg('')
    if (!currentModel) { setErr('请选择目标工作区与模型'); return }
    if (operationType === '配置额度' && !tokenLimit.trim() && !callLimit.trim()) {
      setErr('请至少填写 Token 上限或调用次数上限')
      return
    }
    if (!reason.trim()) { setErr('请输入申请原因'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/model-quotas/request', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          workspaceId: currentModel.workspaceId,
          providerName: currentModel.providerName,
          modelName: currentModel.modelName,
          modelType: currentModel.modelType,
          operationType,
          period,
          autoDisable,
          requestedTokenLimit: operationType === '配置额度' && tokenLimit.trim() ? Number(tokenLimit) : null,
          requestedCallLimit: operationType === '配置额度' && callLimit.trim() ? Number(callLimit) : null,
          reason: reason.trim(),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '工单提交失败')
      setMsg(`模型管控工单 ${body.ticket?.ticketNo} 已提交，待审批通过后自动在 Dify 生效`)
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '工单提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="mod-01-form" className="org-page-stack">
      <form onSubmit={submit} className="form-section">
        <div className="section-heading">
          <span>02</span>
          <div><h4>模型配额与开关配置</h4></div>
        </div>

        <div className="form-row">
          <FormField label="目标工作区与模型" source="用户" required>
            <select value={selectedKey} onChange={e => selectModel(e.target.value)} required>
              <option value="">请选择工作区模型</option>
              {models.map(m => (
                <option key={m.key} value={m.key}>{m.workspaceName} · {m.modelName}</option>
              ))}
            </select>
          </FormField>

          <FormField label="工单操作类型" source="用户" required>
            <select value={operationType} onChange={e => setOperationType(e.target.value as any)}>
              <option value="配置额度">配置或调整额度</option>
              {isStaff && <option value="禁用模型">紧急禁用模型</option>}
              {isStaff && <option value="恢复启用">恢复启用模型</option>}
            </select>
          </FormField>

          {operationType === '配置额度' && (
            <FormField label="统计周期" source="用户" required>
              <select value={period} onChange={e => setPeriod(e.target.value as any)}>
                <option value="monthly">自然月统计</option>
                <option value="total">历史累计统计</option>
              </select>
            </FormField>
          )}
        </div>

        {currentModel && (
          <div className="app-audit-card" style={{marginTop: 4}}>
            <div className="app-audit-metrics">
              <div><span>当前已用 Token</span><strong>{currentModel.usedTokens.toLocaleString()}</strong></div>
              <div><span>当前调用次数</span><strong>{currentModel.usedCalls}</strong></div>
              <div><span>当前额度上限</span><strong>{currentModel.tokenLimit ? currentModel.tokenLimit.toLocaleString() : '不限'}</strong></div>
              <div><span>Dify 开关状态</span><strong>{currentModel.enabled ? '已启用' : '已禁用'}</strong></div>
            </div>
          </div>
        )}

        {operationType === '配置额度' && (
          <div className="form-row">
            <FormField label="Token 额度上限" source="用户">
              <input type="number" min={0} value={tokenLimit} onChange={e => setTokenLimit(e.target.value)} placeholder="留空表示不限制" />
            </FormField>
            <FormField label="调用次数上限" source="用户">
              <input type="number" min={0} value={callLimit} onChange={e => setCallLimit(e.target.value)} placeholder="留空表示不限制" />
            </FormField>
            <FormField label="超限自动熔断" source="用户">
              <select value={autoDisable ? 'yes' : 'no'} onChange={e => setAutoDisable(e.target.value === 'yes')}>
                <option value="yes">超限时自动在 Dify 禁用</option>
                <option value="no">仅告警不自动禁用</option>
              </select>
            </FormField>
          </div>
        )}

        <FormField label="申请原因" source="用户" required>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} required placeholder="请输入额度调整或模型开关操作依据" />
        </FormField>

        {err && <p role="alert" style={{color: '#b42318', fontSize: 13, margin: 0}}>{err}</p>}
        {msg && <p role="status" style={{color: '#027a48', fontSize: 13, fontWeight: 500, margin: 0}}>{msg}</p>}

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在提交…' : '提交模型管控工单'}
          </button>
        </div>
      </form>

      {tickets.length > 0 && (
        <section className="form-section">
          <div className="section-heading">
            <span>03</span>
            <div><h4>模型管控工单记录</h4></div>
          </div>
          <div className="org-table-wrap">
            <table className="org-table">
              <thead>
                <tr><th>工单号</th><th>操作类型</th><th>工作区与模型</th><th>目标额度</th><th>申请原因</th><th>状态</th></tr>
              </thead>
              <tbody>
                {tickets.slice(0, 10).map(t => (
                  <tr key={t.ticketNo}>
                    <td><code className="org-code">{t.ticketNo}</code></td>
                    <td>{t.operationType || '配置额度'}</td>
                    <td>{t.workspaceName} · {t.modelName}</td>
                    <td>{t.operationType === '配置额度' || !t.operationType ? `Token ${t.requestedTokenLimit ?? '不限'} / 次数 ${t.requestedCallLimit ?? '不限'}` : '-'}</td>
                    <td>{t.reason}</td>
                    <td><span className={`app-status-pill ${pillTone(t.status)}`}>{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
