import {useEffect,useRef,useState} from 'react'
import {Network,Search} from 'lucide-react'
import type {Role} from '../../../shared-ui/UiContextData'
import {PageHeader} from '../../../shared-ui/UiContext'
import {readDirectoryPages} from '../../../shared-ui/directory-pages'

type Workspace = {workspaceId: string; name: string}
type CatalogItem = {resourceId: string; name: string; status: string; data?: Record<string, unknown>}
const isWorkspace = (value: unknown): value is Workspace => !!value && typeof value === 'object' && typeof (value as Workspace).workspaceId === 'string' && !!(value as Workspace).workspaceId.trim() && typeof (value as Workspace).name === 'string'
const hidden = /url|endpoint|provider|fingerprint|secret|token|凭证|地址/i

function bindState(data: Record<string, unknown> | undefined) {
  if (!data) return '未采集'
  if (data.bound === true || typeof data.bindingId === 'string' && data.bindingId.trim()) return '已绑定'
  if (data.bound === false) return '未绑定'
  if (data.bindingAccess === 'instant') return '可直接绑定'
  if (data.bindingAccess === 'approval') return '需申请绑定'
  return '未采集'
}

function visibleFacts(data: Record<string, unknown> | undefined, staff: boolean) {
  return Object.entries(data ?? {}).filter(([key, value]) => {
    if (hidden.test(key)) return false
    if (!staff && typeof value === 'string' && /^https?:\/\//i.test(value)) return false
    return true
  })
}

export function McpWarehouse({role}: {role: Role}) {
  const staff = role !== 'user'
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [items, setItems] = useState<Array<CatalogItem & {bind: string}>>([])
  const [cursor, setCursor] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
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
      // Workspaces are optional for browsing the public MCP catalog
    })
    return () => { active = false; controller.abort() }
  }, [])
  useEffect(() => {
    const token = ++request.current
    const controller = new AbortController()
    const params = new URLSearchParams({kind: 'mcp'})
    if (workspaceId) params.set('workspaceId', workspaceId)
    if (cursor) params.set('cursor', cursor)
    fetch('/api/catalog?' + params, {signal: controller.signal}).then(async response => {
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '目录读取失败')
      if (token !== request.current) return
      const page = (data.items as CatalogItem[]).map(item => ({...item, bind: bindState(item.data)}))
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
  const availableCount = items.filter(item => !['withdrawn', 'unavailable', 'quarantined', 'isolated'].includes(item.status)).length
  const filtered = items.filter(item => !keyword.trim() || (item.name + item.resourceId).toLowerCase().includes(keyword.trim().toLowerCase()))
  const selected = filtered.find(item => item.resourceId === selectedId) ?? filtered[0]
  async function bind() {
    if (!selected || !workspaceId || !purpose.trim() || !startsAt || !expiresAt) { setNotice(!workspaceId ? '请先选择目标工作区' : '请填写绑定目的和期限'); return }
    setBusy(true)
    try {
      const ticketNo = 'MCP-02-' + crypto.randomUUID()
      const response = await fetch('/api/applications', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ticketNo, ticketType: 'MCP-02', resourceId: selected.resourceId, workspaceId, fields: {purpose, targetAppId: '', startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(expiresAt).toISOString()}})})
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '绑定申请失败')
      setNotice(data.ticketNo + ' · ' + data.status)
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '绑定申请失败') }
    finally { setBusy(false) }
  }
  async function disposition() {
    if (!selected || !purpose.trim()) { setNotice('请填写处置事实'); return }
    setBusy(true)
    try {
      const ticketNo = 'MCP-03-' + crypto.randomUUID()
      const response = await fetch('/api/applications', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ticketNo, ticketType: 'MCP-03', resourceId: selected.resourceId, workspaceId: '', fields: {operation: '目录隔离', reason: '其他', facts: purpose}})})
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '处置申请失败')
      setNotice(data.ticketNo + ' · ' + data.status)
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '处置申请失败') }
    finally { setBusy(false) }
  }
  return <div data-testid="mcp-warehouse">
    <PageHeader view="mcpWarehouse" />
    <div className="warehouse-top-bar">
      <div className="warehouse-kpi-strip" data-testid="mcp-warehouse-kpis">
        <div className="warehouse-kpi-pill">
          <Network size={15} />
          <span>MCP 服务总数</span>
          <strong>{items.length}</strong>
        </div>
        <div className="warehouse-kpi-pill">
          <Network size={15} />
          <span>可用 MCP 服务</span>
          <strong>{availableCount}</strong>
        </div>
      </div>
      <div className="warehouse-actions">
        <label className="catalog-search"><Search size={16} /><input aria-label="搜索MCP" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索 MCP 服务" /></label>
        <button className="secondary-button" disabled={loading} onClick={() => { setItems([]); setCursor(''); setNextCursor(null); setLoading(true); setReload(value => value + 1) }}>刷新目录</button>
        {nextCursor && <button className="secondary-button" disabled={loading} onClick={() => { setLoading(true); setCursor(nextCursor) }}>加载更多目录</button>}
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="warehouse-layout">
      <div className="agent-grid">
        {filtered.map(item => <article key={item.resourceId} role="button" tabIndex={0} className={'agent-card' + (selected?.resourceId === item.resourceId ? ' active' : '')} data-testid={'mcp-card-' + item.resourceId} onClick={() => setSelectedId(item.resourceId)} onKeyDown={event => {if(event.key === 'Enter' || event.key === ' '){event.preventDefault();event.currentTarget.click()}}}><div className="agent-card-top"><Network size={16} /><div><strong>{item.name}</strong><small>{item.resourceId}</small></div><em>{item.bind}</em></div><p>{typeof item.data?.description === 'string' && item.data.description ? item.data.description : item.status}</p></article>)}
        {filtered.length === 0 && !loading && <div className="agent-empty">当前仓库暂无已注册的 MCP 服务。</div>}
      </div>
      {selected && <aside className="panel" data-testid="mcp-detail">
        <h3>{selected.name}</h3>
        <p>状态 · {selected.status} · {selected.bind}</p>
        {visibleFacts(selected.data, staff).map(([key, value]) => <p key={key}>{key} · {typeof value === 'string' ? value : JSON.stringify(value)}</p>)}
        {workspaces.length > 0 && <label>目标工作区<select aria-label="MCP仓库工作区" value={workspaceId} onChange={event => chooseWorkspace(event.target.value)}>{workspaces.map(row => <option key={row.workspaceId} value={row.workspaceId}>{row.name}</option>)}</select></label>}
        <label>说明<textarea aria-label="MCP仓库说明" value={purpose} onChange={event => setPurpose(event.target.value)} /></label>
        <label>开始<input aria-label="MCP绑定开始" type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>
        <label>截止<input aria-label="MCP绑定截止" type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label>
        <button className="primary-button" disabled={busy} onClick={() => void bind()}>提交 MCP-02 绑定</button>
        {staff && <button className="secondary-button" disabled={busy} onClick={() => void disposition()}>提交 MCP-03 目录隔离</button>}
        {notice && <p role="status" data-testid="mcp-notice">{notice}</p>}
      </aside>}
    </div>
  </div>
}
