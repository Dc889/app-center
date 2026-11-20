import {useEffect,useState} from 'react'
import {History,PackageCheck,Search,Trophy} from 'lucide-react'
import type {Role} from '../../../shared-ui/UiContextData'
import {personOf} from '../../../shared-ui/UiContextData'
import {PageHeader} from '../../../shared-ui/UiContext'
import {submitTicket} from '../../../platform/workflow/public.web'
import {SkillVersions} from './SkillVersions'

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

function downloadTicketNo() {
  return 'SKL-03-' + crypto.randomUUID()
}

export function SkillWarehouse({role, onWorkOrder}: {role: Role; onWorkOrder: (title: string) => void}) {
  const staff = role !== 'user'
  const [catalog, setCatalog] = useState<Entry[]>([])
  const [cursor, setCursor] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('全部')
  const [selectedId, setSelectedId] = useState('')
  const [version, setVersion] = useState<string | undefined>()
  const [notice, setNotice] = useState('')
  const [reserving, setReserving] = useState(false)
  useEffect(() => {
    let active = true
    const params = new URLSearchParams({kind: 'skill'})
    if (cursor) params.set('cursor', cursor)
    fetch('/api/catalog?' + params).then(async response => {
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '目录读取失败')
      if (!active) return
      if (data.nextCursor === cursor && cursor) throw Error('目录游标重复，请刷新')
      const page = (data.items as CatalogItem[]).map(mapItem)
      setError('')
      setNextCursor(data.nextCursor ?? null)
      setCatalog(previous => [...previous.filter(item => !page.some(row => row.id === item.id)), ...page])
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '目录读取失败') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [cursor, refresh])
  const visible = catalog.filter(item => staff || item.downloadable)
  const statuses = ['全部', ...Array.from(new Set(visible.map(item => item.status)))]
  const filtered = visible.filter(item => {
    const haystack = [item.name, item.summary, item.version].join(' ').toLowerCase()
    if (keyword.trim() && !haystack.includes(keyword.trim().toLowerCase())) return false
    return status === '全部' || item.status === status
  })
  const selected = filtered.find(item => item.id === selectedId) ?? filtered[0]
  const ranked = visible.filter(item => item.successCount !== null && (staff || item.downloadable)).sort((a, b) => (b.successCount ?? 0) - (a.successCount ?? 0))
  const maxCount = Math.max(...ranked.map(item => item.successCount ?? 0), 1)
  async function download() {
    if (!selected || !selected.downloadable) return
    setReserving(true)
    try {
      const ticket = await submitTicket(downloadTicketNo(), 'SKL-03', 'download', selected.id, personOf(role).account, version)
      if (ticket.downloadUrl) {
        const file = await fetch(ticket.downloadUrl)
        if (!file.ok) throw Error('文件暂不可领取，请用原流水重试')
        const url = URL.createObjectURL(await file.blob())
        const link = document.createElement('a')
        link.href = url
        link.download = /filename="([^"]+)"/.exec(file.headers.get('content-disposition') ?? '')?.[1] ?? 'skill.txt'
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        const state = await fetch('/api/tickets/' + ticket.ticketNo)
        const latest = await state.json()
        if (!state.ok) throw Error(latest.error?.message ?? '回执待核对，可用原流水重试')
        setNotice(latest.ticketNo + ' · ' + (latest.ok ? '已完成' : latest.status ?? '可在我的申请查看交付结果'))
      } else setNotice(ticket.ticketNo + ' · ' + (ticket.failureReason || '可在我的申请查看交付结果。'))
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '下载服务未响应')
    } finally { setReserving(false) }
  }
  return <div data-testid="catalog-warehouse">
    <PageHeader view="skillWarehouse" />
    <button className="secondary-button" disabled={loading} onClick={() => { setCatalog([]); setError(''); setLoading(true); setCursor(''); setNextCursor(null); setRefresh(value => value + 1) }}>刷新目录</button>
    {nextCursor && <button className="secondary-button" disabled={loading} onClick={() => { setLoading(true); setCursor(nextCursor) }}>加载更多目录</button>}
    <p>{staff ? '已加载 ' + catalog.length + ' 个条目，含下架项' : '已加载 ' + visible.length + ' 个可下载条目'}</p>
    {error && <p role="alert">{error}</p>}
    <div className="metric-grid four">
      {(staff ? [['已上架', visible.filter(item => item.status === '可下载').length], ['已下架', catalog.filter(item => item.status === '已下架').length], ['可见 Skill', visible.length], ['成功下载', ranked.length ? ranked.reduce((sum, item) => sum + (item.successCount ?? 0), 0) : '未采集']] : [['可下载', visible.filter(item => item.downloadable).length], ['可见 Skill', visible.length], ['成功下载', ranked.length ? ranked.reduce((sum, item) => sum + (item.successCount ?? 0), 0) : '未采集'], ['版本', visible.filter(item => item.version).length]]).map(([label, value]) => <article className="metric-card" key={String(label)}><div className="metric-icon"><PackageCheck size={19} /></div><span>{label}</span><strong>{value}</strong></article>)}
    </div>
    <section className="panel ranking-panel" data-testid="usage-ranking">
      <div className="panel-title"><div><h3><Trophy size={15} /> {staff ? '下载排行榜' : '可下载条目排行'}</h3><p>只按成功交付的下载次数排列，未采集不记为 0。</p></div></div>
      {ranked.length === 0 ? <div className="agent-empty">未采集</div> : <div className="ranking-list">{ranked.map((item, index) => <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><b>{index + 1}</b><span><strong>{item.name}</strong></span><i><em style={{width: Math.max(8, Math.round((item.successCount ?? 0) / maxCount * 100)) + '%'}} /></i><em>{item.successCount} 次</em></button>)}</div>}
    </section>
    <div className="warehouse-toolbar">
      <label className="catalog-search warehouse-search"><Search size={16} /><input data-testid="catalog-search" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索名称或说明" /></label>
      <div className="usable-switch" data-testid="catalog-status">{statuses.map(item => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item}</button>)}</div>
    </div>
    <div className="warehouse-layout">
      <div className="agent-grid">
        {filtered.length === 0 && <div className="agent-empty">没有符合当前筛选的条目。</div>}
        {filtered.map(item => <article key={item.id} role="button" tabIndex={0} className={'agent-card ' + (selected?.id === item.id ? 'active ' : '') + (item.downloadable ? 'usable' : 'blocked')} data-testid={'catalog-card-' + item.id} onClick={() => { setSelectedId(item.id); setVersion(undefined) }}><div className="agent-card-top"><span className="agent-emoji">📄</span><div><strong>{item.name}</strong><small>{item.version}</small></div><em className={item.downloadable ? 'yes' : 'no'}>{item.status}</em></div><p>{item.summary}</p><div className="agent-version"><span>{item.successCount === null ? '未采集' : item.successCount + ' 次'}</span><small>成功下载</small></div></article>)}
      </div>
      {selected && <aside className="panel agent-detail" data-testid="catalog-detail">
        <div className="agent-detail-head"><span className="agent-emoji">📄</span><div><span className="mini-label">{selected.status}</span><h3>{selected.name}</h3><p>{selected.summary}</p></div></div>
        <div className="detail-block">
          <h4><History size={14} /> 版本与下载</h4>
          <SkillVersions key={selected.id} resourceId={selected.id} onSelect={setVersion} />
          <p>下载只生成 SKL-03，文件回执在领取完成后登记。</p>
          {!selected.downloadable && <div className="method-block-note">{selected.status}，不能发起新的下载。</div>}
          <button className="primary-button" disabled={!selected.downloadable || reserving} onClick={() => void download()}>下载</button>
          {notice && <div className="method-block-note" data-testid="catalog-notice">{notice}</div>}
          {staff && <button className="secondary-button" onClick={() => onWorkOrder(selected.name + ' · SKL-03')}>查看关联工单</button>}
        </div>
      </aside>}
    </div>
  </div>
}
