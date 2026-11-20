import {useEffect,useRef,useState} from 'react'
import {readDirectoryPages as pages} from '../../../shared-ui/directory-pages'

type Selection={resourceId:string;workspaceId:string;installationId:string}
type Candidate={resourceId:string;workspaceId:string;installationId:string|null;name:string;source:string}
type Workspace={workspaceId:string;name:string}
const text=(value:unknown):value is string=>typeof value==='string' && !!value.trim() && value.length<=200
const identity=(value:{resourceId:string;workspaceId:string;installationId:string|null})=>JSON.stringify([value.resourceId,value.workspaceId,value.installationId || ''])
const actions:Record<string,string>={'安装':'install','升级':'upgrade','卸载':'uninstall'}

export function PluginOperationPicker({operation,value,onChange}:{operation:string;value:Selection;onChange:(value:Selection,verified:boolean)=>void}) {
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]),[items,setItems]=useState<Candidate[]>([])
  const [selected,setSelected]=useState(''),[query,setQuery]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  const cleanup=operation==='卸载'
  const ready=cleanup || workspaces.some(row=>row.workspaceId===value.workspaceId)
  async function load(scope:'workspaces'|'plugins') {
    controller.current?.abort();const request=new AbortController();controller.current=request
    setBusy(true);setMessage('');setItems([]);setSelected('');onChange({...value,installationId:''},false)
    if(scope==='workspaces')setWorkspaces([])
    try {
      if(scope==='workspaces') {
        const rows=await pages('/api/workspaces?product=dify',(row:unknown):row is Workspace=>!!row && typeof row==='object' && text((row as Workspace).workspaceId) && text((row as Workspace).name),request.signal)
        if(new Set(rows.map(row=>row.workspaceId)).size!==rows.length)throw Error('工作区目录存在重复标识')
        if(!request.signal.aborted){setWorkspaces(rows);setMessage(rows.length?'请选择工作区，再读取候选':'当前账户没有可用工作区')}
      }else {
        const queryParams=new URLSearchParams({ticketType:'PLG-03',action:actions[operation],operation,q:query.trim()})
        if(!cleanup)queryParams.set('workspaceId',value.workspaceId)
        const rows=await pages('/api/execution-candidates?'+queryParams,(row:unknown):row is Candidate=>{
          if(!row || typeof row!=='object')return false
          const candidate=row as Candidate
          return ['resourceId','workspaceId','name','source'].every(key=>text(candidate[key as keyof Candidate])) &&
            (operation==='安装'?candidate.installationId===null:text(candidate.installationId))
        },request.signal)
        if(new Set(rows.map(identity)).size!==rows.length || !cleanup && rows.some(row=>row.workspaceId!==value.workspaceId))throw Error('候选重复或目标工作区不匹配')
        if(!request.signal.aborted){setItems(rows);setMessage(rows.length?'请选择插件或具体安装实例':'当前操作没有可选对象')}
      }
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'候选读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  return <fieldset disabled={busy}><legend>{operation==='安装'?'选择可申请安装的插件':'选择可操作的安装实例'}</legend>
    {!cleanup && <><button onClick={()=>load('workspaces')}>读取可用工作区</button>
      <label>目标Dify workspace ID<select aria-label="目标Dify workspace ID" value={value.workspaceId} onChange={event=>{setItems([]);setSelected('');setMessage('');onChange({workspaceId:event.target.value,resourceId:'',installationId:''},false)}}>
        <option value="">请选择</option>{value.workspaceId && !ready && <option disabled value={value.workspaceId}>{value.workspaceId} · 请重新读取工作区</option>}
        {workspaces.map(row=><option key={row.workspaceId} value={row.workspaceId}>{row.name} · {row.workspaceId}</option>)}
      </select></label></>}
    <label>插件搜索<input value={query} maxLength={200} onChange={event=>setQuery(event.target.value)}/></label>
    <button disabled={!ready} onClick={()=>load('plugins')}>读取插件操作候选</button>
    {value.resourceId && selected!==identity(value) && <p>待重新选择 · {value.resourceId}</p>}
    <label>插件操作对象<select aria-label="插件操作对象" value={selected===identity(value)?selected:''} onChange={event=>{
      const row=items.find(item=>identity(item)===event.target.value);setSelected(event.target.value)
      onChange({resourceId:row?.resourceId ?? '',workspaceId:row?.workspaceId ?? (cleanup?'':value.workspaceId),installationId:row?.installationId ?? ''},!!row)
    }}><option value="">请选择</option>{items.map(row=><option key={identity(row)} value={identity(row)}>{row.name} · {row.resourceId} · {row.workspaceId}{row.installationId?' · '+row.installationId:''}</option>)}</select></label>
    {cleanup && <label>目标Dify workspace ID<input aria-label="目标Dify workspace ID" readOnly value={value.workspaceId}/></label>}
    <p role="status">{message}</p>
  </fieldset>
}
