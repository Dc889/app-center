import {Fragment, useEffect, useState} from 'react'
import {FileCode2, Plus, RefreshCw, RotateCcw, ServerCog, ShieldCheck, Terminal} from 'lucide-react'
import {PageHeader} from '../../../shared-ui/UiContext'
import type {View} from '../../../shared-ui/UiContextData'
import {FormField} from '../../../shared-ui/UiPrimitives'

type ServiceRow = {
  product: 'Dify' | 'RAGFlow'
  service: string
  containerName: string
  status: string
  detail: string
  cpuPercent?: number | null
  memory?: string | null
  memoryPercent?: number | null
  netIo?: string | null
  blockIo?: string | null
  pids?: number | null
}

type Usage = {usedBytes: number; totalBytes: number; percent: number} | null

type HostReport = {
  availability: 'collected' | 'not_collected'
  hostname: string | null
  cpuPercent: number | null
  memory: Usage
  storage: Usage
}

type ProductBlock = {running: number | null; unavailable: number | null; services: ServiceRow[]}

type Report = {
  availability: 'collected' | 'not_collected'
  reason: string | null
  checkedAt: string
  autoRestart: boolean
  host?: HostReport
  products: {Dify: ProductBlock; RAGFlow: ProductBlock}
  emptyNote: string | null
}

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
  scriptHash: string
  execMode: string
  triggerSource: '人工发起' | '系统自动自愈'
  applicant: string
  applicantName: string
  reason: string
  status: string
  approvalMode: string
  reviewerName: string | null
  reviewNote: string | null
  createdAt: string
  finishedAt: string | null
  durationMs: number | null
  exitCode: number | null
  executionLog: string | null
  recheckSummary: string | null
}

type RestartData = {
  canEditScripts: boolean
  canApprove: boolean
  scripts: RestartScript[]
  tickets: RestartTicket[]
}

function countText(value: number | null) {
  return value === null ? '未采集' : String(value)
}

function percentText(value: number | null | undefined) {
  return value === null || value === undefined ? '未采集' : `${value}%`
}

function byteText(value: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(unit === 0 ? 0 : 1) : size.toFixed(2)} ${units[unit]}`
}

function usageText(usage: Usage) {
  return usage ? `${byteText(usage.usedBytes)} / ${byteText(usage.totalBytes)}` : '未采集'
}

function textOrMissing(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? '未采集' : String(value)
}

function timeText(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', {hour12: false}) : '未采集'
}

function statusTone(status: string) {
  if (status === '已完成' || status === '运行中') return 'tone-success'
  if (status === '执行失败' || status === '已驳回' || status === '不可用') return 'tone-danger'
  if (status === '执行中' || status === '启动中' || status === '重启中') return 'tone-progress'
  return 'tone-pending'
}

function ServiceTable({
  name,
  block,
  emptyNote,
  collected,
  onRestartProduct,
  onRestartContainer,
}: {
  name: 'Dify' | 'RAGFlow'
  block: ProductBlock
  emptyNote: string | null
  collected: boolean
  onRestartProduct: (product: 'Dify' | 'RAGFlow') => void
  onRestartContainer: (product: 'Dify' | 'RAGFlow', containerName: string) => void
}) {
  return (
    <section className="panel" style={{marginBottom: 16}}>
      <div className="panel-title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10}}>
        <div>
          <h3><ServerCog size={15} /> {name} 服务</h3>
          <p>实时展示该产品 Compose 项目容器与资源占用；故障时可通过管理员固定脚本发起 SVC-01 重启工单。</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => onRestartProduct(name)} style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
          <RotateCcw size={14} /> 发起 {name} 重启工单
        </button>
      </div>
      <div className="metric-grid four">
        <article className="metric-card"><span>运行中</span><strong>{countText(block.running)}</strong></article>
        <article className="metric-card"><span>不可用</span><strong style={{color: (block.unavailable ?? 0) > 0 ? '#b42318' : undefined}}>{countText(block.unavailable)}</strong></article>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>服务</th><th>容器</th><th>状态</th><th>CPU</th><th>内存</th><th>内存占比</th><th>网络 IO</th><th>磁盘 IO</th><th>进程数</th><th>状态说明</th><th>工单操作</th>
            </tr>
          </thead>
          <tbody>
            {collected && block.services.length > 0 ? block.services.map(row => (
              <tr key={row.containerName + row.service}>
                <td>{row.service}</td>
                <td><code className="org-code">{row.containerName}</code></td>
                <td><span className={`app-status-pill ${statusTone(row.status)}`}>{row.status}</span></td>
                <td>{percentText(row.cpuPercent)}</td>
                <td>{textOrMissing(row.memory)}</td>
                <td>{percentText(row.memoryPercent)}</td>
                <td>{textOrMissing(row.netIo)}</td>
                <td>{textOrMissing(row.blockIo)}</td>
                <td>{textOrMissing(row.pids)}</td>
                <td>{row.detail || '未采集'}</td>
                <td>
                  <button
                    type="button"
                    className="row-action"
                    onClick={() => onRestartContainer(name, row.containerName)}
                  >
                    定点重启
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={11}>{collected ? emptyNote : '未采集'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function ServiceMonitor({
  onNavigate,
}: {
  role?: 'user' | 'ops' | 'admin'
  onNavigate?: (view: View, ticketType?: string | null) => void
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [restartData, setRestartData] = useState<RestartData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [sourceFilter, setSourceFilter] = useState<'all' | '人工发起' | '系统自动自愈'>('all')
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{tone: 'ok' | 'err'; text: string} | null>(null)

  // Admin script editor state
  const [editing, setEditing] = useState<boolean>(false)
  const [editId, setEditId] = useState('')
  const [editName, setEditName] = useState('')
  const [editProduct, setEditProduct] = useState<'Dify' | 'RAGFlow'>('Dify')
  const [editExecMode, setEditExecMode] = useState<'docker-api' | 'ssh-shell'>('docker-api')
  const [editDesc, setEditDesc] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editSshHost, setEditSshHost] = useState('')
  const [editSshPort, setEditSshPort] = useState('22')
  const [editSshUser, setEditSshUser] = useState('root')
  const [editSshPassword, setEditSshPassword] = useState('')
  const [editAutoHeal, setEditAutoHeal] = useState(false)
  const [editFailThreshold, setEditFailThreshold] = useState('3')
  const [editCooldown, setEditCooldown] = useState('10')
  const [editMaxPerHour, setEditMaxPerHour] = useState('2')
  const [editEnabled, setEditEnabled] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetch('/api/service-monitor', {signal: controller.signal}).then(async r => {
        const b = await r.json()
        if (!r.ok) throw Error(b.error?.message ?? '读取服务监控失败')
        return b as Report
      }),
      fetch('/api/service-restart', {signal: controller.signal}).then(async r => (r.ok ? (r.json() as Promise<RestartData>) : null)),
    ])
      .then(([mon, rst]) => {
        if (controller.signal.aborted) return
        setReport(mon)
        if (rst) setRestartData(rst)
        setError('')
      })
      .catch(reason => {
        if (reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '读取服务监控失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [refresh])

  const openSvc01 = (prefill: Record<string, string>) => {
    try { sessionStorage.setItem('svc01-prefill', JSON.stringify(prefill)) } catch {}
    if (onNavigate) onNavigate('manual', 'SVC-01')
  }

  const startNewScript = () => {
    setEditId('')
    setEditName('')
    setEditProduct('Dify')
    setEditExecMode('docker-api')
    setEditDesc('')
    setEditContent('# Dify 分层有序重启\nlayer: sandbox,plugin_daemon\nlayer: api,worker,worker_beat\nlayer: web\nlayer: nginx')
    setEditSshHost('')
    setEditSshPort('22')
    setEditSshUser('root')
    setEditSshPassword('')
    setEditAutoHeal(false)
    setEditFailThreshold('3')
    setEditCooldown('10')
    setEditMaxPerHour('2')
    setEditEnabled(true)
    setEditing(true)
    setNotice(null)
  }

  const startEditScript = (s: RestartScript) => {
    setEditId(s.scriptId)
    setEditName(s.name)
    setEditProduct(s.product)
    setEditExecMode(s.execMode)
    setEditDesc(s.description || '')
    setEditContent(s.scriptContent)
    setEditSshHost(s.sshHost || '')
    setEditSshPort(String(s.sshPort || 22))
    setEditSshUser(s.sshUser || 'root')
    setEditSshPassword('')
    setEditAutoHeal(Boolean(s.autoHealEnabled))
    setEditFailThreshold(String(s.failThreshold || 3))
    setEditCooldown(String(s.cooldownMinutes || 10))
    setEditMaxPerHour(String(s.maxAutoPerHour || 2))
    setEditEnabled(s.enabled !== false)
    setEditing(true)
    setNotice(null)
  }

  const saveScript = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      const r = await fetch('/api/service-restart/scripts', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          scriptId: editId || undefined,
          name: editName.trim(),
          product: editProduct,
          execMode: editExecMode,
          description: editDesc.trim(),
          scriptContent: editContent,
          sshHost: editSshHost.trim(),
          sshPort: Number(editSshPort || 22),
          sshUser: editSshUser.trim() || 'root',
          sshPassword: editSshPassword || undefined,
          enabled: editEnabled,
          autoHealEnabled: editAutoHeal,
          failThreshold: Number(editFailThreshold || 3),
          cooldownMinutes: Number(editCooldown || 10),
          maxAutoPerHour: Number(editMaxPerHour || 2),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || body?.error?.message || '保存固定脚本失败')
      setNotice({tone: 'ok', text: `固定脚本「${body.script?.name} v${body.script?.version}」已保存并生成校验哈希`})
      setEditing(false)
      setRefresh(n => n + 1)
    } catch (e: any) {
      setNotice({tone: 'err', text: e?.message || '保存固定脚本失败'})
    } finally {
      setBusy(false)
    }
  }

  const approveTicket = async (ticketNo: string, decision: 'approve' | 'reject') => {
    setBusy(true)
    setNotice(null)
    try {
      const r = await fetch('/api/service-restart/approve', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ticketNo, decision}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || body?.error?.message || '审批执行失败')
      const t = body.ticket
      setNotice({
        tone: t?.status === '执行失败' ? 'err' : 'ok',
        text: decision === 'approve'
          ? `工单 ${ticketNo} 已执行（${t?.status}）：${t?.recheckSummary || '请查看执行日志'}`
          : `工单 ${ticketNo} 已驳回`,
      })
      if (decision === 'approve') setExpandedLog(ticketNo)
      setRefresh(n => n + 1)
    } catch (e: any) {
      setNotice({tone: 'err', text: e?.message || '审批执行失败'})
    } finally {
      setBusy(false)
    }
  }

  const collected = report?.availability === 'collected'
  const allTickets = restartData?.tickets ?? []
  const filteredTickets = sourceFilter === 'all' ? allTickets : allTickets.filter(t => t.triggerSource === sourceFilter)
  const autoHealEnabledCount = (restartData?.scripts ?? []).filter(s => s.enabled && s.autoHealEnabled).length

  return (
    <div data-testid="service-monitor">
      <PageHeader
        view="serviceMonitor"
        action={
          <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
            <button type="button" className="primary-button" onClick={() => openSvc01({product: 'Dify'})}>
              发起 SVC-01 重启工单
            </button>
            <button className="icon-button" onClick={() => { setLoading(true); setRefresh(v => v + 1) }} title="刷新" disabled={loading}>
              <RefreshCw size={15} />
            </button>
          </div>
        }
      />

      {error && <p role="alert">{error}</p>}
      {notice && (
        <div
          role="status"
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            background: notice.tone === 'ok' ? '#ecfdf3' : '#fef2f2',
            color: notice.tone === 'ok' ? '#027a48' : '#b42318',
            border: `1px solid ${notice.tone === 'ok' ? '#a6f4c5' : '#fecaca'}`,
          }}
        >
          {notice.text}
        </div>
      )}

      <p style={{fontSize: 13, color: '#475569', marginBottom: 14}}>
        自动自愈策略：{autoHealEnabledCount > 0 ? `已启用 ${autoHealEnabledCount} 套固定脚本自动自愈（带防抖/冷却/熔断，自动写入 SVC-01 工单留痕）` : '当前为人工工单模式（系统管理员可在下方固定脚本库按需开启自动自愈）'} · 最近巡检：{timeText(report?.checkedAt ?? null)}
      </p>
      {report && !collected && <p role="status">{report.reason ?? '未采集'}</p>}

      {/* 宿主机资源 */}
      <section className="panel" data-testid="host-resources" style={{marginBottom: 16}}>
        <div className="panel-title"><div><h3><ServerCog size={15} /> 部署服务器</h3><p>统计运行管理服务的宿主机实时负载。主机名：{report?.host?.hostname || '未采集'}</p></div></div>
        <div className="metric-grid" style={{gridTemplateColumns: 'repeat(3, minmax(0, 1fr))'}}>
          <article className="metric-card"><span>CPU 使用</span><strong>{percentText(report?.host?.cpuPercent ?? null)}</strong><small>当前采样</small></article>
          <article className="metric-card"><span>内存占用</span><strong>{percentText(report?.host?.memory?.percent ?? null)}</strong><small>{usageText(report?.host?.memory ?? null)}</small></article>
          <article className="metric-card"><span>存储占用</span><strong>{percentText(report?.host?.storage?.percent ?? null)}</strong><small>{usageText(report?.host?.storage ?? null)}</small></article>
        </div>
      </section>

      {/* Dify & RAGFlow 服务表 */}
      <ServiceTable
        name="Dify"
        block={report?.products.Dify ?? {running: null, unavailable: null, services: []}}
        emptyNote={report?.emptyNote ?? null}
        collected={!!collected}
        onRestartProduct={p => openSvc01({product: p})}
        onRestartContainer={(p, c) => openSvc01({product: p, targetContainer: c})}
      />
      <ServiceTable
        name="RAGFlow"
        block={report?.products.RAGFlow ?? {running: null, unavailable: null, services: []}}
        emptyNote={report?.emptyNote ?? null}
        collected={!!collected}
        onRestartProduct={p => openSvc01({product: p})}
        onRestartContainer={(p, c) => openSvc01({product: p, targetContainer: c})}
      />

      {/* 管理员固定重启脚本库 */}
      <section className="panel" data-testid="service-restart-scripts" style={{marginBottom: 16}}>
        <div className="panel-title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10}}>
          <div>
            <h3><FileCode2 size={15} /> 固定重启脚本库</h3>
            <p>仅系统管理员可编辑和保存固定脚本；运维发起 SVC-01 或系统自动自愈时严格按锁定版本与哈希执行，防止任意命令注入。</p>
          </div>
          {restartData?.canEditScripts && (
            <button type="button" className="primary-button" onClick={startNewScript} style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
              <Plus size={14} /> 新增固定脚本
            </button>
          )}
        </div>

        {editing && restartData?.canEditScripts && (
          <form onSubmit={saveScript} className="form-section" style={{marginBottom: 16}}>
            <div className="section-heading">
              <span><ShieldCheck size={14} /></span>
              <div><h4>{editId ? '编辑固定重启脚本' : '新增固定重启脚本'}</h4></div>
            </div>

            <div className="form-row">
              <FormField label="脚本名称" source="用户" required>
                <input value={editName} onChange={e => setEditName(e.target.value)} required placeholder="例如 Dify 应用层有序重启" />
              </FormField>
              <FormField label="目标子系统" source="用户" required>
                <select value={editProduct} onChange={e => setEditProduct(e.target.value as 'Dify' | 'RAGFlow')}>
                  <option value="Dify">Dify</option>
                  <option value="RAGFlow">RAGFlow</option>
                </select>
              </FormField>
            </div>

            <div className="form-row">
              <FormField label="执行通道" source="用户" required>
                <select value={editExecMode} onChange={e => setEditExecMode(e.target.value as 'docker-api' | 'ssh-shell')}>
                  <option value="docker-api">本机 Docker Engine API 分层有序重启</option>
                  <option value="ssh-shell">目标服务器 SSH 执行固定 Shell 脚本</option>
                </select>
              </FormField>
              <FormField label="脚本状态" source="用户">
                <select value={editEnabled ? '1' : '0'} onChange={e => setEditEnabled(e.target.value === '1')}>
                  <option value="1">已启用</option>
                  <option value="0">已停用</option>
                </select>
              </FormField>
            </div>

            {editExecMode === 'ssh-shell' && (
              <div className="form-row">
                <FormField label="目标主机 IP" source="用户" required>
                  <input value={editSshHost} onChange={e => setEditSshHost(e.target.value)} required placeholder="例如 192.168.0.7" />
                </FormField>
                <FormField label="SSH 端口" source="用户">
                  <input type="number" value={editSshPort} onChange={e => setEditSshPort(e.target.value)} />
                </FormField>
                <FormField label="SSH 账号" source="用户" required>
                  <input value={editSshUser} onChange={e => setEditSshUser(e.target.value)} required />
                </FormField>
                <FormField label="SSH 密码" source="用户">
                  <input type="password" value={editSshPassword} onChange={e => setEditSshPassword(e.target.value)} placeholder={editId ? '留空则保留已存密码' : '输入 SSH 登录密码'} />
                </FormField>
              </div>
            )}

            <div className="form-row">
              <FormField label="自动自愈开关" source="用户">
                <select value={editAutoHeal ? '1' : '0'} onChange={e => setEditAutoHeal(e.target.value === '1')}>
                  <option value="0">关闭自动自愈 · 仅人工 SVC-01 审批执行</option>
                  <option value="1">开启自动自愈 · 故障达阈值自动建单执行</option>
                </select>
              </FormField>
              <FormField label="连续失败触发次数" source="用户">
                <input type="number" min={1} max={20} value={editFailThreshold} onChange={e => setEditFailThreshold(e.target.value)} />
              </FormField>
              <FormField label="冷却分钟数" source="用户">
                <input type="number" min={1} max={180} value={editCooldown} onChange={e => setEditCooldown(e.target.value)} />
              </FormField>
              <FormField label="每小时熔断上限" source="用户">
                <input type="number" min={1} max={6} value={editMaxPerHour} onChange={e => setEditMaxPerHour(e.target.value)} />
              </FormField>
            </div>

            <FormField label="脚本用途说明" source="用户">
              <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="简要说明脚本适用场景与影响范围" />
            </FormField>

            <FormField label="固定脚本内容" source="用户" required>
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                rows={8}
                required
                style={{fontFamily: 'monospace', fontSize: 12}}
              />
            </FormField>

            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={busy}>{busy ? '保存中…' : '保存固定脚本'}</button>
              <button type="button" className="secondary-button" onClick={() => setEditing(false)}>取消</button>
            </div>
          </form>
        )}

        <div className="org-table-wrap">
          <table className="org-table">
            <thead>
              <tr>
                <th>脚本名称</th><th>子系统</th><th>执行方式</th><th>版本与哈希</th><th>自动自愈策略</th><th>维护人</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {(restartData?.scripts ?? []).map(s => (
                <tr key={s.scriptId}>
                  <td>
                    <div style={{fontWeight: 500}}>{s.name}</div>
                    {s.description && <div style={{fontSize: 12, color: '#64748b'}}>{s.description}</div>}
                  </td>
                  <td>{s.product}</td>
                  <td>
                    {s.execMode === 'ssh-shell' ? `目标机 SSH (${s.sshHost || '未配'})` : '本机 Docker API'}
                  </td>
                  <td>
                    <code className="org-code">v{s.version} · {s.scriptHash.slice(0, 10)}</code>
                  </td>
                  <td>
                    {s.autoHealEnabled ? (
                      <span className="app-status-pill tone-progress">自动自愈 · 连续{s.failThreshold}次/{s.maxAutoPerHour}次时熔断</span>
                    ) : (
                      <span className="app-status-pill tone-muted">仅人工工单</span>
                    )}
                  </td>
                  <td>
                    <div>{s.updatedByName}</div>
                    <div style={{fontSize: 11, color: '#64748b'}}>{timeText(s.updatedAt)}</div>
                  </td>
                  <td>
                    <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => openSvc01({product: s.product, scriptId: s.scriptId})}
                      >
                        用此脚本提单
                      </button>
                      {restartData?.canEditScripts && (
                        <button type="button" className="row-action" onClick={() => startEditScript(s)}>
                          编辑
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 统一 SVC-01 服务重启工单台账（人工发起 + 系统自动自愈） */}
      <section className="panel" data-testid="service-restart-tickets">
        <div className="panel-title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10}}>
          <div>
            <h3><Terminal size={15} /> SVC-01 服务重启工单台账</h3>
            <p>人工发起与系统自动自愈共用同一张工单台账，完整记录脚本版本、操作人、执行日志与健康复检结果。</p>
          </div>
          <div style={{display: 'flex', gap: 6}}>
            {(['all', '人工发起', '系统自动自愈'] as const).map(f => (
              <button
                key={f}
                type="button"
                className={sourceFilter === f ? 'primary-button' : 'secondary-button'}
                onClick={() => setSourceFilter(f)}
              >
                {f === 'all' ? `全部 (${allTickets.length})` : `${f} (${allTickets.filter(t => t.triggerSource === f).length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="org-table-wrap">
          <table className="org-table">
            <thead>
              <tr>
                <th>工单号</th><th>触发来源</th><th>操作人</th><th>子系统与固定脚本</th><th>状态</th><th>审批与复检结果</th><th>时间</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.length > 0 ? filteredTickets.map(t => (
                <Fragment key={t.ticketNo}>
                  <tr>
                    <td><code className="org-code">{t.ticketNo}</code></td>
                    <td>
                      <span className={`app-status-pill ${t.triggerSource === '系统自动自愈' ? 'tone-progress' : 'tone-muted'}`}>
                        {t.triggerSource}
                      </span>
                    </td>
                    <td>{t.applicantName}</td>
                    <td>
                      <div>{t.product} · {t.scriptName} v{t.scriptVersion}{t.targetContainer ? ` · ${t.targetContainer}` : ''}</div>
                      <div style={{fontSize: 12, color: '#64748b'}}>{t.reason}</div>
                    </td>
                    <td><span className={`app-status-pill ${statusTone(t.status)}`}>{t.status}</span></td>
                    <td>
                      {t.status === '待审批' && restartData?.canApprove ? (
                        <div style={{display: 'flex', gap: 6}}>
                          <button type="button" className="row-action" disabled={busy} onClick={() => approveTicket(t.ticketNo, 'approve')}>
                            批准执行
                          </button>
                          <button type="button" className="row-action" style={{color: '#b42318'}} disabled={busy} onClick={() => approveTicket(t.ticketNo, 'reject')}>
                            驳回
                          </button>
                        </div>
                      ) : (
                        <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                          <span style={{fontSize: 12, color: '#334155'}}>{t.recheckSummary || t.reviewNote || '-'}</span>
                          {t.executionLog && (
                            <button
                              type="button"
                              className="row-action"
                              style={{alignSelf: 'flex-start'}}
                              onClick={() => setExpandedLog(expandedLog === t.ticketNo ? null : t.ticketNo)}
                            >
                              {expandedLog === t.ticketNo ? '收起日志' : `查看日志${t.durationMs !== null ? ` (${t.durationMs}ms)` : ''}`}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{fontSize: 12, color: '#64748b'}}>{timeText(t.finishedAt || t.createdAt)}</td>
                  </tr>
                  {expandedLog === t.ticketNo && t.executionLog && (
                    <tr key={t.ticketNo + '-log'}>
                      <td colSpan={7} style={{background: '#0f172a', padding: 12}}>
                        <pre style={{margin: 0, color: '#e2e8f0', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all'}}>
                          {t.executionLog}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )) : (
                <tr><td colSpan={7} style={{textAlign: 'center', color: '#9ca3af', padding: '24px 0'}}>当前暂无 SVC-01 服务重启工单记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
