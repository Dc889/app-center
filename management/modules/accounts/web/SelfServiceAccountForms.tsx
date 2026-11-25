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
