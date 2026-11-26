import {useEffect, useState} from 'react'
import {FormField} from '../../../shared-ui/UiPrimitives'

type AiConfig = {
  configured: boolean
  aiBaseUrl: string
  aiModel: string
  hasApiKey: boolean
  concurrency: number
  batchSize: number
  minRuns: number
  promptTemplate: string
  version: number
  updatedByName?: string | null
  updatedAt?: string | null
}

type Cfg04Ticket = {
  ticketNo: string
  aiBaseUrl: string
  aiModel: string
  hasApiKey: boolean
  concurrency: number
  batchSize: number
  minRuns: number
  reason: string
  applicantName: string
  status: string
  createdAt: string
  reviewNote: string | null
}

function pillTone(status: string) {
  if (status === '已完成') return 'tone-success'
  if (status === '已驳回') return 'tone-danger'
  return 'tone-pending'
}

export function AgentAnalysisConfigForm() {
  const [canApprove, setCanApprove] = useState(false)
  const [activeCfg, setActiveCfg] = useState<AiConfig | null>(null)
  const [tickets, setTickets] = useState<Cfg04Ticket[]>([])
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiApiKey, setAiApiKey] = useState('')
  const [concurrency, setConcurrency] = useState('3')
  const [batchSize, setBatchSize] = useState('10')
  const [minRuns, setMinRuns] = useState('1')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    fetch('/api/agent-insights/config', {signal: c.signal})
      .then(async r => (r.ok ? r.json() : null))
      .then(res => {
        if (!res || c.signal.aborted) return
        setCanApprove(Boolean(res.canApprove))
        setActiveCfg(res.config)
        setTickets(res.tickets ?? [])
        if (!aiBaseUrl && res.config?.aiBaseUrl) setAiBaseUrl(res.config.aiBaseUrl)
        if (!aiModel && res.config?.aiModel) setAiModel(res.config.aiModel)
        if (res.config?.concurrency) setConcurrency(String(res.config.concurrency))
        if (res.config?.batchSize) setBatchSize(String(res.config.batchSize))
        if (res.config?.minRuns !== undefined) setMinRuns(String(res.config.minRuns))
        if (!promptTemplate && res.config?.promptTemplate) setPromptTemplate(res.config.promptTemplate)
      })
      .catch(() => {})
    return () => c.abort()
  }, [rev])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg('')
    if (!/^https?:\/\//i.test(aiBaseUrl.trim())) { setErr('请填写合法的 AI 分析模型 API 地址'); return }
    if (!aiModel.trim()) { setErr('请填写 AI 分析模型名称'); return }
    if (!reason.trim()) { setErr('请输入配置变更原因'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/agent-insights/config/request', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          aiBaseUrl: aiBaseUrl.trim(),
          aiModel: aiModel.trim(),
          aiApiKey: aiApiKey.trim() || undefined,
          concurrency: Number(concurrency || 3),
          batchSize: Number(batchSize || 10),
          minRuns: Number(minRuns || 0),
          promptTemplate: promptTemplate.trim(),
          reason: reason.trim(),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || body?.error?.message || '提交配置工单失败')
      setMsg(`配置变更工单 ${body.ticket?.ticketNo} 已提交，系统管理员审批通过后立即热生效`)
      setAiApiKey('')
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '提交配置工单失败')
    } finally {
      setBusy(false)
    }
  }

  const approve = async (ticketNo: string, decision: 'approve' | 'reject') => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/agent-insights/config/approve', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ticketNo, decision}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || body?.error?.message || '审批失败')
      setMsg(decision === 'approve' ? `工单 ${ticketNo} 已审批通过，AI 应用分析配置已热生效` : `工单 ${ticketNo} 已驳回`)
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '审批失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="cfg-04-form" className="org-page-stack">
      <form onSubmit={submit} className="form-section">
        <div className="section-heading">
          <span>02</span>
          <div><h4>智能体 AI 作用分析引擎与提示词配置</h4></div>
        </div>

        {activeCfg && (
          <div className="app-audit-card" style={{marginBottom: 8}}>
            <div className="app-audit-metrics">
              <div><span>当前状态</span><strong>{activeCfg.configured ? '已配置生效' : '未配置'}</strong></div>
              <div><span>生效模型</span><strong>{activeCfg.aiModel || '—'}</strong></div>
              <div><span>配置版本</span><strong>v{activeCfg.version}</strong></div>
              <div><span>并发 / 批大小</span><strong>{activeCfg.concurrency} / {activeCfg.batchSize}</strong></div>
            </div>
          </div>
        )}

        <div className="form-row">
          <FormField label="AI 模型 API 地址" source="用户" required>
            <input value={aiBaseUrl} onChange={e => setAiBaseUrl(e.target.value)} required placeholder="例如 http://192.168.2.101:3000/v1" />
          </FormField>
          <FormField label="AI 分析模型名称" source="用户" required>
            <input value={aiModel} onChange={e => setAiModel(e.target.value)} required placeholder="例如 deepseek-v4-flash" />
          </FormField>
        </div>

        <div className="form-row">
          <FormField label="API Key 凭证" source="用户">
            <input type="password" value={aiApiKey} onChange={e => setAiApiKey(e.target.value)} placeholder={activeCfg?.hasApiKey ? '留空则保留当前已加密密钥' : '输入 OpenAI 兼容接口密钥'} />
          </FormField>
          <FormField label="并发分析数" source="用户">
            <input type="number" min={1} max={10} value={concurrency} onChange={e => setConcurrency(e.target.value)} />
          </FormField>
          <FormField label="每批数量" source="用户">
            <input type="number" min={1} max={50} value={batchSize} onChange={e => setBatchSize(e.target.value)} />
          </FormField>
          <FormField label="高频扫描默认阈值" source="用户">
            <input type="number" min={0} value={minRuns} onChange={e => setMinRuns(e.target.value)} />
          </FormField>
        </div>

        <FormField label="AI 功能分析提示词模板" source="用户" required>
          <textarea
            value={promptTemplate}
            onChange={e => setPromptTemplate(e.target.value)}
            rows={10}
            required
            style={{fontFamily: 'monospace', fontSize: 12}}
            placeholder="使用 {yaml} 占位符表示应用的 DSL YAML 内容"
          />
        </FormField>

        <FormField label="配置变更原因" source="用户" required>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} required placeholder="请说明首次配置、切换分析模型或调整提示词模板的原因" />
        </FormField>

        {err && <p role="alert" style={{color: '#b42318', fontSize: 13, margin: 0}}>{err}</p>}
        {msg && <p role="status" style={{color: '#027a48', fontSize: 13, fontWeight: 500, margin: 0}}>{msg}</p>}

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在提交…' : '提交 CFG-04 配置变更工单'}
          </button>
        </div>
      </form>

      {tickets.length > 0 && (
        <section className="form-section">
          <div className="section-heading">
            <span>03</span>
            <div><h4>CFG-04 配置变更审批记录</h4></div>
          </div>
          <div className="org-table-wrap">
            <table className="org-table">
              <thead>
                <tr><th>工单号</th><th>分析模型</th><th>API 地址</th><th>并发/批</th><th>变更原因</th><th>状态</th><th>审批操作</th></tr>
              </thead>
              <tbody>
                {tickets.slice(0, 10).map(t => (
                  <tr key={t.ticketNo}>
                    <td><code className="org-code">{t.ticketNo}</code></td>
                    <td>{t.aiModel}</td>
                    <td><code className="org-code">{t.aiBaseUrl}</code></td>
                    <td>{t.concurrency} / {t.batchSize}</td>
                    <td>{t.reason}</td>
                    <td><span className={`app-status-pill ${pillTone(t.status)}`}>{t.status}</span></td>
                    <td>
                      {t.status === '待审批' && canApprove ? (
                        <div style={{display: 'flex', gap: 6}}>
                          <button type="button" className="row-action" disabled={busy} onClick={() => approve(t.ticketNo, 'approve')}>批准生效</button>
                          <button type="button" className="row-action" style={{color: '#b42318'}} disabled={busy} onClick={() => approve(t.ticketNo, 'reject')}>驳回</button>
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
    </div>
  )
}
