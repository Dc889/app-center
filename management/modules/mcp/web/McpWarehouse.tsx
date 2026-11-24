import {useEffect, useRef, useState} from 'react'
import {ChevronRight, Network, Search, Trophy} from 'lucide-react'
import type {Role} from '../../../shared-ui/UiContextData'
import {PageHeader} from '../../../shared-ui/UiContext'
import {readDirectoryPages} from '../../../shared-ui/directory-pages'

type Workspace = {workspaceId: string; name: string}
type CatalogItem = {resourceId: string; name: string; status: string; data?: Record<string, unknown>}
const isWorkspace = (value: unknown): value is Workspace =>
  !!value && typeof value === 'object' && typeof (value as Workspace).workspaceId === 'string' && !!(value as Workspace).workspaceId.trim() && typeof (value as Workspace).name === 'string'
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

export function McpWarehouse({role}: {role: Role}) {
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
  const request = useRef(0)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    readDirectoryPages('/api/workspaces?product=dify', isWorkspace, controller.signal)
      .then(rows => {
        if (!active) return
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
        <select
          className="warehouse-method"
          aria-label="使用方式"
          value={methodFilter}
          onChange={event => setMethodFilter(event.target.value as '全部方式' | '直接绑定' | '申请绑定')}
        >
          <option value="全部方式">使用方式</option>
          <option value="直接绑定">直接绑定（即办）</option>
          <option value="申请绑定">申请绑定（审批）</option>
        </select>
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
      </div>
      <p data-role={role} hidden>MCP仓库</p>
    </div>
  )
}
