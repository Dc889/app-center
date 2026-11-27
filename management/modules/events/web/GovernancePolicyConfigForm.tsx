import {useEffect, useState} from 'react'
import {AlertTriangle, Lock, ShieldCheck, Unlock} from 'lucide-react'
import {FormField} from '../../../shared-ui/UiPrimitives'

type PatrolConfig = {
  enableDatasetSensitiveScan: boolean
  enableShadowPluginScan: boolean
  enableShadowMcpScan: boolean
  enableExternalExposureScan: boolean
  enableChatSensitiveScan: boolean
  highFreqIpThresholdPerMin: number
  patrolIntervalMinutes: number
}

type CutoffSwitches = {
  enableWebAppCutoff: boolean
  enableApiKeyCutoff: boolean
}

type Cfg05Ticket = {
  ticketNo: string
  status: string
  reason: string
  applicantName: string
  createdAt: string
  reviewedByName?: string | null
  reviewNote?: string | null
  before: {patrols: PatrolConfig; cutoffSwitches: CutoffSwitches}
  after: {patrols: PatrolConfig; cutoffSwitches: CutoffSwitches}
}

function pillTone(status: string) {
  if (status === '已完成') return 'tone-success'
  if (status === '已驳回') return 'tone-danger'
  return 'tone-pending'
}

export function GovernancePolicyConfigForm() {
  const [canApprove, setCanApprove] = useState(false)
  const [activeVersion, setActiveVersion] = useState(0)
  const [patrols, setPatrols] = useState<PatrolConfig>({
    enableDatasetSensitiveScan: true,
    enableShadowPluginScan: true,
    enableShadowMcpScan: true,
    enableExternalExposureScan: true,
    enableChatSensitiveScan: true,
    highFreqIpThresholdPerMin: 60,
    patrolIntervalMinutes: 30,
  })
  const [cutoffSwitches, setCutoffSwitches] = useState<CutoffSwitches>({
    enableWebAppCutoff: false,
    enableApiKeyCutoff: false,
  })
  const [tickets, setTickets] = useState<Cfg05Ticket[]>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    fetch('/api/governance-policy', {signal: c.signal})
      .then(async r => (r.ok ? r.json() : null))
      .then(res => {
        if (!res || c.signal.aborted) return
        setCanApprove(Boolean(res.canApprove))
        setActiveVersion(Number(res.policy?.version || 0))
        if (res.policy?.patrols) setPatrols(res.policy.patrols)
        if (res.policy?.cutoffSwitches) setCutoffSwitches(res.policy.cutoffSwitches)
        setTickets(res.configTickets ?? [])
      })
      .catch(() => {})
    return () => c.abort()
  }, [rev])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setMsg('')
    if (!reason.trim()) {
      setErr('请填写策略配置变更原因')
      return
    }
    setBusy(true)
    try {
      const r = await fetch('/api/governance-policy/config/request', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({patrols, cutoffSwitches, reason: reason.trim()}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error?.message || body?.message || '提交配置变更工单失败')
      setMsg(`策略配置变更工单已提交（当前状态：待审批），系统管理员审批通过后立即生效。`)
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '提交配置变更工单失败')
    } finally {
      setBusy(false)
    }
  }

  async function decide(ticketNo: string, decision: 'approve' | 'reject') {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/governance-policy/config/approve', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ticketNo, decision}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error?.message || body?.message || '审批失败')
      setMsg(decision === 'approve' ? '策略变更工单已批准，新策略与断流反制总闸门状态已热生效。' : '策略变更工单已驳回。')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '审批失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="cfg-05-form" className="org-page-stack">
      <form onSubmit={submit} className="form-section">
        <div className="section-heading">
          <span>02</span>
          <div><h4>旁路合规巡检与一键断流反制总闸门配置</h4></div>
        </div>

        <div className="app-audit-card" style={{marginBottom: 12}}>
          <div className="app-audit-metrics">
            <div><span>当前生效版本</span><strong>v{activeVersion}</strong></div>
            <div><span>巡检违规动作</span><strong>仅告警（不干扰原平台）</strong></div>
            <div><span>WebApp 断流总闸门</span><strong>{cutoffSwitches.enableWebAppCutoff ? '拟开启' : '关闭 🔒'}</strong></div>
            <div><span>API 密钥断流总闸门</span><strong>{cutoffSwitches.enableApiKeyCutoff ? '拟开启' : '关闭 🔒'}</strong></div>
          </div>
        </div>

        <fieldset style={{border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 12}}>
          <legend style={{fontWeight: 600, fontSize: 13, padding: '0 6px'}}>一、旁路只读巡检告警开关（全部仅告警，不修改用户原空间）</legend>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginBottom: 12}}>
            <label style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 13}}>
              <input type="checkbox" checked={patrols.enableDatasetSensitiveScan} onChange={e => setPatrols({...patrols, enableDatasetSensitiveScan: e.target.checked})} />
              个人/共享知识库正文敏感词巡检
            </label>
            <label style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 13}}>
              <input type="checkbox" checked={patrols.enableShadowPluginScan} onChange={e => setPatrols({...patrols, enableShadowPluginScan: e.target.checked})} />
              未审批私装插件白名单巡检
            </label>
            <label style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 13}}>
              <input type="checkbox" checked={patrols.enableShadowMcpScan} onChange={e => setPatrols({...patrols, enableShadowMcpScan: e.target.checked})} />
              未登记 MCP 与外联服务巡检
            </label>
            <label style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 13}}>
              <input type="checkbox" checked={patrols.enableExternalExposureScan} onChange={e => setPatrols({...patrols, enableExternalExposureScan: e.target.checked})} />
              未审批 WebApp / API / 第三方嵌入暴露巡检
            </label>
            <label style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 13}}>
              <input type="checkbox" checked={patrols.enableChatSensitiveScan} onChange={e => setPatrols({...patrols, enableChatSensitiveScan: e.target.checked})} />
              外部调用对话问答敏感词审计
            </label>
          </div>
          <div className="form-row">
            <FormField label="巡检建议周期（分钟）" source="用户">
              <input type="number" min={5} max={1440} value={patrols.patrolIntervalMinutes} onChange={e => setPatrols({...patrols, patrolIntervalMinutes: Number(e.target.value || 30)})} />
            </FormField>
            <FormField label="单 IP 异常高频告警阈值（次/分钟）" source="用户">
              <input type="number" min={5} max={10000} value={patrols.highFreqIpThresholdPerMin} onChange={e => setPatrols({...patrols, highFreqIpThresholdPerMin: Number(e.target.value || 60)})} />
            </FormField>
          </div>
        </fieldset>

        <fieldset style={{border: '1px solid #fed7aa', background: '#fffbeb', borderRadius: 8, padding: 14, marginBottom: 12}}>
          <legend style={{fontWeight: 600, fontSize: 13, padding: '0 6px', color: '#9a3412'}}>二、一键断流反制总闸门（默认严格关闭，需审批开启）</legend>
          <p style={{margin: '0 0 10px', fontSize: 12, color: '#9a3412'}}>
            开启以下开关仅解锁「通过 SEC-01 工单发起人工审批断流」的入口权限，绝不会自动拦截或自动停用任何线上应用。
          </p>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10}}>
            <label style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500}}>
              <input type="checkbox" checked={cutoffSwitches.enableWebAppCutoff} onChange={e => setCutoffSwitches({...cutoffSwitches, enableWebAppCutoff: e.target.checked})} />
              {cutoffSwitches.enableWebAppCutoff ? <Unlock size={14} /> : <Lock size={14} />}
              允许启用「一键暂停/恢复 WebApp 及第三方 iframe 公开访问」
            </label>
            <label style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500}}>
              <input type="checkbox" checked={cutoffSwitches.enableApiKeyCutoff} onChange={e => setCutoffSwitches({...cutoffSwitches, enableApiKeyCutoff: e.target.checked})} />
              {cutoffSwitches.enableApiKeyCutoff ? <Unlock size={14} /> : <Lock size={14} />}
              允许启用「一键暂停外部 API 通道 / 吊销未备案 API 密钥」
            </label>
          </div>
        </fieldset>

        <FormField label="变更原因与审计依据" source="用户" required>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} required placeholder="请说明调整巡检策略或开启/关闭断流总闸门的业务与安全依据" />
        </FormField>

        {err && <div className="app-banner danger" style={{marginTop: 8}}><AlertTriangle size={15} /> {err}</div>}
        {msg && <div className="app-banner info" style={{marginTop: 8}}><ShieldCheck size={15} /> {msg}</div>}

        <div className="manual-actions" style={{marginTop: 12}}>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? '提交中…' : '提交 CFG-05 策略变更工单'}</button>
        </div>
      </form>

      {tickets.length > 0 && (
        <section className="form-section">
          <div className="section-heading">
            <span>03</span>
            <div><h4>策略变更工单审批与留痕记录</h4></div>
          </div>
          <div className="table-scroll">
            <table className="org-table">
              <thead>
                <tr>
                  <th>提交时间</th>
                  <th>申请人</th>
                  <th>WebApp 断流开关</th>
                  <th>API 断流开关</th>
                  <th>变更原因</th>
                  <th>状态</th>
                  {canApprove && <th>审批操作</th>}
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.ticketNo}>
                    <td>{new Date(t.createdAt).toLocaleString('zh-CN', {hour12: false})}</td>
                    <td>{t.applicantName}</td>
                    <td>{t.before.cutoffSwitches.enableWebAppCutoff ? '开' : '关'} → <strong>{t.after.cutoffSwitches.enableWebAppCutoff ? '开' : '关'}</strong></td>
                    <td>{t.before.cutoffSwitches.enableApiKeyCutoff ? '开' : '关'} → <strong>{t.after.cutoffSwitches.enableApiKeyCutoff ? '开' : '关'}</strong></td>
                    <td>{t.reason}</td>
                    <td><span className={`app-status-pill ${pillTone(t.status)}`}>{t.status}</span></td>
                    {canApprove && (
                      <td>
                        {t.status === '待审批' ? (
                          <div style={{display: 'flex', gap: 6}}>
                            <button type="button" className="primary-button compact" disabled={busy} onClick={() => decide(t.ticketNo, 'approve')}>批准生效</button>
                            <button type="button" className="secondary-button compact" disabled={busy} onClick={() => decide(t.ticketNo, 'reject')}>驳回</button>
                          </div>
                        ) : (
                          <span style={{fontSize: 12, color: '#64748b'}}>{t.reviewNote || '已处理'}</span>
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
