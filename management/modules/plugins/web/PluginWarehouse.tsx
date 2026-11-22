import {useEffect,useRef,useState} from 'react'
import {PackageCheck,Search} from 'lucide-react'
import type {Role} from '../../../shared-ui/UiContextData'
import {PageHeader} from '../../../shared-ui/UiContext'
import {readDirectoryPages} from '../../../shared-ui/directory-pages'

type Workspace = {workspaceId: string; name: string}
type CatalogItem = {resourceId: string; name: string; status: string; data?: Record<string, unknown>}
const isWorkspace = (value: unknown): value is Workspace => !!value && typeof value === 'object' && typeof (value as Workspace).workspaceId === 'string' && !!(value as Workspace).workspaceId.trim() && typeof (value as Workspace).name === 'string'

function installState(data: Record<string, unknown> | undefined) {
  if (!data) return '未采集'
  if (typeof data.installationId === 'string' && data.installationId.trim()) return '已安装'
  if (data.installed === true) return '已安装'
  if (data.installed === false) return '未安装'
  return '未采集'
}

export function PluginWarehouse({role}: {role: Role}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [items, setItems] = useState<Array<CatalogItem & {install: string}>>([])
  const [cursor, setCursor] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [operation, setOperation] = useState('安装')
  const [purpose, setPurpose] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    readDirectoryPages('/api/workspaces?product=dify', isWorkspace, controller.signal).then(rows => {
      if (!active) return
      setWorkspaces(rows)
      if (rows.length > 0) setWorkspaceId(prev => prev || rows[0].workspaceId)
    }).catch(() => {
      // Workspaces are optional for browsing the public plugin catalog
    })
    return () => { active = false; controller.abort() }
  }, [])
  useEffect(() => {
    const token = ++request.current
    const controller = new AbortController()
    const params = new URLSearchParams({kind: 'plugin'})
    if (workspaceId) params.set('workspaceId', workspaceId)
    if (cursor) params.set('cursor', cursor)
    fetch('/api/catalog?' + params, {signal: controller.signal}).then(async response => {
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '目录读取失败')
      if (token !== request.current) return
      if (data.nextCursor === cursor && cursor) throw Error('目录游标重复，请刷新')
      const page = (data.items as CatalogItem[]).map(item => ({...item, install: installState(item.data)}))
      setItems(previous => (cursor ? [...previous.filter(item => !page.some(row => row.resourceId === item.resourceId)), ...page] : page))
      setNextCursor(data.nextCursor ?? null)
      setError('')
    }).catch(reason => {
      if (controller.signal.aborted || token !== request.current) return
      setError(reason instanceof Error ? reason.message : '目录读取失败')
    }).finally(() => { if (token === request.current) setLoading(false) })
    return () => controller.abort()
  }, [workspaceId, cursor, reload])
  function chooseWorkspace(next: string) {
    request.current += 1
    setWorkspaceId(next)
    setItems([])
    setCursor('')
    setNextCursor(null)
    setSelectedId('')
    setNotice('')
    setError('')
    setLoading(true)
  }
  const availableCount = items.filter(item => !['withdrawn', 'unavailable', 'quarantined'].includes(item.status)).length
  const filtered = items.filter(item => !keyword.trim() || (item.name + item.resourceId).toLowerCase().includes(keyword.trim().toLowerCase()))
  const selected = filtered.find(item => item.resourceId === selectedId) ?? filtered[0]
  async function submit() {
    if (!selected || !workspaceId || !purpose.trim()) { setNotice(!workspaceId ? '请先选择目标工作区' : '请填写使用目的'); return }
    const installationId = typeof selected.data?.installationId === 'string' ? selected.data.installationId : ''
    if ((operation === '升级' || operation === '卸载') && !installationId) { setNotice('当前工作区没有已采集的安装实例，不能' + operation); return }
    setBusy(true)
    try {
      const ticketNo = 'PLG-03-' + crypto.randomUUID()
      const response = await fetch('/api/applications', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ticketNo, ticketType: 'PLG-03', resourceId: selected.resourceId, workspaceId, fields: {operation, purpose, installationId}})})
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '插件操作提交失败')
      setNotice(data.ticketNo + ' · ' + data.status)
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '插件操作提交失败') }
    finally { setBusy(false) }
  }
  return <div data-testid="plugin-warehouse">
    <PageHeader view="pluginWarehouse" />
    <div className="warehouse-top-bar">
      <div className="warehouse-kpi-strip" data-testid="plugin-warehouse-kpis">
        <div className="warehouse-kpi-pill">
          <PackageCheck size={15} />
          <span>插件总数</span>
          <strong>{items.length}</strong>
        </div>
        <div className="warehouse-kpi-pill">
          <PackageCheck size={15} />
          <span>可用插件</span>
          <strong>{availableCount}</strong>
        </div>
      </div>
      <div className="warehouse-actions">
        <label className="catalog-search"><Search size={16} /><input aria-label="搜索插件" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索插件" /></label>
        <button className="secondary-button" disabled={loading} onClick={() => { setItems([]); setCursor(''); setNextCursor(null); setLoading(true); setReload(value => value + 1) }}>刷新目录</button>
        {nextCursor && <button className="secondary-button" disabled={loading} onClick={() => { setLoading(true); setCursor(nextCursor) }}>加载更多目录</button>}
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="warehouse-layout">
      <div className="agent-grid">
        {filtered.map(item => <article key={item.resourceId} role="button" tabIndex={0} className={'agent-card' + (selected?.resourceId === item.resourceId ? ' active' : '')} data-testid={'plugin-card-' + item.resourceId} onClick={() => setSelectedId(item.resourceId)} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' '){event.preventDefault();event.currentTarget.click()}}}><div className="agent-card-top"><PackageCheck size={16} /><div><strong>{item.name}</strong><small>{item.resourceId}</small></div><em>{item.install}</em></div><p>{typeof item.data?.description === 'string' && item.data.description ? item.data.description : item.status}</p></article>)}
        {filtered.length === 0 && !loading && <div className="agent-empty">当前仓库暂无已上架的插件。</div>}
      </div>
      {selected && <aside className="panel" data-testid="plugin-detail">
        <h3>{selected.name}</h3>
        <p>状态 · {selected.status} · {selected.install}</p>
        {workspaces.length > 0 && <label>目标工作区<select aria-label="插件仓库工作区" value={workspaceId} onChange={event => chooseWorkspace(event.target.value)}>{workspaces.map(row => <option key={row.workspaceId} value={row.workspaceId}>{row.name}</option>)}</select></label>}
        <label>操作<select aria-label="仓库插件操作" value={operation} onChange={event => setOperation(event.target.value)}><option>安装</option><option>升级</option><option>卸载</option></select></label>
        <label>使用目的<textarea aria-label="插件仓库使用目的" value={purpose} onChange={event => setPurpose(event.target.value)} /></label>
        <button className="primary-button" disabled={busy} onClick={() => void submit()}>提交 PLG-03</button>
        {notice && <p role="status" data-testid="plugin-notice">{notice}</p>}
      </aside>}
    </div>
    <p data-role={role} hidden>插件仓库</p>
  </div>
}
