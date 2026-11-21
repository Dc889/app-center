import {useEffect,useState} from 'react'
type Version={version:string;downloadable:boolean;sha256:string;changedAt:string;changeNote:string}
export function SkillVersions({resourceId,onSelect}:{resourceId:string;onSelect:(version:string|undefined)=>void}) {
  const [items,setItems]=useState<Version[]>([])
  const [cursor,setCursor]=useState('')
  const [next,setNext]=useState<string|null>(null)
  const [selected,setSelected]=useState('')
  const [error,setError]=useState('')
  useEffect(()=>{
    let active=true
    const params=new URLSearchParams({limit:'50'})
    if(cursor)params.set('cursor',cursor)
    fetch('/api/catalog/skill/'+encodeURIComponent(resourceId)+'/versions?'+params).then(async response=>{
      const data=await response.json()
      if(!response.ok)throw Error(data.error?.message ?? '版本读取失败')
      const native = data.resourceId === resourceId && Array.isArray(data.versions)
      const raw: Record<string,unknown>[] = Array.isArray(data.items) ? data.items : native ? data.versions : null
      if (!Array.isArray(raw)) throw Error('版本数据格式异常，请刷新重试')
      const ids = new Set<string>()
      const page: Version[] = raw.map(item => {
        if (!item || typeof item.version !== 'string' || !item.version || ids.has(item.version)) throw Error('版本数据不完整，请刷新重试')
        ids.add(item.version)
        return {version:item.version, downloadable:native ? item.status === 'available' : item.downloadable === true,
          sha256:typeof item.sha256 === 'string' ? item.sha256 : '',
          changedAt:typeof item.changedAt === 'string' ? item.changedAt : typeof item.publishedAt === 'string' ? item.publishedAt : '',
          changeNote:typeof item.changeNote === 'string' ? item.changeNote : ''}
      })
      if (data.nextCursor != null && (typeof data.nextCursor !== 'string' || !data.nextCursor || data.nextCursor === cursor)) throw Error('版本游标异常，请刷新重试')
      if(active) {
        setItems(previous=>[...previous.filter(p=>!ids.has(p.version)),...page])
        setNext(data.nextCursor ?? null)
        setError('')
      }
    }).catch(e=>{if(active)setError(e.message)})
    return ()=>{active=false}
  },[resourceId,cursor])
  return <div><label>下载版本<select value={selected} onChange={e=>{setSelected(e.target.value);onSelect(e.target.value || undefined)}}>
    <option key="current" value="">当前生效版本</option>
    {items.map(item=><option key={item.version} value={item.version} disabled={!item.downloadable}>{item.version}{item.downloadable?'':' · 不可下载'}</option>)}
  </select></label>
    {items.filter(i=>i.version===selected).map(item=><p className="version-meta" key={item.version}>{[item.changedAt,item.changeNote,item.sha256].filter(Boolean).join(' · ')}</p>)}
    {next && <button className="secondary-button" onClick={()=>setCursor(next)}>加载更多版本</button>}
    {error && <p role="status">{error}</p>}
  </div>
}
