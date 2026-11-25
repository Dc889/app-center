import {useEffect, useState} from 'react'
import {FormField} from '../../../shared-ui/UiPrimitives'

type UniquePlugin = {
  pluginId: string
  pluginUniqueIdentifier: string
  version: string
  installedWorkspacesCount: number
  totalWorkspacesCount: number
  runningPid: number | null
  cpuPercent: number | null
  memoryMb: number | null
  processStatus: string
}

type WorkspaceOption = {
  workspaceId: string
  workspaceName: string
  ownerName: string
  org: string
  installedCount: number
}

type BatchTicket = {
  ticketNo: string
  operationType: string
  targetWorkspaceName: string | null
  targetPluginId: string | null
  reason: string
  applicantName: string
  status: string
  createdAt: string
  executionSummary: string | null
  reviewNote: string | null
}

type GovData = {
  daemon: {available: boolean; containerName: string | null; totalMemoryMb: number; processes: unknown[]}
  uniquePlugins: UniquePlugin[]
  workspaces: WorkspaceOption[]
  tickets: BatchTicket[]
}

function pillTone(status: string) {
  if (status === '已完成') return 'tone-success'
  if (status === '已驳回') return 'tone-danger'
  return 'tone-pending'
}

export function PluginBatchTicketForm() {
  const [data, setData] = useState<GovData | null>(null)
  const [operationType, setOperationType] = useState<'新户全量安装' | '新插件全员推送' | '高危插件全员卸载' | '重启插件服务进程'>('新户全量安装')
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('')
  const [targetPluginId, setTargetPluginId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    fetch('/api/plugin-governance', {signal: c.signal})
      .then(async r => (r.ok ? r.json() : null))
      .then((res: GovData | null) => {
        if (!res || c.signal.aborted) return
        setData(res)
        let prefill: any = null
        try {
          const raw = sessionStorage.getItem('plg05-prefill')
          if (raw) {
            prefill = JSON.parse(raw)
            sessionStorage.removeItem('plg05-prefill')
          }
        } catch {}
        if (prefill?.operationType) setOperationType(prefill.operationType)
        if (prefill?.targetWorkspaceId) setTargetWorkspaceId(prefill.targetWorkspaceId)
        else if (!targetWorkspaceId && res.workspaces?.[0]) setTargetWorkspaceId(res.workspaces[0].workspaceId)
        if (prefill?.targetPluginId) setTargetPluginId(prefill.targetPluginId)
        else if (!targetPluginId && res.uniquePlugins?.[0]) setTargetPluginId(res.uniquePlugins[0].pluginId)
      })
      .catch(() => {})
    return () => c.abort()
  }, [rev])

  const selectedWs = data?.workspaces.find(w => w.workspaceId === targetWorkspaceId) ?? null
  const selectedPlugin = data?.uniquePlugins.find(p => p.pluginId === targetPluginId) ?? null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg('')
    if (operationType === '新户全量安装' && !targetWorkspaceId) { setErr('请选择目标租户工作区'); return }
    if ((operationType === '新插件全员推送' || operationType === '高危插件全员卸载') && !targetPluginId) { setErr('请选择目标插件'); return }
    if (!reason.trim()) { setErr('请输入申请原因'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/plugin-governance/request', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          operationType,
          targetWorkspaceId: operationType === '新户全量安装' ? targetWorkspaceId : undefined,
          targetWorkspaceName: operationType === '新户全量安装' ? selectedWs?.workspaceName : undefined,
          targetPluginId: (operationType === '新插件全员推送' || operationType === '高危插件全员卸载') ? targetPluginId : undefined,
          targetPluginUid: (operationType === '新插件全员推送' || operationType === '高危插件全员卸载') ? selectedPlugin?.pluginUniqueIdentifier : undefined,
          reason: reason.trim(),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '工单提交失败')
      setMsg(`插件管控工单 ${body.ticket?.ticketNo} 已提交，请在「插件监控」审批后自动下发执行`)
      setReason('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '工单提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="plg-05-form" className="org-page-stack">
      <form onSubmit={submit} className="form-section">
        <div className="section-heading">
          <span>02</span>
          <div><h4>批量分发与进程管控</h4></div>
        </div>

        <div className="form-row">
          <FormField label="管控操作类型" source="用户" required>
            <select value={operationType} onChange={e => setOperationType(e.target.value as any)}>
              <option value="新户全量安装">新户全量安装内网插件</option>
              <option value="新插件全员推送">新插件全员批量推送</option>
              <option value="高危插件全员卸载">高危插件全员批量卸载</option>
              <option value="重启插件服务进程">重启插件守护进程</option>
            </select>
          </FormField>

          {operationType === '新户全量安装' && (
            <FormField label="目标租户工作区" source="用户" required>
              <select value={targetWorkspaceId} onChange={e => setTargetWorkspaceId(e.target.value)} required>
                <option value="">请选择目标工作区</option>
                {(data?.workspaces ?? []).map(w => (
                  <option key={w.workspaceId} value={w.workspaceId}>{w.workspaceName} · {w.ownerName} · 已装 {w.installedCount}</option>
                ))}
              </select>
            </FormField>
          )}

          {(operationType === '新插件全员推送' || operationType === '高危插件全员卸载') && (
            <FormField label="目标插件" source="用户" required>
              <select value={targetPluginId} onChange={e => setTargetPluginId(e.target.value)} required>
                <option value="">请选择目标插件</option>
                {(data?.uniquePlugins ?? []).map(p => (
                  <option key={p.pluginId} value={p.pluginId}>{p.pluginId} · v{p.version} · 已装 {p.installedWorkspacesCount}/{p.totalWorkspacesCount} 租户</option>
                ))}
              </select>
            </FormField>
          )}
        </div>

        {data && (
          <div className="app-audit-card" style={{marginTop: 4}}>
            <div className="app-audit-metrics">
              <div><span>内网白名单插件</span><strong>{data.uniquePlugins.length}</strong></div>
              <div><span>纳管租户工作区</span><strong>{data.workspaces.length}</strong></div>
              <div><span>活跃插件进程</span><strong>{data.daemon.processes.length}</strong></div>
              <div><span>插件总内存占用</span><strong>{data.daemon.totalMemoryMb} MB</strong></div>
            </div>
          </div>
        )}

        <FormField label="申请原因" source="用户" required>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} required placeholder="请输入批量分发、全员卸载或进程重启依据" />
        </FormField>

        {err && <p role="alert" style={{color: '#b42318', fontSize: 13, margin: 0}}>{err}</p>}
        {msg && <p role="status" style={{color: '#027a48', fontSize: 13, fontWeight: 500, margin: 0}}>{msg}</p>}

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在提交…' : '提交插件管控工单'}
          </button>
        </div>
      </form>

      {data && data.tickets.length > 0 && (
        <section className="form-section">
          <div className="section-heading">
            <span>03</span>
            <div><h4>批量分发与进程管控记录</h4></div>
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
                    <td>{t.targetWorkspaceName || t.targetPluginId || 'plugin_daemon'}</td>
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
