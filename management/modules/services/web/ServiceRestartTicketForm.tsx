import {useEffect, useState} from 'react'
import {FormField} from '../../../shared-ui/UiPrimitives'

type RestartScript = {
  scriptId: string
  name: string
  product: 'Dify' | 'RAGFlow'
  execMode: 'docker-api' | 'ssh-shell'
  description: string
  scriptContent: string
  sshHost: string
  sshPort: number
  sshUser: string
  hasSshSecret: boolean
  enabled: boolean
  autoHealEnabled: boolean
  failThreshold: number
  cooldownMinutes: number
  maxAutoPerHour: number
  version: number
  scriptHash: string
  updatedByName: string
  updatedAt: string
}

type RestartTicket = {
  ticketNo: string
  product: string
  targetContainer: string | null
  scriptId: string
  scriptName: string
  scriptVersion: number
  execMode: string
  triggerSource: '人工发起' | '系统自动自愈'
  applicantName: string
  reason: string
  status: string
  reviewerName: string | null
  recheckSummary: string | null
  reviewNote: string | null
  durationMs: number | null
  createdAt: string
}

type RestartData = {
  canEditScripts: boolean
  canApprove: boolean
  scripts: RestartScript[]
  tickets: RestartTicket[]
}

function statusTone(status: string) {
  if (status === '已完成') return 'tone-success'
  if (status === '执行失败' || status === '已驳回') return 'tone-danger'
  if (status === '执行中') return 'tone-progress'
  return 'tone-pending'
}

export function ServiceRestartTicketForm() {
  const [data, setData] = useState<RestartData | null>(null)
  const [product, setProduct] = useState<'Dify' | 'RAGFlow'>('Dify')
  const [scriptId, setScriptId] = useState('')
  const [targetContainer, setTargetContainer] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    fetch('/api/service-restart', {signal: c.signal})
      .then(async r => (r.ok ? r.json() : null))
      .then((res: RestartData | null) => {
        if (!res || c.signal.aborted) return
        setData(res)
        let prefill: any = null
        try {
          const raw = sessionStorage.getItem('svc01-prefill')
          if (raw) {
            prefill = JSON.parse(raw)
            sessionStorage.removeItem('svc01-prefill')
          }
        } catch {}
        const initProduct: 'Dify' | 'RAGFlow' = prefill?.product === 'RAGFlow' ? 'RAGFlow' : 'Dify'
        setProduct(initProduct)
        if (prefill?.targetContainer) setTargetContainer(prefill.targetContainer)
        const enabledScripts = res.scripts.filter(s => s.enabled && s.product === initProduct)
        if (prefill?.scriptId && enabledScripts.some(s => s.scriptId === prefill.scriptId)) {
          setScriptId(prefill.scriptId)
        } else if (enabledScripts[0]) {
          setScriptId(enabledScripts[0].scriptId)
        }
      })
      .catch(() => {})
    return () => c.abort()
  }, [rev])

  const availableScripts = (data?.scripts ?? []).filter(s => s.enabled && s.product === product)
  const selectedScript = availableScripts.find(s => s.scriptId === scriptId) ?? availableScripts[0] ?? null

  const onProductChange = (next: 'Dify' | 'RAGFlow') => {
    setProduct(next)
    setTargetContainer('')
    const first = (data?.scripts ?? []).find(s => s.enabled && s.product === next)
    setScriptId(first?.scriptId ?? '')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg('')
    const sid = selectedScript?.scriptId ?? ''
    if (!sid) { setErr('当前子系统暂无可用的管理员固定脚本'); return }
    if (!reason.trim()) { setErr('请输入重启申请原因'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/service-restart/request', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          scriptId: sid,
          targetContainer: selectedScript?.execMode === 'docker-api' && targetContainer.trim() ? targetContainer.trim() : undefined,
          reason: reason.trim(),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || body?.error?.message || '工单提交失败')
      setMsg(`服务重启工单 ${body.ticket?.ticketNo} 已提交，请在「服务监控」由系统管理员审批后执行`)
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '工单提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="svc-01-form" className="org-page-stack">
      <form onSubmit={submit} className="form-section">
        <div className="section-heading">
          <span>02</span>
          <div><h4>固定脚本服务重启</h4></div>
        </div>

        <div className="form-row">
          <FormField label="目标纳管子系统" source="用户" required>
            <select value={product} onChange={e => onProductChange(e.target.value as 'Dify' | 'RAGFlow')}>
              <option value="Dify">Dify</option>
              <option value="RAGFlow">RAGFlow</option>
            </select>
          </FormField>

          <FormField label="管理员固定脚本" source="系统" required>
            <select value={selectedScript?.scriptId ?? ''} onChange={e => setScriptId(e.target.value)} required>
              {availableScripts.length === 0 && <option value="">暂无已启用脚本</option>}
              {availableScripts.map(s => (
                <option key={s.scriptId} value={s.scriptId}>
                  {s.name} · v{s.version} · {s.execMode === 'ssh-shell' ? '目标机 SSH' : 'Docker API 有序'}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {selectedScript?.execMode === 'docker-api' && (
          <div className="form-row">
            <FormField label="定点容器名称" source="用户">
              <input
                value={targetContainer}
                onChange={e => setTargetContainer(e.target.value)}
                placeholder="留空则按脚本完整分层顺序重启；填写具体容器名则仅重启该容器"
              />
            </FormField>
          </div>
        )}

        {selectedScript && (
          <div className="app-audit-card" style={{marginTop: 4}}>
            <div className="app-audit-metrics">
              <div><span>脚本版本</span><strong>v{selectedScript.version}</strong></div>
              <div><span>执行方式</span><strong>{selectedScript.execMode === 'ssh-shell' ? `SSH ${selectedScript.sshHost || '未配主机'}` : '本机 Docker API'}</strong></div>
              <div><span>校验哈希</span><strong><code className="org-code">{selectedScript.scriptHash.slice(0, 12)}</code></strong></div>
              <div><span>自动自愈策略</span><strong>{selectedScript.autoHealEnabled ? `已开启 · ${selectedScript.maxAutoPerHour}次/时熔断` : '仅人工审批'}</strong></div>
            </div>
            <pre style={{
              margin: '10px 0 0',
              padding: 12,
              background: '#0f172a',
              color: '#e2e8f0',
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.55,
              overflowX: 'auto',
              maxHeight: 200,
            }}>
              {selectedScript.scriptContent}
            </pre>
          </div>
        )}

        <FormField label="申请原因" source="用户" required>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            required
            placeholder="请说明服务异常现象、告警编号或变更维护依据"
          />
        </FormField>

        {err && <p role="alert" style={{color: '#b42318', fontSize: 13, margin: 0}}>{err}</p>}
        {msg && <p role="status" style={{color: '#027a48', fontSize: 13, fontWeight: 500, margin: 0}}>{msg}</p>}

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy || !selectedScript}>
            {busy ? '正在提交…' : '提交服务重启工单'}
          </button>
        </div>
      </form>

      {data && data.tickets.length > 0 && (
        <section className="form-section">
          <div className="section-heading">
            <span>03</span>
            <div><h4>服务重启工单记录</h4></div>
          </div>
          <div className="org-table-wrap">
            <table className="org-table">
              <thead>
                <tr><th>工单号</th><th>触发来源</th><th>操作人</th><th>子系统与脚本</th><th>状态</th><th>复检结果</th></tr>
              </thead>
              <tbody>
                {data.tickets.slice(0, 12).map(t => (
                  <tr key={t.ticketNo}>
                    <td><code className="org-code">{t.ticketNo}</code></td>
                    <td>
                      <span className={`app-status-pill ${t.triggerSource === '系统自动自愈' ? 'tone-progress' : 'tone-muted'}`}>
                        {t.triggerSource}
                      </span>
                    </td>
                    <td>{t.applicantName}</td>
                    <td>{t.product} · {t.scriptName} v{t.scriptVersion}{t.targetContainer ? ` · ${t.targetContainer}` : ''}</td>
                    <td><span className={`app-status-pill ${statusTone(t.status)}`}>{t.status}</span></td>
                    <td>{t.recheckSummary || t.reviewNote || '-'}</td>
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
