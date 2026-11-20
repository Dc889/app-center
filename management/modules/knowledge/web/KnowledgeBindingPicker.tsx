import {useEffect,useRef,useState} from 'react'
import {readDirectoryPages as pages} from '../../../shared-ui/directory-pages'
export type BindingCandidate={resourceId:string;name:string;workspaceId:string;source:string;sourceSystem:string;sourceScopeId:string;sourceResourceId:string;ownerAccount:string}
type Selection={resourceId:string;workspaceId:string}
type Workspace={workspaceId:string;name:string}
const text=(value:unknown):value is string=>typeof value==='string' && !!value.trim() && value.length<=200
export function KnowledgeBindingPicker({value,permission,onChange}:{value:Selection;permission:string;onChange:(value:Selection,row:BindingCandidate|null)=>void}) {
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]),[items,setItems]=useState<BindingCandidate[]>([])
  const [selected,setSelected]=useState(''),[query,setQuery]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  const ready=workspaces.some(row=>row.workspaceId===value.workspaceId)
  async function load(scope:'workspaces'|'datasets') {
    controller.current?.abort();const request=new AbortController();controller.current=request
    setBusy(true);setItems([]);setSelected('');setMessage('');onChange(value,null)
    if(scope==='workspaces')setWorkspaces([])
    try {
      if(scope==='workspaces') {
        const rows=await pages('/api/workspaces?product=dify',(row:unknown):row is Workspace=>!!row && typeof row==='object' && text((row as Workspace).workspaceId) && text((row as Workspace).name),request.signal)
        if(new Set(rows.map(row=>row.workspaceId)).size!==rows.length)throw Error('工作区目录重复')
        if(!request.signal.aborted){setWorkspaces(rows);setMessage('请选择目标工作区，再读取知识库')}
      }else {
        const queryParams=new URLSearchParams({ticketType:'KB-03',action:'bind_dataset',workspaceId:value.workspaceId,permission,q:query.trim()})
        const rows=await pages('/api/execution-candidates?'+queryParams,(row:unknown):row is BindingCandidate=>!!row && typeof row==='object' &&
          ['resourceId','name','workspaceId','source','sourceSystem','sourceScopeId','sourceResourceId','ownerAccount'].every(key=>text((row as BindingCandidate)[key as keyof BindingCandidate])) &&
          ['本人纳管','已发布共享'].includes((row as BindingCandidate).source) && ['Dify','RAGFlow'].includes((row as BindingCandidate).sourceSystem),request.signal)
        if(new Set(rows.map(row=>row.resourceId)).size!==rows.length || rows.some(row=>row.workspaceId!==value.workspaceId))throw Error('知识库候选重复或目标工作区不匹配')
        if(!request.signal.aborted){setItems(rows);setMessage(rows.length?'请选择本人纳管库或已发布共享库':'当前权限与目标范围没有可选知识库')}
      }
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'候选读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  return <fieldset disabled={busy}><legend>选择知识库与目标工作区</legend>
    <button onClick={()=>load('workspaces')}>读取可用工作区</button>
    <label>工作区 ID<select aria-label="工作区 ID" value={value.workspaceId} onChange={event=>{setItems([]);setSelected('');setMessage('');onChange({resourceId:'',workspaceId:event.target.value},null)}}>
      <option value="">请选择</option>{value.workspaceId && !ready && <option disabled value={value.workspaceId}>{value.workspaceId} · 请重新读取工作区</option>}
      {workspaces.map(row=><option key={row.workspaceId} value={row.workspaceId}>{row.name} · {row.workspaceId}</option>)}
    </select></label>
    <label>知识库搜索<input maxLength={200} value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <button disabled={!ready} onClick={()=>load('datasets')}>读取可绑定知识库</button>
    {value.resourceId && selected!==value.resourceId && <p>待重新选择 · {value.resourceId}</p>}
    <label>目录知识库 ID<select aria-label="目录知识库 ID" value={selected===value.resourceId?selected:''} onChange={event=>{setSelected(event.target.value);onChange({resourceId:event.target.value,workspaceId:value.workspaceId},items.find(row=>row.resourceId===event.target.value) ?? null)}}>
      <option value="">请选择</option>{items.map(row=><option key={row.resourceId} value={row.resourceId}>{row.name} · {row.source} · {row.sourceSystem} · {row.resourceId}</option>)}
    </select></label><p role="status">{message}</p>
  </fieldset>
}
