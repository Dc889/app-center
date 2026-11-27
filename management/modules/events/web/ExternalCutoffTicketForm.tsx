import {useEffect, useState} from 'react'
import {AlertTriangle, Lock, ShieldCheck, ShieldOff} from 'lucide-react'
import {FormField} from '../../../shared-ui/UiPrimitives'

type AppOption = {appId: string; name: string; workspaceName?: string}
type ExposureData = {
  appId: string
  appName: string
  workspaceName: string
  ownerName: string
  enableSite: boolean
  enableApi: boolean
  siteStatus: string
  siteCode: string
  apiKeys: {keyId: string; tokenMask: string; createdAt: string | null; lastUsedAt: string | null}[]
}
type CutoffTicket = {
  ticketNo: string
  status: string
  actionLabel: string
  appName: string
  workspaceName: string
  keyMask: string | null
  reason: string
  applicantName: string
  createdAt: string
  execution?: {summary?: string} | null
  reviewNote?: string | null
}

function pillTone(status: string) {
  if (status === '已完成') return 'tone-success'
  if (status === '已驳回') return 'tone-danger'
  return 'tone-pending'
}

export function ExternalCutoffTicketForm() {
  const [canApprove, setCanApprove] = useState(false)
  const [switches, setSwitches] = useState({enableWebAppCutoff: false, enableApiKeyCutoff: false})
  const [apps, setApps] = useState<AppOption[]>([])
  const [appId, setAppId] = useState('')
  const [exposure, setExposure] = useState<ExposureData | null>(null)
  const [action, setAction] = useState<'pause_webapp' | 'resume_webapp' | 'pause_api' | 'resume_api' | 'revoke_api_key'>('pause_webapp')
  const [keyId, setKeyId] = useState('')
  const [reason, setReason] = useState('')
  const [tickets, setTickets] = useState<CutoffTicket[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    Promise.all([
      fetch('/api/governance-policy', {signal: c.signal}).then(r => (r.ok ? r.json() : null)),
      fetch('/api/agent-monitor?pageSize=200', {signal: c.signal}).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([gov, mon]) => {
        if (c.signal.aborted) return
        if (gov) {
          setCanApprove(Boolean(gov.canApprove))
          if (gov.policy?.cutoffSwitches) setSwitches(gov.policy.cutoffSwitches)
          setTickets(gov.cutoffTickets ?? [])
        }
        const rawApps: AppOption[] = []
        const seen = new Set<string>()
        for (const g of mon?.accountGroups ?? []) {
          for (const a of g?.apps ?? []) {
            const aid = String(a?.appId || a?.id || '').trim()
            if (!aid || seen.has(aid)) continue
            seen.add(aid)
            rawApps.push({
              appId: aid,
              name: a.name || a.appName || aid,
              workspaceName: g.name ? `${g.name}${g.org ? ` · ${g.org}` : ''}` : (g.org || ''),
            })
          }
        }
        setApps(rawApps)
        if (!appId && rawApps.length > 0) setAppId(rawApps[0].appId)
      })
      .catch(() => {})
    return () => c.abort()
  }, [rev])

  useEffect(() => {
    if (!appId) { setExposure(null); return }
    const c = new AbortController()
    fetch(`/api/governance-policy/app-exposure?appId=${encodeURIComponent(appId)}`, {signal: c.signal})
      .then(r => (r.ok ? r.json() : null))
      .then(res => {
        if (!c.signal.aborted && res?.exposure) {
          setExposure(res.exposure)
          setKeyId(res.exposure.apiKeys?.[0]?.keyId || '')
        }
      })
      .catch(() => {})
    return () => c.abort()
  }, [appId, rev])

  const isWebAction = action === 'pause_webapp' || action === 'resume_webapp'
  const currentSwitchEnabled = isWebAction ? switches.enableWebAppCutoff : switches.enableApiKeyCutoff

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setMsg('')
    if (!currentSwitchEnabled) {
      setErr('当前断流反制总开关处于默认关闭状态，请先通过 CFG-05 配置工单审批开启。')
      return
    }
    if (!appId) { setErr('请选择目标智能体应用'); return }
    if (action === 'revoke_api_key' && !keyId) { setErr('请选择要吊销的具体 API 密钥'); return }
    if (!reason.trim()) { setErr('请填写断流或恢复操作依据'); return }

    const chosenKey = exposure?.apiKeys.find(k => k.keyId === keyId)
    setBusy(true)
    try {
      const r = await fetch('/api/governance-policy/cutoff/request', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          appId,
          action,
          keyId: action === 'revoke_api_key' ? keyId : undefined,
          keyMask: chosenKey?.tokenMask || undefined,
          reason: reason.trim(),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error?.message || body?.message || '提交断流工单失败')
      setMsg('外部访问断流/恢复工单已提交，系统管理员审批通过后立即执行。')
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '提交断流工单失败')
    } finally {
      setBusy(false)
    }
  }

  async function decide(ticketNo: string, decision: 'approve' | 'reject') {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/governance-policy/cutoff/approve', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ticketNo, decision}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error?.message || body?.message || '审批执行失败')
      setMsg(decision === 'approve' ? `工单已审批执行：${body.ticket?.execution?.summary || '已完成'}` : '工单已驳回')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '审批执行失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="sec-01-form" className="org-page-stack">
      <form onSubmit={submit} className="form-section">
        <div className="section-heading">
          <span>02</span>
          <div><h4>应用外部暴露一键断流 / 恢复（受 CFG-05 总闸门管控）</h4></div>
        </div>

        {!currentSwitchEnabled && (
          <div className="app-banner danger" style={{marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8}}>
            <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
              <Lock size={15} /> 当前所选反制动作的全局总开关为「默认关闭」，无法提交执行。请先通过 CFG-05 配置工单审批开启。
            </span>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => {
                window.history.pushState({}, '', '/manual/CFG-05')
                window.dispatchEvent(new PopStateEvent('popstate'))
              }}
            >
              前往 CFG-05 申请开启
            </button>
          </div>
        )}

        <div className="form-row">
          <FormField label="目标智能体应用" source="系统读取" required>
            <select value={appId} onChange={e => setAppId(e.target.value)}>
              <option value="">请选择应用</option>
              {apps.map(a => (
                <option key={a.appId} value={a.appId}>{a.name}{a.workspaceName ? ` · ${a.workspaceName}` : ''}</option>
              ))}
            </select>
          </FormField>
          <FormField label="反制 / 恢复动作" source="用户" required>
            <select value={action} onChange={e => setAction(e.target.value as any)}>
              <option value="pause_webapp">暂停 WebApp / iframe 公开访问</option>
              <option value="resume_webapp">恢复 WebApp / iframe 公开访问</option>
              <option value="pause_api">暂停外部 API 通道访问</option>
              <option value="resume_api">恢复外部 API 通道访问</option>
              <option value="revoke_api_key">吊销指定未备案 API 密钥</option>
            </select>
          </FormField>
        </div>

        {exposure && (
          <div className="app-audit-card" style={{margin: '8px 0 12px'}}>
            <div className="app-audit-metrics">
              <div><span>所属工作区</span><strong>{exposure.workspaceName || '—'}</strong></div>
              <div><span>WebApp 公开访问</span><strong>{exposure.enableSite && exposure.siteStatus !== 'pause' ? '已开启' : '已暂停'}</strong></div>
              <div><span>外部 API 通道</span><strong>{exposure.enableApi ? '已开启' : '已暂停'}</strong></div>
              <div><span>现有 API 密钥数</span><strong>{exposure.apiKeys.length} 把</strong></div>
            </div>
          </div>
        )}

        {action === 'revoke_api_key' && (
          <FormField label="选择要吊销的 API 密钥" source="系统读取" required>
            <select value={keyId} onChange={e => setKeyId(e.target.value)}>
              <option value="">请选择密钥</option>
              {(exposure?.apiKeys ?? []).map(k => (
                <option key={k.keyId} value={k.keyId}>
                  {k.tokenMask}（创建：{k.createdAt ? new Date(k.createdAt).toLocaleDateString('zh-CN') : '—'}）
                </option>
              ))}
            </select>
          </FormField>
        )}

        <FormField label="断流 / 恢复原因与关联告警说明" source="用户" required>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} required placeholder="例如：发现未经审批将 WebApp 嵌入第三方系统并出现异常高频调用，申请先行暂停外部公开访问" />
        </FormField>

        {err && <div className="app-banner danger" style={{marginTop: 8}}><AlertTriangle size={15} /> {err}</div>}
        {msg && <div className="app-banner info" style={{marginTop: 8}}><ShieldCheck size={15} /> {msg}</div>}

        <div className="manual-actions" style={{marginTop: 12}}>
          <button type="submit" className="primary-button" disabled={busy || !currentSwitchEnabled}>
            <ShieldOff size={15} /> {busy ? '提交中…' : '提交 SEC-01 断流 / 恢复审批单'}
          </button>
        </div>
      </form>

      {tickets.length > 0 && (
        <section className="form-section">
          <div className="section-heading">
            <span>03</span>
            <div><h4>外部访问断流 / 恢复工单记录</h4></div>
          </div>
          <div className="table-scroll">
            <table className="org-table">
              <thead>
                <tr>
                  <th>提交时间</th>
                  <th>应用名称</th>
                  <th>动作</th>
                  <th>申请人</th>
                  <th>原因</th>
                  <th>状态</th>
                  {canApprove && <th>审批执行</th>}
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.ticketNo}>
                    <td>{new Date(t.createdAt).toLocaleString('zh-CN', {hour12: false})}</td>
                    <td>{t.appName}</td>
                    <td>{t.actionLabel}{t.keyMask ? ` (${t.keyMask})` : ''}</td>
                    <td>{t.applicantName}</td>
                    <td>{t.reason}</td>
                    <td><span className={`app-status-pill ${pillTone(t.status)}`}>{t.status}</span></td>
                    {canApprove && (
                      <td>
                        {t.status === '待审批' ? (
                          <div style={{display: 'flex', gap: 6}}>
                            <button type="button" className="primary-button compact" disabled={busy} onClick={() => decide(t.ticketNo, 'approve')}>批准并执行</button>
                            <button type="button" className="secondary-button compact" disabled={busy} onClick={() => decide(t.ticketNo, 'reject')}>驳回</button>
                          </div>
                        ) : (
                          <span style={{fontSize: 12, color: '#64748b'}}>{t.execution?.summary || t.reviewNote || '已处理'}</span>
                        )}
                      </td>
                    )}
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
