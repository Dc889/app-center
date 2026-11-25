import {useEffect, useState} from 'react'
import {FormField} from '../../../shared-ui/UiPrimitives'

type UniqueMcp = {
  serverIdentifier: string
  name: string
  boundWorkspacesCount: number
  totalWorkspacesCount: number
  probeStatus: string
  latencyMs: number | null
  checkedAt: string | null
  proxyCalls: number
  proxyErrors: number
  avgProxyLatencyMs: number | null
  isolated: boolean
}

type WorkspaceOption = {
  workspaceId: string
  workspaceName: string
  ownerAccount: string
  ownerName: string
  org: string
  boundCount: number
}

type McpBatchTicket = {
  ticketNo: string
  operationType: string
  targetWorkspaceName: string | null
  targetMcpId: string | null
  targetMcpName: string | null
  reason: string
  applicantName: string
  status: string
  createdAt: string
  executionSummary: string | null
  reviewNote: string | null
}

type McpGovData = {
  capturedAt: string
  syncedAt: string | null
  uniqueMcps: UniqueMcp[]
  workspaces: WorkspaceOption[]
  tickets: McpBatchTicket[]
}

function pillTone(status: string) {
  if (status === '已完成') return 'tone-success'
  if (status === '已驳回') return 'tone-danger'
  return 'tone-pending'
}

export function McpBatchTicketForm() {
  const [data, setData] = useState<McpGovData | null>(null)
  const [operationType, setOperationType] = useState<'新户默认绑定公开MCP' | '公开MCP全员推送' | '高危MCP全员解绑下架'>('新户默认绑定公开MCP')
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('')
  const [targetMcpId, setTargetMcpId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    fetch('/api/mcp-governance', {signal: c.signal})
      .then(async r => (r.ok ? r.json() : null))
      .then((res: McpGovData | null) => {
        if (!res || c.signal.aborted) return
        setData(res)
        let prefill: any = null
        try {
          const raw = sessionStorage.getItem('mcp04-prefill')
          if (raw) {
            prefill = JSON.parse(raw)
            sessionStorage.removeItem('mcp04-prefill')
          }
        } catch {}
        if (prefill?.operationType) setOperationType(prefill.operationType)
        if (prefill?.targetWorkspaceId) setTargetWorkspaceId(prefill.targetWorkspaceId)
        else if (!targetWorkspaceId && res.workspaces?.[0]) setTargetWorkspaceId(res.workspaces[0].workspaceId)
        if (prefill?.targetMcpId) setTargetMcpId(prefill.targetMcpId)
        else if (!targetMcpId && res.uniqueMcps?.[0]) setTargetMcpId(res.uniqueMcps[0].serverIdentifier)
      })
      .catch(() => {})
    return () => c.abort()
  }, [rev])

  const selectedWs = data?.workspaces.find(w => w.workspaceId === targetWorkspaceId) ?? null
  const selectedMcp = data?.uniqueMcps.find(m => m.serverIdentifier === targetMcpId) ?? null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg('')
    if (operationType === '新户默认绑定公开MCP' && !targetWorkspaceId) { setErr('请选择目标租户工作区'); return }
    if (operationType !== '新户默认绑定公开MCP' && !targetMcpId) { setErr('请选择目标 MCP 服务'); return }
    if (!reason.trim()) { setErr('请输入申请原因'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/mcp-governance/request', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          operationType,
          targetWorkspaceId: operationType === '新户默认绑定公开MCP' ? targetWorkspaceId : undefined,
          targetWorkspaceName: operationType === '新户默认绑定公开MCP' ? selectedWs?.workspaceName : undefined,
          targetMcpId: operationType !== '新户默认绑定公开MCP' ? targetMcpId : undefined,
          targetMcpName: operationType !== '新户默认绑定公开MCP' ? selectedMcp?.name : undefined,
          reason: reason.trim(),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || body?.error?.message || '工单提交失败')
      setMsg(`MCP 管控工单 ${body.ticket?.ticketNo} 已提交，请在「MCP 监控」审批后自动下发受控代理令牌`)
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '工单提交失败')
    } finally {
      setBusy(false)
    }
  }

  const healthyCount = (data?.uniqueMcps ?? []).filter(m => m.probeStatus === '健康').length
  const isolatedCount = (data?.uniqueMcps ?? []).filter(m => m.isolated).length

  return (
    <div data-testid="mcp-04-form" className="org-page-stack">
      <form onSubmit={submit} className="form-section">
        <div className="section-heading">
          <span>02</span>
          <div><h4>批量分发与隔离管控</h4></div>
        </div>

        <div className="form-row">
          <FormField label="管控操作类型" source="用户" required>
            <select value={operationType} onChange={e => setOperationType(e.target.value as any)}>
              <option value="新户默认绑定公开MCP">新户默认绑定公开 MCP</option>
              <option value="公开MCP全员推送">公开 MCP 全员推送</option>
              <option value="高危MCP全员解绑下架">高危 MCP 全员解绑下架</option>
            </select>
          </FormField>

          {operationType === '新户默认绑定公开MCP' ? (
            <FormField label="目标租户工作区" source="用户" required>
              <select value={targetWorkspaceId} onChange={e => setTargetWorkspaceId(e.target.value)} required>
                <option value="">请选择目标工作区</option>
                {(data?.workspaces ?? []).map(w => (
                  <option key={w.workspaceId} value={w.workspaceId}>{w.workspaceName} · {w.ownerName} · 已绑 {w.boundCount}</option>
                ))}
              </select>
            </FormField>
          ) : (
            <FormField label="目标 MCP 服务" source="用户" required>
              <select value={targetMcpId} onChange={e => setTargetMcpId(e.target.value)} required>
                <option value="">请选择目标 MCP</option>
                {(data?.uniqueMcps ?? []).map(m => (
                  <option key={m.serverIdentifier} value={m.serverIdentifier}>
                    {m.name} · 覆盖 {m.boundWorkspacesCount}/{m.totalWorkspacesCount} 租户 · {m.probeStatus}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </div>

        {data && (
          <div className="app-audit-card" style={{marginTop: 4}}>
            <div className="app-audit-metrics">
              <div><span>纳管 MCP 服务</span><strong>{data.uniqueMcps.length}</strong></div>
              <div><span>探针健康</span><strong>{healthyCount}</strong></div>
              <div><span>已隔离服务</span><strong>{isolatedCount}</strong></div>
              <div><span>纳管租户工作区</span><strong>{data.workspaces.length}</strong></div>
            </div>
          </div>
        )}

        <FormField label="申请原因" source="用户" required>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} required placeholder="请输入新户默认配齐、公开 MCP 全员推送或高危 MCP 全员解绑下架依据" />
        </FormField>

        {err && <p role="alert" style={{color: '#b42318', fontSize: 13, margin: 0}}>{err}</p>}
        {msg && <p role="status" style={{color: '#027a48', fontSize: 13, fontWeight: 500, margin: 0}}>{msg}</p>}

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在提交…' : '提交 MCP 管控工单'}
          </button>
        </div>
      </form>

      {data && data.tickets.length > 0 && (
        <section className="form-section">
          <div className="section-heading">
            <span>03</span>
            <div><h4>批量分发与隔离记录</h4></div>
          </div>
          <div className="org-table-wrap">
            <table className="org-table">
              <thead>
                <tr><th>工单号</th><th>操作类型</th><th>目标对象</th><th>申请原因</th><th>状态</th><th>执行结果</th></tr>
              </thead>
              <tbody>
                {data.tickets.slice(0, 10).map(t => (
                  <tr key={t.ticketNo}>
                    <td><code className="org-code">{t.ticketNo}</code></td>
                    <td>{t.operationType}</td>
                    <td>{t.targetWorkspaceName || t.targetMcpName || t.targetMcpId || '-'}</td>
                    <td>{t.reason}</td>
                    <td><span className={`app-status-pill ${pillTone(t.status)}`}>{t.status}</span></td>
                    <td>{t.executionSummary || t.reviewNote || '-'}</td>
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
