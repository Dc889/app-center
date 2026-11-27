import {useEffect, useRef, useState} from 'react'
import {ChevronRight, PackageCheck, Search, Trophy} from 'lucide-react'
import type {Role} from '../../../shared-ui/UiContextData'
import {PageHeader} from '../../../shared-ui/UiContext'
import {readDirectoryPages} from '../../../shared-ui/directory-pages'

type Workspace = {workspaceId: string; name: string}
type CatalogItem = {resourceId: string; name: string; status: string; data?: Record<string, unknown>}
const isWorkspace = (value: unknown): value is Workspace =>
  !!value && typeof value === 'object' && typeof (value as Workspace).workspaceId === 'string' && !!(value as Workspace).workspaceId.trim() && typeof (value as Workspace).name === 'string'

function installState(data: Record<string, unknown> | undefined) {
  if (!data) return '未采集'
  if (typeof data.installationId === 'string' && data.installationId.trim()) return '已安装'
  if (data.installed === true) return '已安装'
  if (data.installed === false) return '未安装'
  return '未采集'
}

function downloadCountOf(data: Record<string, unknown> | undefined): number {
  const v = data?.downloadCount ?? data?.installCount ?? data?.successfulDownloadCount
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function isUnavailable(status: string): boolean {
  return ['withdrawn', 'unavailable', 'quarantined'].includes(status)
}

function isDirectlyUsable(item: CatalogItem & {install: string}): boolean {
  if (isUnavailable(item.status)) return false
  return item.install === '已安装' || item.data?.installAccess === 'instant'
}

export function PluginWarehouse({role}: {role: Role}) {
  const [workspaceId, setWorkspaceId] = useState('')
  const [items, setItems] = useState<Array<CatalogItem & {install: string}>>([])
  const [cursor, setCursor] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [usableTab, setUsableTab] = useState<'全部' | '可直接使用' | '暂不可用'>('全部')
  const [methodFilter, setMethodFilter] = useState<'全部方式' | '直接安装' | '申请安装'>('全部方式')
  const [selectedId, setSelectedId] = useState('')
  const [versions, setVersions] = useState<{version: string; status?: string; publishedAt?: string}[]>([])
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
    const params = new URLSearchParams({kind: 'plugin'})
    if (workspaceId) params.set('workspaceId', workspaceId)
    if (cursor) params.set('cursor', cursor)
    fetch('/api/catalog?' + params, {signal: controller.signal})
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw Error(data.error?.message ?? '目录读取失败')
        if (token !== request.current) return
        if (data.nextCursor === cursor && cursor) throw Error('目录游标重复，请刷新')
        const page = (data.items as CatalogItem[]).map(item => ({...item, install: installState(item.data)}))
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
    .sort((a, b) => downloadCountOf(b.data) - downloadCountOf(a.data))
    .slice(0, 5)
  const maxDownloads = Math.max(...ranked.map(item => downloadCountOf(item.data)), 1)

  const filtered = items.filter(item => {
    const desc = typeof item.data?.description === 'string' ? item.data.description : ''
    if (keyword.trim() && !(item.name + item.resourceId + desc).toLowerCase().includes(keyword.trim().toLowerCase())) return false
    const direct = isDirectlyUsable(item)
    const blocked = isUnavailable(item.status)
    if (usableTab === '可直接使用' && !direct) return false
    if (usableTab === '暂不可用' && !blocked) return false
    if (methodFilter === '直接安装' && item.data?.installAccess !== 'instant') return false
    if (methodFilter === '申请安装' && item.data?.installAccess === 'instant') return false
    return true
  })
  const selected = filtered.find(item => item.resourceId === selectedId) ?? filtered[0]

  useEffect(() => {
    if (!selected?.resourceId) { setVersions([]); return }
    let active = true
    fetch(`/api/catalog/plugin/${encodeURIComponent(selected.resourceId)}/versions`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!active) return
        const list = Array.isArray(d?.versions) ? d.versions : Array.isArray(d?.items) ? d.items : []
        setVersions(list)
      })
      .catch(() => { if (active) setVersions([]) })
    return () => { active = false }
  }, [selected?.resourceId])

  return (
    <div data-testid="plugin-warehouse">
      <div className="warehouse-top-bar">
        <PageHeader view="pluginWarehouse" />
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
      </div>

      {error && <p role="alert">{error}</p>}

      {/* 1. 下载次数排行榜 */}
      <section className="panel ranking-panel" data-testid="usage-ranking">
        <div className="panel-title">
          <div>
            <h3><Trophy size={15} /> 下载次数排行榜</h3>
            <p>按插件下载 / 安装次数排序</p>
          </div>
        </div>
        <div className="ranking-list">
          {ranked.length === 0 ? (
            <p className="version-meta">暂无已上架插件排行数据</p>
          ) : ranked.map((item, index) => {
            const count = downloadCountOf(item.data)
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
                  <small>{typeof item.data?.version === 'string' ? `v${item.data.version}` : item.resourceId}</small>
                </span>
                <i><em style={{width: `${Math.max(8, Math.round((count / maxDownloads) * 100))}%`}} /></i>
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
          <input aria-label="搜索插件" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索插件名称、标识或简介" />
        </label>
        <div className="usable-switch" data-testid="plugin-usable-tabs">
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
          onChange={event => setMethodFilter(event.target.value as '全部方式' | '直接安装' | '申请安装')}
        >
          <option value="全部方式">使用方式</option>
          <option value="直接安装">直接安装</option>
          <option value="申请安装">申请安装</option>
        </select>
        <button className="secondary-button" disabled={loading} onClick={() => { setItems([]); setCursor(''); setNextCursor(null); setLoading(true); setReload(value => value + 1) }}>刷新目录</button>
        {nextCursor && <button className="secondary-button" disabled={loading} onClick={() => { setLoading(true); setCursor(nextCursor) }}>加载更多</button>}
      </div>

      {/* 5. 内嵌可滑动 Dify 风格矩形图标块展示区 + 右侧操作抽屉 */}
      <div className="warehouse-layout">
        <div className="dify-catalog-scroll">
          <div className="dify-tile-grid" data-testid="plugin-grid">
            {filtered.map(item => {
              const blocked = isUnavailable(item.status)
              const direct = isDirectlyUsable(item)
              const badgeClass = blocked ? 'blocked' : direct ? 'usable' : 'pending'
              const badgeText = blocked ? '暂不可用' : direct ? '可使用' : '待申请'
              const versionText = typeof item.data?.version === 'string' ? `v${item.data.version}` : item.resourceId
              const desc = typeof item.data?.description === 'string' && item.data.description ? item.data.description : (blocked ? '当前插件暂不可用' : '已审批入库的标准 Dify 插件')
              const accessTag = item.data?.installAccess === 'instant' ? '直接安装' : '申请安装'
              return (
                <article
                  key={item.resourceId}
                  role="button"
                  tabIndex={0}
                  className={'dify-tile-card' + (selected?.resourceId === item.resourceId ? ' active' : '')}
                  data-testid={'plugin-card-' + item.resourceId}
                  onClick={() => setSelectedId(item.resourceId)}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(item.resourceId) } }}
                >
                  <div className="dify-tile-head">
                    <span className="dify-tile-icon tone-plugin"><PackageCheck size={20} /></span>
                    <div className="dify-tile-title">
                      <strong>{item.name}</strong>
                      <small>{versionText} · {item.install}</small>
                    </div>
                    <span className={`dify-status-badge ${badgeClass}`}>{badgeText}</span>
                  </div>
                  <p className="dify-tile-desc">{desc}</p>
                  <div className="dify-tile-foot">
                    <div className="dify-tile-tags">
                      <span className="dify-tile-tag">{accessTag}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <b>{downloadCountOf(item.data)} 次</b>
                      {!blocked && (
                        <button
                          type="button"
                          className="secondary-button compact"
                          onClick={(event) => {
                            event.stopPropagation()
                            window.history.pushState({}, '', '/manual/PLG-03')
                            window.dispatchEvent(new PopStateEvent('popstate'))
                          }}
                        >
                          申请安装
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
            {filtered.length === 0 && !loading && <div className="agent-empty">没有符合当前筛选的插件。</div>}
          </div>
        </div>

        {selected && (
          <aside className="panel agent-detail" data-testid="plugin-detail-panel">
            <div className="agent-detail-head">
              <span className="dify-tile-icon tone-plugin"><PackageCheck size={20} /></span>
              <div>
                <span className="mini-label">{selected.install} · {selected.data?.installAccess === 'instant' ? '直接安装' : '需审批安装'}</span>
                <h3>{selected.name}</h3>
                <p>{typeof selected.data?.description === 'string' && selected.data.description ? selected.data.description : '已审批入库的标准 Dify 插件'}</p>
              </div>
            </div>
            <div className="detail-block">
              <h4>历史版本列表</h4>
              <div className="table-wrap">
                <table className="release-table">
                  <thead>
                    <tr><th>版本号</th><th>状态</th><th>发布说明</th></tr>
                  </thead>
                  <tbody>
                    {(versions.length > 0 ? versions : [{
                      version: typeof selected.data?.version === 'string' ? selected.data.version : '1.0.0',
                      status: selected.status === 'approved' ? '当前生效' : selected.status,
                    }]).map((ver, idx) => (
                      <tr key={`${ver.version}-${idx}`}>
                        <td>v{ver.version}{idx === 0 && <i>当前</i>}</td>
                        <td>{ver.status === 'approved' || ver.status === 'available' ? '可用' : (ver.status || '可用')}</td>
                        <td>{ver.publishedAt ? new Date(ver.publishedAt).toLocaleDateString('zh-CN') : '通过静态安全扫描入库'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </aside>
        )}
      </div>
      <p data-role={role} hidden>插件仓库</p>
    </div>
  )
}
