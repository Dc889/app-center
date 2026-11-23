import {useEffect, useRef, useState} from 'react'
import {ChevronRight, Network, Search, Trophy} from 'lucide-react'
import type {Role} from '../../../shared-ui/UiContextData'
import {PageHeader} from '../../../shared-ui/UiContext'
import {readDirectoryPages} from '../../../shared-ui/directory-pages'

type Workspace = {workspaceId: string; name: string}
type CatalogItem = {resourceId: string; name: string; status: string; data?: Record<string, unknown>}
const isWorkspace = (value: unknown): value is Workspace =>
  !!value && typeof value === 'object' && typeof (value as Workspace).workspaceId === 'string' && !!(value as Workspace).workspaceId.trim() && typeof (value as Workspace).name === 'string'
const hidden = /url|endpoint|provider|fingerprint|secret|token|凭证|地址/i

function bindState(data: Record<string, unknown> | undefined) {
  if (!data) return '未采集'
  if (data.bound === true || (typeof data.bindingId === 'string' && data.bindingId.trim())) return '已绑定'
  if (data.bound === false) return '未绑定'
  if (data.bindingAccess === 'instant') return '可直接绑定'
  if (data.bindingAccess === 'approval') return '需申请绑定'
  return '未采集'
}

function usageCountOf(data: Record<string, unknown> | undefined): number {
  const v = data?.usageCount ?? data?.callCount ?? data?.bindCount
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function isUnavailable(status: string): boolean {
  return ['withdrawn', 'unavailable', 'quarantined', 'isolated'].includes(status)
}

function isDirectlyUsable(item: CatalogItem & {bind: string}): boolean {
  if (isUnavailable(item.status)) return false
  return item.bind === '已绑定' || item.data?.bindingAccess === 'instant'
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
  const [usableTab, setUsableTab] = useState<'全部' | '可直接使用' | '暂不可用'>('全部')
  const [methodFilter, setMethodFilter] = useState<'全部方式' | '直接绑定' | '申请绑定'>('全部方式')
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
    readDirectoryPages('/api/workspaces?product=dify', isWorkspace, controller.signal)
      .then(rows => {
        if (!active) return
        setWorkspaces(rows)
        if (rows.length > 0) setWorkspaceId(prev => prev || rows[0].workspaceId)
      })
      .catch(() => {})
    return () => { active = false; controller.abort() }
  }, [])

  useEffect(() => {
    const token = ++request.current
    const controller = new AbortController()
    const params = new URLSearchParams({kind: 'mcp'})
    if (workspaceId) params.set('workspaceId', workspaceId)
    if (cursor) params.set('cursor', cursor)
    fetch('/api/catalog?' + params, {signal: controller.signal})
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw Error(data.error?.message ?? '目录读取失败')
        if (token !== request.current) return
        const page = (data.items as CatalogItem[]).map(item => ({...item, bind: bindState(item.data)}))
        setItems(previous => (cursor ? [...previous.filter(item => !page.some(row => row.resourceId === item.resourceId)), ...page] : page))
        setNextCursor(data.nextCursor ?? null)
        setError('')
      })
      .catch(reason => {
        if (controller.signal.aborted || token !== request.current) return
        setError(reason instanceof Error ? reason.message : '目录读取失败')
      })
      .finally(() => { if (token === request.current) setLoading(false) })
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

  const availableCount = items.filter(item => !isUnavailable(item.status)).length
  const ranked = [...items]
    .filter(item => !isUnavailable(item.status))
    .sort((a, b) => usageCountOf(b.data) - usageCountOf(a.data))
    .slice(0, 5)
  const maxUsage = Math.max(...ranked.map(item => usageCountOf(item.data)), 1)

  const filtered = items.filter(item => {
    const desc = typeof item.data?.description === 'string' ? item.data.description : ''
    if (keyword.trim() && !(item.name + item.resourceId + desc).toLowerCase().includes(keyword.trim().toLowerCase())) return false
    const direct = isDirectlyUsable(item)
    const blocked = isUnavailable(item.status)
    if (usableTab === '可直接使用' && !direct) return false
    if (usableTab === '暂不可用' && !blocked) return false
    if (methodFilter === '直接绑定' && item.data?.bindingAccess !== 'instant') return false
    if (methodFilter === '申请绑定' && item.data?.bindingAccess === 'instant') return false
    return true
  })
  const selected = filtered.find(item => item.resourceId === selectedId) ?? filtered[0]

  async function bind() {
    if (!selected || !workspaceId || !purpose.trim() || !startsAt || !expiresAt) {
      setNotice(!workspaceId ? '请先选择目标工作区' : '请填写绑定目的和期限')
      return
    }
    setBusy(true)
    try {
      const ticketNo = 'MCP-02-' + crypto.randomUUID()
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ticketNo,
          ticketType: 'MCP-02',
          resourceId: selected.resourceId,
          workspaceId,
          fields: {purpose, targetAppId: '', startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(expiresAt).toISOString()},
        }),
      })
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '绑定申请失败')
      setNotice(data.ticketNo + ' · ' + data.status)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '绑定申请失败')
    } finally {
      setBusy(false)
    }
  }

  async function disposition() {
    if (!selected || !purpose.trim()) {
      setNotice('请填写处置事实')
      return
    }
    setBusy(true)
    try {
      const ticketNo = 'MCP-03-' + crypto.randomUUID()
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ticketNo, ticketType: 'MCP-03', resourceId: selected.resourceId, workspaceId: '', fields: {operation: '目录隔离', reason: '其他', facts: purpose}}),
      })
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '处置申请失败')
      setNotice(data.ticketNo + ' · ' + data.status)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '处置申请失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="mcp-warehouse">
      <div className="warehouse-top-bar">
        <PageHeader view="mcpWarehouse" />
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
      </div>

      {error && <p role="alert">{error}</p>}

      {/* 1. 使用次数排行榜 */}
      <section className="panel ranking-panel" data-testid="usage-ranking">
        <div className="panel-title">
          <div>
            <h3><Trophy size={15} /> 使用次数排行榜</h3>
            <p>按 MCP 服务绑定 / 调用次数排序</p>
          </div>
        </div>
        <div className="ranking-list">
          {ranked.length === 0 ? (
            <p className="version-meta">暂无已注册 MCP 服务排行数据</p>
          ) : ranked.map((item, index) => {
            const count = usageCountOf(item.data)
            const tools = Array.isArray(item.data?.toolNames) ? item.data.toolNames.length : 0
            return (
              <button
                key={item.resourceId}
                type="button"
                className={selected?.resourceId === item.resourceId ? 'active' : ''}
                onClick={() => setSelectedId(item.resourceId)}
              >
                <b>{index + 1}</b>
                <span>
                  <strong>{item.name}</strong>
                  <small>{tools ? `${tools} 个工具` : item.resourceId}</small>
                </span>
                <i><em style={{width: `${Math.max(8, Math.round((count / maxUsage) * 100))}%`}} /></i>
                <em>{count} 次</em>
                <ChevronRight size={14} />
              </button>
            )
          })}
        </div>
      </section>

      {/* 2-4. 搜索框 + 全部/可直接使用/暂不可用标签页 + 使用方式筛选 */}
      <div className="warehouse-toolbar">
        <label className="catalog-search warehouse-search">
          <Search size={16} />
          <input aria-label="搜索MCP" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索 MCP 服务名称、标识或简介" />
        </label>
        <div className="usable-switch" data-testid="mcp-usable-tabs">
          {(['全部', '可直接使用', '暂不可用'] as const).map(tab => (
            <button key={tab} type="button" className={usableTab === tab ? 'active' : ''} onClick={() => setUsableTab(tab)}>
              {tab}
            </button>
          ))}
        </div>
        <label className="log-filter">
          <span>使用方式</span>
          <select aria-label="MCP使用方式筛选" value={methodFilter} onChange={event => setMethodFilter(event.target.value as '全部方式' | '直接绑定' | '申请绑定')}>
            <option value="全部方式">全部方式</option>
            <option value="直接绑定">直接绑定（即办）</option>
            <option value="申请绑定">申请绑定（审批）</option>
          </select>
        </label>
        <button className="secondary-button" disabled={loading} onClick={() => { setItems([]); setCursor(''); setNextCursor(null); setLoading(true); setReload(value => value + 1) }}>刷新目录</button>
        {nextCursor && <button className="secondary-button" disabled={loading} onClick={() => { setLoading(true); setCursor(nextCursor) }}>加载更多</button>}
      </div>

      {/* 5. 内嵌可滑动 Dify 风格矩形图标块展示区 + 右侧操作抽屉 */}
      <div className="warehouse-layout">
        <div className="dify-catalog-scroll">
          <div className="dify-tile-grid" data-testid="mcp-grid">
            {filtered.map(item => {
              const blocked = isUnavailable(item.status)
              const direct = isDirectlyUsable(item)
              const badgeClass = blocked ? 'blocked' : direct ? 'usable' : 'pending'
              const badgeText = blocked ? '暂不可用' : direct ? '可使用' : '待申请'
              const desc = typeof item.data?.description === 'string' && item.data.description ? item.data.description : item.status
              const transport = typeof item.data?.transport === 'string' ? item.data.transport : 'MCP'
              const accessTag = item.data?.bindingAccess === 'instant' ? '直接绑定' : '申请绑定'
              return (
                <article
                  key={item.resourceId}
                  role="button"
                  tabIndex={0}
                  className={'dify-tile-card' + (selected?.resourceId === item.resourceId ? ' active' : '')}
                  data-testid={'mcp-card-' + item.resourceId}
                  onClick={() => setSelectedId(item.resourceId)}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(item.resourceId) } }}
                >
                  <div className="dify-tile-head">
                    <span className="dify-tile-icon tone-mcp"><Network size={20} /></span>
                    <div className="dify-tile-title">
                      <strong>{item.name}</strong>
                      <small>{transport} · {item.bind}</small>
                    </div>
                    <span className={`dify-status-badge ${badgeClass}`}>{badgeText}</span>
                  </div>
                  <p className="dify-tile-desc">{desc}</p>
                  <div className="dify-tile-foot">
                    <div className="dify-tile-tags">
                      <span className="dify-tile-tag">{accessTag}</span>
                    </div>
                    <b>{usageCountOf(item.data)} 次</b>
                  </div>
                </article>
              )
            })}
            {filtered.length === 0 && !loading && <div className="agent-empty">没有符合当前筛选的 MCP 服务。</div>}
          </div>
        </div>

        {selected && (
          <aside className="panel" data-testid="mcp-detail">
            <h3>{selected.name}</h3>
            <p className="version-meta">状态 · {selected.status} · {selected.bind}</p>
            {visibleFacts(selected.data, staff).map(([key, value]) => <p key={key}>{key} · {typeof value === 'string' ? value : JSON.stringify(value)}</p>)}
            {workspaces.length > 0 && (
              <label>
                目标工作区
                <select aria-label="MCP仓库工作区" value={workspaceId} onChange={event => chooseWorkspace(event.target.value)}>
                  {workspaces.map(row => <option key={row.workspaceId} value={row.workspaceId}>{row.name}</option>)}
                </select>
              </label>
            )}
            <label>说明<textarea aria-label="MCP仓库说明" value={purpose} onChange={event => setPurpose(event.target.value)} /></label>
            <label>开始<input aria-label="MCP绑定开始" type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>
            <label>截止<input aria-label="MCP绑定截止" type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label>
            <button className="primary-button" disabled={busy} onClick={() => void bind()}>提交 MCP-02 绑定</button>
            {staff && <button className="secondary-button" disabled={busy} onClick={() => void disposition()}>提交 MCP-03 目录隔离</button>}
            {notice && <p role="status" data-testid="mcp-notice">{notice}</p>}
          </aside>
        )}
      </div>
    </div>
  )
}
