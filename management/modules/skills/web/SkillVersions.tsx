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
      if(active) {
        setItems(previous=>[...previous.filter(p=>!data.items.some((i:Version)=>i.version===p.version)),...data.items])
        setNext(data.nextCursor && data.nextCursor!==cursor?data.nextCursor:null)
        setError('')
      }
    }).catch(e=>{if(active)setError(e.message)})
    return ()=>{active=false}
  },[resourceId,cursor])
  return <div><label>下载版本<select value={selected} onChange={e=>{setSelected(e.target.value);onSelect(e.target.value || undefined)}}>
    <option key="current" value="">当前生效版本</option>
    {items.map(item=><option key={item.version} value={item.version} disabled={!item.downloadable}>{item.version}{item.downloadable?'':' · 不可下载'}</option>)}
  </select></label>
    {items.filter(i=>i.version===selected).map(item=><p key={item.version}>{item.changedAt} · {item.changeNote} · {item.sha256}</p>)}
    {next && <button className="secondary-button" onClick={()=>setCursor(next)}>加载更多版本</button>}
    {error && <p role="status">{error}</p>}
  </div>
}
