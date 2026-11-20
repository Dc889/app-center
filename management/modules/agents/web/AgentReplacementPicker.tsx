import {useEffect,useRef,useState} from 'react'
import {readDirectoryPages as pages} from '../../../shared-ui/directory-pages'
type Row={resourceId:string;name:string}
type Detail=Row&{appId:string;workspaceId:string;publicationVersionId:string}
export function AgentReplacementPicker({sourceResourceId,value,enabled,onChange}:{sourceResourceId:string;value:string;enabled:boolean;onChange:(value:string,verified:boolean)=>void}){
  const [rows,setRows]=useState<Row[]>([]),[query,setQuery]=useState(''),[selected,setSelected]=useState(''),[detail,setDetail]=useState<Detail|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  async function load(){
    controller.current?.abort();const request=new AbortController();controller.current=request
    setBusy(true);setRows([]);setSelected('');setDetail(null);setMessage('');onChange(value,false)
    try{
      const items=await pages('/api/agent-replacements?'+new URLSearchParams({sourceResourceId,q:query.trim()}),(row:unknown):row is Row=>!!row && typeof row==='object' && ['resourceId','name'].every(key=>typeof (row as Row)[key as keyof Row]==='string' && !!(row as Row)[key as keyof Row].trim()),request.signal)
      if(new Set(items.map(row=>row.resourceId)).size!==items.length || items.some(row=>row.resourceId===sourceResourceId))throw Error('替代候选重复或包含原应用')
      if(!request.signal.aborted)setRows(items)
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'候选读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function select(resourceId:string){
    controller.current?.abort();setSelected(resourceId);setDetail(null);setMessage('');onChange(resourceId,!resourceId)
    if(!resourceId)return
    const request=new AbortController();controller.current=request;setBusy(true)
    try{
      const response=await fetch('/api/agent-replacements/'+encodeURIComponent(resourceId)+'?'+new URLSearchParams({sourceResourceId}),{signal:request.signal});const data=await response.json()
      if(!response.ok)throw Error(data.error?.message ?? '替代应用核验失败')
      if(data.resourceId!==resourceId || data.sourceResourceId!==sourceResourceId)throw Error('替代应用与原目录不匹配')
      if(!request.signal.aborted){setDetail(data);onChange(resourceId,true)}
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'核验失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  return <fieldset disabled={!enabled || busy}><legend>替代仓库应用（选填）</legend>
    <div className="picker-action-row">
      <label>替代应用搜索<input maxLength={200} value={query} onChange={event=>setQuery(event.target.value)} placeholder="输入关键词搜索替代应用..." /></label>
      <button type="button" className="secondary-button" onClick={load}>读取可用替代应用</button>
    </div>
    {value && value!==selected && <p className="reselect-notice">待重新核验的替代应用 · {value}</p>}
    <div className="picker-action-row">
      <label>替代仓库应用<select aria-label="替代仓库应用" value={selected===value?selected:''} onChange={event=>void select(event.target.value)}><option value="">不指定替代应用</option>{rows.map(row=><option key={row.resourceId} value={row.resourceId}>{row.name} · {row.resourceId}</option>)}</select></label>
      {value && <button type="button" className="secondary-button" onClick={()=>{controller.current?.abort();setBusy(false);setSelected('');setDetail(null);onChange('',true)}}>清除替代应用</button>}
    </div>
    {detail && <div className="detail-callout">替代应用 · {detail.name} · 版本 {detail.publicationVersionId} · 工作区 {detail.workspaceId}</div>}
    <p role="status">{message}</p>
  </fieldset>
}
