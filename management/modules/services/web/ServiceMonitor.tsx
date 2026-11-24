import {useEffect, useState} from 'react'
import {RefreshCw, ServerCog} from 'lucide-react'
import {PageHeader} from '../../../shared-ui/UiContext'

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

type RestartRow = {
  ticketNo: string
  product: string | null
  service: string | null
  containerName: string | null
  status: string
  approvalMode: string
  at: string | null
  failureReason: string | null
}

type Report = {
  availability: 'collected' | 'not_collected'
  reason: string | null
  checkedAt: string
  autoRestart: boolean
  host?: HostReport
  products: {Dify: ProductBlock; RAGFlow: ProductBlock}
  restarts: RestartRow[]
  history: RestartRow[]
  emptyNote: string | null
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

function ServiceTable({name, block, emptyNote, collected}: {name: string; block: ProductBlock; emptyNote: string | null; collected: boolean}) {
  return (
    <section className="panel" style={{marginBottom: 16}}>
      <div className="panel-title"><div><h3><ServerCog size={15} /> {name} 服务</h3><p>只列出该产品 Compose 项目里实际存在的容器。</p></div></div>
      <div className="metric-grid four">
        <article className="metric-card"><span>运行中</span><strong>{countText(block.running)}</strong></article>
        <article className="metric-card"><span>不可用</span><strong>{countText(block.unavailable)}</strong></article>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>服务</th><th>容器</th><th>状态</th><th>CPU</th><th>内存</th><th>内存占比</th><th>网络 IO</th><th>磁盘 IO</th><th>进程数</th><th>状态说明</th></tr></thead>
          <tbody>
            {collected && block.services.length > 0 ? block.services.map(row => (
              <tr key={row.containerName + row.service}>
                <td>{row.service}</td>
                <td>{row.containerName}</td>
                <td>{row.status}</td>
                <td>{percentText(row.cpuPercent)}</td>
                <td>{textOrMissing(row.memory)}</td>
                <td>{percentText(row.memoryPercent)}</td>
                <td>{textOrMissing(row.netIo)}</td>
                <td>{textOrMissing(row.blockIo)}</td>
                <td>{textOrMissing(row.pids)}</td>
                <td>{row.detail || '未采集'}</td>
              </tr>
            )) : (
              <tr><td colSpan={10}>{collected ? emptyNote : '未采集'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function ServiceMonitor() {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/service-monitor', {signal: controller.signal})
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw Error(body.error?.message ?? '读取服务监控失败')
        setReport(body)
        setError('')
      })
      .catch(reason => {
        if (reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '读取服务监控失败')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [refresh])

  const collected = report?.availability === 'collected'
  const tickets = report?.history.length ? report.history : report?.restarts ?? []

  return (
    <div data-testid="service-monitor">
      <PageHeader view="serviceMonitor" action={<button className="icon-button" onClick={() => { setLoading(true); setRefresh(value => value + 1) }} title="刷新" disabled={loading}><RefreshCw size={15} /></button>} />
      {error && <p role="alert">{error}</p>}
      <p>{report?.autoRestart ? '容器确认不可用后，系统会创建 SVC-01，自动审批，并只重启该容器。' : '自动重启当前已关闭，页面只展示巡检结果。'} 最近巡检：{timeText(report?.checkedAt ?? null)}</p>
      {report && !collected && <p role="status">{report.reason ?? '未采集'}</p>}
      <section className="panel" data-testid="host-resources" style={{marginBottom: 16}}>
        <div className="panel-title"><div><h3><ServerCog size={15} /> 部署服务器</h3><p>统计运行管理服务的这台机器。主机名：{report?.host?.hostname || '未采集'}</p></div></div>
        <div className="metric-grid" style={{gridTemplateColumns: 'repeat(3, minmax(0, 1fr))'}}>
          <article className="metric-card"><span>CPU 使用</span><strong>{percentText(report?.host?.cpuPercent ?? null)}</strong><small>当前采样</small></article>
          <article className="metric-card"><span>内存占用</span><strong>{percentText(report?.host?.memory?.percent ?? null)}</strong><small>{usageText(report?.host?.memory ?? null)}</small></article>
          <article className="metric-card"><span>存储占用</span><strong>{percentText(report?.host?.storage?.percent ?? null)}</strong><small>{usageText(report?.host?.storage ?? null)}</small></article>
        </div>
      </section>
      <ServiceTable name="Dify" block={report?.products.Dify ?? {running: null, unavailable: null, services: []}} emptyNote={report?.emptyNote ?? null} collected={!!collected} />
      <ServiceTable name="RAGFlow" block={report?.products.RAGFlow ?? {running: null, unavailable: null, services: []}} emptyNote={report?.emptyNote ?? null} collected={!!collected} />
      <section className="panel">
        <h3>自动重启工单</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>工单号</th><th>产品</th><th>服务</th><th>审批</th><th>结果</th><th>时间</th></tr></thead>
            <tbody>
              {tickets.length > 0 ? tickets.map(row => (
                <tr key={row.ticketNo}>
                  <td>{row.ticketNo}</td><td>{row.product ?? '未采集'}</td><td>{row.service ?? '未采集'}</td><td>{row.approvalMode}</td><td>{row.failureReason ? `${row.status} · ${row.failureReason}` : row.status}</td><td>{timeText(row.at)}</td>
                </tr>
              )) : <tr><td colSpan={6}>{collected ? '当前没有需要重启的服务' : '未采集'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
