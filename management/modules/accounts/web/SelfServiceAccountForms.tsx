import {useEffect, useState} from 'react'

type AccountOption = {account: string; name: string; org: string; active: boolean}
type HandoverPreview = {account: string; name: string; org: string; applicationsCount: number; ticketsCount: number; openEventsCount: number; difyApps: number; difyDatasets: number; difyPlugins: number; difyMcp: number; difyKeys: number}
type HandoverRow = {ticketNo: string; handoverType: string; fromName: string; fromAccount: string; toName: string; toAccount: string; reason: string; status: string; createdAt: string; reviewNote?: string}

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
    if (!toAccount) { setErr('请选择接任人账号'); return }
    if (!reason.trim()) { setErr('请填写交接原因说明'); return }
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
        ? `交接工单 ${body.record.ticketNo} 已提交，待系统管理员复核批准后生效。`
        : `交接工单 ${body.record?.ticketNo} 已完成执行。`)
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="acc-03-form" style={{display: 'flex', flexDirection: 'column', gap: 16}}>
      <form onSubmit={submit} style={{background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 18}}>
        <h3 style={{margin: '0 0 6px', fontSize: 15}}>ACC-03 离职 / 调岗资源交接申请</h3>
        <p style={{margin: '0 0 14px', fontSize: 12, color: '#64748b'}}>
          将本人名下的应用、知识库、台账工单与未关闭事件移交至接任同事；提交后由系统管理员审批执行。
        </p>

        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12}}>
          <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
            移交人账号
            {isStaff ? (
              <select value={fromAccount} onChange={e => setFromAccount(e.target.value)} style={{padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1'}}>
                {accounts.map(a => <option key={a.account} value={a.account}>{a.name} ({a.account} · {a.org})</option>)}
              </select>
            ) : (
              <input value={currentAccount} readOnly style={{padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#475569'}} />
            )}
          </label>
          <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
            接任人账号（必选）
            <select value={toAccount} onChange={e => setToAccount(e.target.value)} required style={{padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1'}}>
              <option value="">请选择接任同事…</option>
              {accounts.filter(a => a.active && a.account !== (fromAccount || currentAccount)).map(a => (
                <option key={a.account} value={a.account}>{a.name} ({a.account} · {a.org})</option>
              ))}
            </select>
          </label>
          <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
            交接类型
            <select value={handoverType} onChange={e => setHandoverType(e.target.value as any)} style={{padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1'}}>
              <option value="调岗交接">调岗交接</option>
              <option value="临时托管">临时托管</option>
              <option value="离职交接">离职交接</option>
            </select>
          </label>
        </div>

        {preview && (
          <div style={{background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#1e3a8a'}}>
            <strong>待交接资产盘点（{preview.name} · {preview.org}）：</strong>
            Dify 应用 <b>{preview.difyApps}</b> 个、知识库 <b>{preview.difyDatasets}</b> 个、插件 <b>{preview.difyPlugins}</b> 个、MCP <b>{preview.difyMcp}</b> 个；
            应用中心申请单 <b>{preview.applicationsCount}</b> 条、工单 <b>{preview.ticketsCount}</b> 条、未关闭事件 <b>{preview.openEventsCount}</b> 条。
          </div>
        )}

        <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, marginBottom: 14}}>
          交接原因与说明（必填）
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} required placeholder="请说明调岗/托管原因及交接注意事项…" style={{padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontFamily: 'inherit'}} />
        </label>

        {err && <p role="alert" style={{color: '#dc2626', fontSize: 12, margin: '0 0 10px'}}>{err}</p>}
        {msg && <p role="status" style={{color: '#15803d', fontSize: 12, fontWeight: 500, margin: '0 0 10px'}}>{msg}</p>}

        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? '正在提交…' : '提交资源交接工单'}
        </button>
      </form>

      {history.length > 0 && (
        <section className="panel" style={{padding: 16}}>
          <h4 style={{margin: '0 0 10px', fontSize: 14}}>相关交接申请记录</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>工单号</th><th>类型</th><th>移交人 → 接任人</th><th>说明</th><th>状态</th><th>提交时间</th></tr>
              </thead>
              <tbody>
                {history.slice(0, 10).map(h => (
                  <tr key={h.ticketNo}>
                    <td style={{fontFamily: 'monospace'}}>{h.ticketNo}</td>
                    <td>{h.handoverType}</td>
                    <td>{h.fromName} → {h.toName}</td>
                    <td>{h.reason}</td>
                    <td><span className={`status ${h.status === '已完成' ? 'success' : h.status === '已驳回' ? 'danger' : 'warning'}`}>{h.status}</span></td>
                    <td style={{fontSize: 12, color: '#64748b'}}>{new Date(h.createdAt).toLocaleString('zh-CN', {hour12: false})}</td>
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

type OrgRoleRow = {ticketNo: string; account: string; name: string; currentOrg: string; requestType: string; targetOrg: string | null; targetRole: string | null; reason: string; status: string; createdAt: string; reviewNote: string | null}

export function OrgRoleTicketForm() {
  const [currentOrg, setCurrentOrg] = useState('')
  const [currentName, setCurrentName] = useState('')
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
        setCurrentName(res.currentProfile?.name || '')
        setOrgs(res.orgs ?? [])
        setItems(res.items ?? [])
      })
      .catch(() => {})
    return () => c.abort()
  }, [rev])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg('')
    if (requestType === '组织变更' && !targetOrg) { setErr('请选择目标组织机构'); return }
    if (!reason.trim()) { setErr('请填写变更理由'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/org-role-requests', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({requestType, targetOrg: requestType === '组织变更' ? targetOrg : undefined, targetRole: requestType === '角色变更' ? targetRole : undefined, reason: reason.trim()}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '提交失败')
      setMsg(`工单 ${body.record?.ticketNo} 已提交，待系统管理员审批通过后自动生效。`)
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="acc-04-form" style={{display: 'flex', flexDirection: 'column', gap: 16}}>
      <form onSubmit={submit} style={{background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 18}}>
        <h3 style={{margin: '0 0 6px', fontSize: 15}}>ACC-04 个人组织机构与角色权限变更申请</h3>
        <p style={{margin: '0 0 14px', fontSize: 12, color: '#64748b'}}>
          当前身份：<strong>{currentName}</strong> · 当前所属组织：<strong>{currentOrg}</strong>。提交后由系统管理员审批，批准后立即生效并全程审计留痕。
        </p>

        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12}}>
          <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
            申请类型
            <select value={requestType} onChange={e => setRequestType(e.target.value as any)} style={{padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1'}}>
              <option value="组织变更">变更所属组织机构</option>
              <option value="角色变更">申请平台角色权限</option>
            </select>
          </label>
          {requestType === '组织变更' ? (
            <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
              目标组织机构（必选）
              <select value={targetOrg} onChange={e => setTargetOrg(e.target.value)} required style={{padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1'}}>
                <option value="">请选择新组织机构…</option>
                {orgs.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ) : (
            <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
              申请目标角色
              <select value={targetRole} onChange={e => setTargetRole(e.target.value)} style={{padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1'}}>
                <option value="operator">运营审核人员（operator）</option>
                <option value="admin">系统管理员（admin）</option>
              </select>
            </label>
          )}
        </div>

        <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, marginBottom: 14}}>
          变更原因说明（必填）
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} required placeholder="请说明部门调动情况或角色授权必要性…" style={{padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontFamily: 'inherit'}} />
        </label>

        {err && <p role="alert" style={{color: '#dc2626', fontSize: 12, margin: '0 0 10px'}}>{err}</p>}
        {msg && <p role="status" style={{color: '#15803d', fontSize: 12, fontWeight: 500, margin: '0 0 10px'}}>{msg}</p>}

        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? '正在提交…' : '提交变更申请工单'}
        </button>
      </form>

      {items.length > 0 && (
        <section className="panel" style={{padding: 16}}>
          <h4 style={{margin: '0 0 10px', fontSize: 14}}>我的组织/角色变更申请记录</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>工单号</th><th>类型</th><th>变更目标</th><th>原因</th><th>状态</th><th>审批意见</th></tr>
              </thead>
              <tbody>
                {items.slice(0, 10).map(item => (
                  <tr key={item.ticketNo}>
                    <td style={{fontFamily: 'monospace'}}>{item.ticketNo}</td>
                    <td>{item.requestType}</td>
                    <td>{item.targetOrg || item.targetRole}</td>
                    <td>{item.reason}</td>
                    <td><span className={`status ${item.status === '已批准' ? 'success' : item.status === '已驳回' ? 'danger' : 'warning'}`}>{item.status}</span></td>
                    <td style={{fontSize: 12, color: '#64748b'}}>{item.reviewNote || '-'}</td>
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
