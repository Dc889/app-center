import {useEffect,useRef,useState} from 'react'
import {readDirectoryPages as pages} from '../../../shared-ui/directory-pages'
import {ApplicationTargetPicker} from './ApplicationTargetPicker'
type Workspace={workspaceId:string;name:string}
export function PublicationApplicationPicker({workspaceId,appId,onWorkspace,onChange}:{workspaceId:string;appId:string;onWorkspace:(value:string)=>void;onChange:(value:string,verified:boolean)=>void}){
  const [items,setItems]=useState<Workspace[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[key,setKey]=useState(0)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  const ready=items.some(row=>row.workspaceId===workspaceId)
  async function load(){
    controller.current?.abort();const request=new AbortController();controller.current=request
    setBusy(true);setItems([]);setMessage('');setKey(value=>value+1);onChange(appId,false)
    try{
      const rows=await pages('/api/workspaces?product=dify',(row:unknown):row is Workspace=>!!row && typeof row==='object' && ['workspaceId','name'].every(key=>typeof (row as Workspace)[key as keyof Workspace]==='string' && !!(row as Workspace)[key as keyof Workspace].trim()),request.signal)
      if(new Set(rows.map(row=>row.workspaceId)).size!==rows.length)throw Error('关联工作区目录重复')
      if(!request.signal.aborted)setItems(rows)
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'工作区读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  return <fieldset disabled={busy}><legend>随应用发布的关联应用</legend><button onClick={load}>读取关联应用工作区</button>
    <label>关联Dify工作区<select aria-label="关联Dify工作区" value={workspaceId} onChange={event=>{onWorkspace(event.target.value);onChange(appId,false);setKey(value=>value+1)}}><option value="">请选择</option>{workspaceId && !ready && <option value={workspaceId} disabled>{workspaceId} · 请重新读取工作区</option>}{items.map(row=><option key={row.workspaceId} value={row.workspaceId}>{row.name} · {row.workspaceId}</option>)}</select></label>
    <ApplicationTargetPicker key={key+':'+workspaceId} purpose="dataset_publication" workspaceId={workspaceId} value={appId} enabled={ready} onChange={onChange}/><p role="status">{message}</p>
  </fieldset>
}
