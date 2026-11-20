import {useEffect,useRef,useState} from 'react'
import {readDirectoryPages as pages} from '../../../shared-ui/directory-pages'
type Target={appId:string;name:string;workspaceId:string}
export function ApplicationTargetPicker({purpose,workspaceId,value,enabled,onChange}:{purpose:'dataset_binding'|'mcp_binding'|'dataset_publication';workspaceId:string;value:string;enabled:boolean;onChange:(value:string,verified:boolean)=>void}){
  const [items,setItems]=useState<Target[]>([]),[query,setQuery]=useState(''),[selected,setSelected]=useState(''),[detail,setDetail]=useState<Target|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const controller=useRef<AbortController|null>(null)
  const label=purpose==='dataset_publication'?'关联Dify应用（必选）':'目标Dify应用（选填）'
  useEffect(()=>()=>controller.current?.abort(),[])
  async function load(){
    controller.current?.abort();const request=new AbortController();controller.current=request
    setBusy(true);setItems([]);setSelected('');setDetail(null);setMessage('');onChange(value,false)
    try{
      const rows=await pages('/api/application-targets?'+new URLSearchParams({purpose,workspaceId,q:query.trim()}),(row:unknown):row is Target=>!!row && typeof row==='object' &&
        ['appId','name','workspaceId'].every(key=>typeof (row as Target)[key as keyof Target]==='string' && !!(row as Target)[key as keyof Target].trim()),request.signal)
      if(new Set(rows.map(row=>row.appId)).size!==rows.length || rows.some(row=>row.workspaceId!==workspaceId))throw Error('目标应用候选重复或工作区不匹配')
      if(!request.signal.aborted){setItems(rows);setMessage(rows.length?'请选择可配置该绑定的目标应用':'目标区没有可关联应用；可以不关联应用')}
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'目标应用读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function select(appId:string){
    controller.current?.abort();setSelected(appId);setDetail(null);setMessage('');onChange(appId,!appId)
    if(!appId)return
    const request=new AbortController();controller.current=request;setBusy(true)
    try{
      const response=await fetch('/api/application-targets/'+encodeURIComponent(appId)+'?'+new URLSearchParams({purpose,workspaceId}),{signal:request.signal});const data=await response.json()
      if(!response.ok)throw Error(data.error?.message ?? '目标应用核验失败')
      if(data.appId!==appId || data.workspaceId!==workspaceId || data.purpose!==purpose)throw Error('目标应用详情与所选范围不匹配')
      if(!request.signal.aborted){setDetail(data);onChange(appId,true)}
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'目标应用核验失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  return <fieldset disabled={!enabled || busy}><legend>{purpose==='dataset_publication'?'关联发布Dify应用':'关联目标Dify应用（选填）'}</legend>
    <label>目标应用搜索<input maxLength={200} value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <button onClick={load}>读取可关联目标应用</button>
    {value && selected!==value && <p>待重新核验的目标应用 · {value}</p>}
    <label>{label}<select aria-label={label} value={selected===value?selected:''} onChange={event=>void select(event.target.value)}><option value="">{purpose==='dataset_publication'?'请选择关联应用':'不关联应用'}</option>{items.map(row=><option key={row.appId} value={row.appId}>{row.name} · {row.appId}</option>)}</select></label>
    {value && <button onClick={()=>{controller.current?.abort();setBusy(false);setSelected('');setDetail(null);setMessage('');onChange('',true)}}>清除应用关联</button>}
    {detail && <><label>目标应用名称<input aria-label="目标应用名称" readOnly value={detail.name}/></label><label>目标应用工作区<input aria-label="目标应用工作区" readOnly value={detail.workspaceId}/></label></>}
    <p role="status">{message}</p>
  </fieldset>
}
