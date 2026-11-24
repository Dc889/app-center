import {useEffect, useState} from 'react'
import {ChevronRight, Database, Search, Trophy} from 'lucide-react'
import type {Role} from '../../../shared-ui/UiContextData'
import {PageHeader} from '../../../shared-ui/UiContext'

type UsageMethod = '检索使用' | '编排绑定'
type WarehouseItem = {
  id: string
  name: string
  source: string
  summary: string
  shareMode: string
  methods: UsageMethod[]
  directlyUsable: boolean
  unavailable: boolean
  downloadCount: number | null
  org: string
  ticketNo: string
}

type WarehouseReport = {
  metrics: {total: number; usableCount: number; unavailableCount: number; downloadCount: number | null}
  ranking: {id: string; name: string; source: string; count: number | null}[]
  items: WarehouseItem[]
}

function countText(count: number | null) {
  return count === null ? '未采集' : `${count} 次`
}

export function KnowledgeWarehouse({role, onWorkOrder}: {role: Role; onWorkOrder: (title: string) => void}) {
  const [report, setReport] = useState<WarehouseReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [usableTab, setUsableTab] = useState<'全部' | '可直接使用' | '暂不可用'>('全部')
  const [methodFilter, setMethodFilter] = useState<'全部方式' | UsageMethod>('全部方式')
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/knowledge-warehouse', {signal: controller.signal})
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw Error(data.error?.message ?? '知识库仓库读取失败')
        setReport(data)
        setError('')
      })
      .catch(reason => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : '知识库仓库读取失败')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  const allItems = report?.items ?? []
  const items = allItems.filter(item => {
    const haystack = [item.name, item.id, item.summary, item.source, item.shareMode].join(' ').toLowerCase()
    if (keyword.trim() && !haystack.includes(keyword.trim().toLowerCase())) return false
    if (usableTab === '可直接使用' && !item.directlyUsable) return false
    if (usableTab === '暂不可用' && !item.unavailable) return false
    if (methodFilter !== '全部方式' && !item.methods.includes(methodFilter)) return false
    return true
  })
  const ranking = report?.ranking ?? []
  const metrics = report?.metrics ?? {total: 0, usableCount: 0, unavailableCount: 0, downloadCount: null}
  const rankedCounts = ranking.map(item => item.count).filter((count): count is number => count !== null)
  const maxCount = Math.max(...rankedCounts, 1)
  const selected = items.find(item => item.id === selectedId) ?? items[0]

  return (
    <div data-testid="knowledge-warehouse">
      <div className="warehouse-top-bar">
        <PageHeader view="knowledgeWarehouse" />
        <div className="warehouse-kpi-strip" data-testid="knowledge-warehouse-kpis">
          <div className="warehouse-kpi-pill"><Database size={15} /><span>知识库总数</span><strong>{metrics.total}</strong></div>
          <div className="warehouse-kpi-pill"><Database size={15} /><span>可直接使用</span><strong>{metrics.usableCount}</strong></div>
          <div className="warehouse-kpi-pill"><Trophy size={15} /><span>下载次数</span><strong>{countText(metrics.downloadCount)}</strong></div>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <section className="panel ranking-panel" data-testid="knowledge-download-ranking">
        <div className="panel-title">
          <div>
            <h3><Trophy size={15} /> 下载次数排行榜</h3>
            <p>按知识库已采集的下载次数排序，未采集不按 0 次参与排名</p>
          </div>
        </div>
        <div className="ranking-list">
          {ranking.length === 0 ? <p className="version-meta">暂无已上架知识库排行数据</p> : ranking.map((item, index) => (
            <button key={item.id} type="button" className={selected?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
              <b>{index + 1}</b>
              <span><strong>{item.name}</strong><small>{item.source || item.id}</small></span>
              <i><em style={{width: item.count === null ? '0%' : `${Math.max(8, Math.round((item.count / maxCount) * 100))}%`}} /></i>
              <em>{countText(item.count)}</em>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
      </section>
      <div className="warehouse-toolbar">
        <label className="catalog-search warehouse-search">
          <Search size={16} />
          <input aria-label="搜索知识库" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索知识库名称、来源或简介" />
        </label>
        <div className="usable-switch" data-testid="knowledge-usable-tabs">
          {(['全部', '可直接使用', '暂不可用'] as const).map(tab => (
            <button key={tab} type="button" className={usableTab === tab ? 'active' : ''} onClick={() => setUsableTab(tab)}>{tab}</button>
          ))}
        </div>
        <select
          className="warehouse-method"
          aria-label="使用方式"
          value={methodFilter}
          onChange={event => setMethodFilter(event.target.value as '全部方式' | UsageMethod)}
        >
          <option value="全部方式">使用方式</option>
          <option value="检索使用">检索使用</option>
          <option value="编排绑定">编排绑定</option>
        </select>
      </div>
      <div className="warehouse-layout">
        <div className="dify-catalog-scroll" data-testid="knowledge-catalog-scroll">
          <div className="dify-tile-grid" data-testid="knowledge-grid">
            {items.map(item => {
              const badgeClass = item.unavailable ? 'blocked' : item.directlyUsable ? 'usable' : 'pending'
              const badgeText = item.unavailable ? '暂不可用' : item.directlyUsable ? '可使用' : '待申请'
              return (
                <article
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={'dify-tile-card' + (selected?.id === item.id ? ' active' : '')}
                  data-testid={'knowledge-card-' + item.id}
                  onClick={() => setSelectedId(item.id)}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(item.id) } }}
                >
                  <div className="dify-tile-head">
                    <span className={`dify-tile-icon tone-knowledge ${badgeClass}`}>
                      <Database size={18} />
                      <em>{badgeText}</em>
                    </span>
                    <div className="dify-tile-title">
                      <strong>{item.name}</strong>
                      <small>{item.source || item.shareMode || item.id}</small>
                    </div>
                  </div>
                  <p className="dify-tile-desc">{item.summary || '已发布知识库'}</p>
                  <div className="dify-tile-foot">
                    <div className="dify-tile-tags">{item.methods.map(method => <span key={method} className="dify-tile-tag">{method}</span>)}</div>
                    <b>{countText(item.downloadCount)}</b>
                  </div>
                </article>
              )
            })}
            {!loading && items.length === 0 && <div className="agent-empty">没有符合当前筛选的知识库。</div>}
          </div>
        </div>
        {selected && (
          <aside className="panel" data-testid="knowledge-detail">
            <h3>{selected.name}</h3>
            <p className="version-meta">{selected.unavailable ? '暂不可用' : selected.directlyUsable ? '可使用' : '待申请'}{selected.source ? ` · ${selected.source}` : ''}{selected.shareMode ? ` · ${selected.shareMode}` : ''}</p>
            {selected.summary && <p>{selected.summary}</p>}
            <p>使用方式 · {selected.methods.join('、') || '未采集'}</p>
            <p>下载次数 · {countText(selected.downloadCount)}</p>
            {role !== 'user' && selected.ticketNo && <p>关联工单 · {selected.ticketNo}</p>}
            <div className="draft-toolbar" style={{marginTop: 12}}>
              <button className="primary-button" disabled={selected.unavailable} onClick={() => onWorkOrder(`知识库使用申请 · ${selected.name}`)}>
                {selected.directlyUsable ? '继续办理' : '提交使用申请'}
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
