import {useEffect, useState} from 'react'
import {ChevronRight, PackageCheck, Search, Trophy} from 'lucide-react'
import type {Role} from '../../../shared-ui/UiContextData'
import {PageHeader} from '../../../shared-ui/UiContext'

type CatalogItem = {
  resourceId: string
  name: string
  status: string
  actions?: string[]
  data?: {version?: string; description?: string; successfulDownloadCount?: number | null}
}

type Entry = {
  id: string
  name: string
  summary: string
  status: string
  withdrawn: boolean
  downloadable: boolean
  successCount: number | null
  version: string
}

function mapItem(item: CatalogItem): Entry {
  const withdrawn = item.status === 'withdrawn' || item.status === 'unavailable'
  const downloadable = !withdrawn && (item.actions ?? []).includes('download')
  const count = item.data?.successfulDownloadCount
  return {
    id: item.resourceId,
    name: item.name,
    summary: item.data?.description ?? '',
    status: withdrawn ? (item.status === 'withdrawn' ? '已下架' : '暂不可用') : downloadable ? '可下载' : '待核验',
    withdrawn,
    downloadable,
    successCount: typeof count === 'number' ? count : null,
    version: item.data?.version ?? '',
  }
}

export function SkillWarehouse({role}: {role: Role; onWorkOrder?: (title: string) => void}) {
  const staff = role !== 'user'
  const [catalog, setCatalog] = useState<Entry[]>([])
  const [cursor, setCursor] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [usableTab, setUsableTab] = useState<'全部' | '可直接使用' | '暂不可用'>('全部')
  const [methodFilter, setMethodFilter] = useState<'全部方式' | '直接下载' | '申请下载'>('全部方式')
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    let active = true
    const params = new URLSearchParams({kind: 'skill'})
    if (cursor) params.set('cursor', cursor)
    fetch('/api/catalog?' + params)
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw Error(data.error?.message ?? '目录读取失败')
        if (!active) return
        if (data.nextCursor === cursor && cursor) throw Error('目录游标重复，请刷新')
        const page = (data.items as CatalogItem[]).map(mapItem)
        setError('')
        setNextCursor(data.nextCursor ?? null)
        setCatalog(previous => (cursor ? [...previous.filter(item => !page.some(row => row.id === item.id)), ...page] : page))
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : '目录读取失败')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [cursor, refresh])

  const visible = catalog.filter(item => staff || !item.withdrawn)
  const filtered = visible.filter(item => {
    const haystack = [item.name, item.id, item.summary, item.version].join(' ').toLowerCase()
    if (keyword.trim() && !haystack.includes(keyword.trim().toLowerCase())) return false
    if (usableTab === '可直接使用' && !item.downloadable) return false
    if (usableTab === '暂不可用' && !item.withdrawn) return false
    if (methodFilter === '直接下载' && !item.downloadable) return false
    if (methodFilter === '申请下载' && (item.downloadable || item.withdrawn)) return false
    return true
  })
  const selected = filtered.find(item => item.id === selectedId) ?? filtered[0]
  const ranked = visible
    .filter(item => !item.withdrawn)
    .sort((a, b) => (b.successCount ?? 0) - (a.successCount ?? 0))
    .slice(0, 5)
  const maxCount = Math.max(...ranked.map(item => item.successCount ?? 0), 1)

  return (
    <div data-testid="catalog-warehouse">
      <div className="warehouse-top-bar">
        <PageHeader view="skillWarehouse" />
        <div className="warehouse-kpi-strip" data-testid="skill-warehouse-kpis">
          <div className="warehouse-kpi-pill">
            <PackageCheck size={15} />
            <span>Skill 总数</span>
            <strong>{catalog.length}</strong>
          </div>
          <div className="warehouse-kpi-pill">
            <PackageCheck size={15} />
            <span>可下载</span>
            <strong>{visible.filter(item => item.downloadable).length}</strong>
          </div>
          <div className="warehouse-kpi-pill">
            <Trophy size={15} />
            <span>下载次数</span>
            <strong>{visible.reduce((sum, item) => sum + (item.successCount ?? 0), 0)}</strong>
          </div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      {/* 1. 下载次数排行榜 */}
      <section className="panel ranking-panel" data-testid="usage-ranking">
        <div className="panel-title">
          <div>
            <h3><Trophy size={15} /> 下载次数排行榜</h3>
            <p>按 Skill 成功下载次数排序</p>
          </div>
        </div>
        <div className="ranking-list">
          {ranked.length === 0 ? (
            <p className="version-meta">暂无已上架 Skill 排行数据</p>
          ) : ranked.map((item, index) => {
            const count = item.successCount ?? 0
            return (
              <button
                key={item.id}
                type="button"
                className={selected?.id === item.id ? 'active' : ''}
                onClick={() => setSelectedId(item.id)}
              >
                <b>{index + 1}</b>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.version ? `v${item.version}` : item.id}</small>
                </span>
                <i><em style={{width: `${Math.max(8, Math.round((count / maxCount) * 100))}%`}} /></i>
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
          <input aria-label="搜索Skill" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索 Skill 名称、版本或简介" />
        </label>
        <div className="usable-switch" data-testid="skill-usable-tabs">
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
          onChange={event => setMethodFilter(event.target.value as '全部方式' | '直接下载' | '申请下载')}
        >
          <option value="全部方式">使用方式</option>
          <option value="直接下载">直接下载（即办）</option>
          <option value="申请下载">申请下载（待核验）</option>
        </select>
        <button className="secondary-button" disabled={loading} onClick={() => { setCatalog([]); setError(''); setLoading(true); setCursor(''); setNextCursor(null); setRefresh(value => value + 1) }}>刷新目录</button>
        {nextCursor && <button className="secondary-button" disabled={loading} onClick={() => { setLoading(true); setCursor(nextCursor) }}>加载更多</button>}
      </div>

      {/* 5. 内嵌可滑动 Dify 风格矩形图标块展示区 + 右侧详情抽屉 */}
      <div className="warehouse-layout">
        <div className="dify-catalog-scroll">
          <div className="dify-tile-grid" data-testid="skill-grid">
            {filtered.map(item => {
              const badgeClass = item.withdrawn ? 'blocked' : item.downloadable ? 'usable' : 'pending'
              const badgeText = item.withdrawn ? '暂不可用' : item.downloadable ? '可使用' : '待申请'
              const accessTag = item.downloadable ? '直接下载' : '待申请'
              return (
                <article
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={'dify-tile-card' + (selected?.id === item.id ? ' active' : '')}
                  data-testid={'skill-card-' + item.id}
                  onClick={() => setSelectedId(item.id)}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(item.id) } }}
                >
                  <div className="dify-tile-head">
                    <span className="dify-tile-icon tone-skill"><PackageCheck size={20} /></span>
                    <div className="dify-tile-title">
                      <strong>{item.name}</strong>
                      <small>{item.version ? `v${item.version}` : item.id}</small>
                    </div>
                    <span className={`dify-status-badge ${badgeClass}`}>{badgeText}</span>
                  </div>
                  <p className="dify-tile-desc">{item.summary || '标准 Skill 技能包'}</p>
                  <div className="dify-tile-foot">
                    <div className="dify-tile-tags">
                      <span className="dify-tile-tag">{accessTag}</span>
                    </div>
                    <b>{item.successCount ?? 0} 次</b>
                  </div>
                </article>
              )
            })}
            {filtered.length === 0 && !loading && <div className="agent-empty">没有符合当前筛选的 Skill。</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
