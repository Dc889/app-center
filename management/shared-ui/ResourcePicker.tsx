import {useEffect,useRef,useState} from 'react'
import {readDirectoryPages as pages} from './directory-pages'

type Resource={resourceId:string;name:string;source:string;workspaceId:string|null}
type Workspace={workspaceId:string;name:string}
type CatalogResource={resourceId:string;name:string;status:string;actions:string[];data:Record<string,unknown>}
type Selection={resourceId:string;workspaceId:string}

const nonempty=(value:unknown):value is string=>typeof value==='string' && !!value.trim() && value.length<=200
const isWorkspace=(value:unknown):value is Workspace=>!!value && typeof value==='object' &&
  nonempty((value as Workspace).workspaceId) && nonempty((value as Workspace).name)
const isResource=(value:unknown):value is Resource=>!!value && typeof value==='object' &&
  nonempty((value as Resource).resourceId) && nonempty((value as Resource).name) && nonempty((value as Resource).source) &&
  ((value as Resource).workspaceId===null || nonempty((value as Resource).workspaceId))
const isCatalogResource=(value:unknown):value is CatalogResource=>!!value && typeof value==='object' &&
  nonempty((value as CatalogResource).resourceId) && nonempty((value as CatalogResource).name) && nonempty((value as CatalogResource).status) &&
  Array.isArray((value as CatalogResource).actions) && (value as CatalogResource).actions.every(nonempty) &&
  !!(value as CatalogResource).data && typeof (value as CatalogResource).data==='object' && !Array.isArray((value as CatalogResource).data)

export function ResourcePicker({kind,value,onChange,workspaceLabel='工作区 ID',resourceLabel,catalogAction,candidateOperation}:{kind:'dify_app'|'mcp_registration'|'dify_dataset'|'ragflow_dataset'|'agent'|'mcp'|'skill'|'tool';value:Selection;onChange:(value:Selection,verified:boolean)=>void;workspaceLabel?:string;resourceLabel?:string;candidateOperation?:string;catalogAction?:'republish'|'withdraw_app'|'withdraw_skill'|'unbind_mcp'|'isolate_mcp'|'withdraw_mcp'}) {
  const [workspaces,setWorkspaces]=useState<Workspace[]>([])
  const [items,setItems]=useState<Resource[]>([])
  const [selectedId,setSelectedId]=useState('')
  const [query,setQuery]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>{controller.current?.abort()},[])
  const catalog=kind==='agent' || kind==='mcp' || kind==='skill'
  const workspaceRequired=kind==='dify_app' || kind==='dify_dataset' || kind==='mcp' && !catalogAction || kind==='tool' && candidateOperation!=='撤销批准'
  const workspaceReady=!workspaceRequired || workspaces.some(row=>row.workspaceId===value.workspaceId)
  const label=resourceLabel ?? (kind==='skill'?'Skill目录 ID':kind==='agent'?'仓库应用 ID':kind==='mcp'?'MCP目录 ID':kind==='dify_app'?'Dify应用 ID':kind==='mcp_registration'?'技术注册 ID':'知识库')
  async function load(scope:'workspaces'|'resources') {
    controller.current?.abort()
    const request=new AbortController();controller.current=request
    setBusy(true);setMessage('');setItems([]);setSelectedId('')
    onChange(value,false)
    if(scope==='workspaces')setWorkspaces([])
    try {
      if(scope==='workspaces') {
        const rows=await pages('/api/workspaces?product=dify',isWorkspace,request.signal)
        if(new Set(rows.map(row=>row.workspaceId)).size!==rows.length)throw Error('工作区目录存在重复标识')
        if(!request.signal.aborted){setWorkspaces(rows);setMessage(rows.length?'请选择工作区，再读取资源':'当前账户没有可用工作区')}
      }else {
        const params=new URLSearchParams({kind,q:query.trim()})
        if(catalog && catalogAction)params.set('action',catalogAction)
        if(workspaceRequired)params.set('workspaceId',value.workspaceId)
        let rows:Resource[]
        if(catalog) {
          const entries=await pages('/api/catalog?'+params,isCatalogResource,request.signal)
          if(new Set(entries.map(row=>row.resourceId)).size!==entries.length)throw Error('资源目录存在重复标识或工作区不匹配')
          rows=entries.filter(row=>kind==='mcp' && catalogAction?
            (catalogAction==='unbind_mcp'?['active','isolated','withdrawn']:catalogAction==='isolate_mcp'?['active']:['active','isolated']).includes(row.status) && row.actions.includes(catalogAction):
            kind==='skill'?catalogAction==='withdraw_skill' && ['available','approved'].includes(row.status) && row.actions.includes('withdraw_skill') && nonempty(row.data.version):kind==='agent' && catalogAction?
            (catalogAction==='republish'?['active','unavailable','withdrawn']:['active','unavailable']).includes(row.status) && row.actions.includes(catalogAction) && nonempty(row.data.workspaceId):
            row.status==='active' && (kind==='agent'?nonempty(row.data.workspaceId) && Array.isArray(row.data.usages) && row.data.usages.some(usage=>['run','embed','api'].includes(usage)):
            row.actions.includes('bind') && ['instant','approval'].includes(String(row.data.bindingAccess))))
            .map(row=>({resourceId:row.resourceId,name:row.name,source:'catalog',workspaceId:kind==='agent'?String(row.data.workspaceId):null}))
        }else if(kind==='tool') {
          params.delete('kind');params.set('ticketType','TOL-01');params.set('action','set_tool_approval');params.set('operation',candidateOperation ?? '')
          rows=await pages('/api/execution-candidates?'+params,isResource,request.signal)
          if(rows.some(row=>!nonempty(row.workspaceId)))throw Error('工具候选缺少来源工作区')
        }else rows=await pages('/api/resources?'+params,isResource,request.signal)
        if(new Set(rows.map(row=>row.resourceId)).size!==rows.length || !catalog && workspaceRequired && rows.some(row=>row.workspaceId!==value.workspaceId))throw Error('资源目录存在重复标识或工作区不匹配')
        if(!request.signal.aborted){setItems(rows);setMessage(rows.length?'请选择资源；提交时将再次核验权限与快照':'当前范围没有可选资源')}
      }
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'目录读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  return <fieldset disabled={busy}><legend>{kind==='tool'?'选择当前操作有资格的工具':kind==='skill'?'选择有下架资格的Skill':kind==='agent'?catalogAction?'选择有管理操作资格的智能体':'选择已发布智能体':kind==='mcp'?catalogAction?'选择有当前处置资格的MCP':'选择可申请绑定的MCP':kind==='dify_app'?'选择当前账户可用应用':kind==='mcp_registration'?'选择当前账户可用技术注册':'选择当前账户可用知识库'}</legend>
    {workspaceRequired && <div className="picker-action-row">
      <label>{workspaceLabel}<select aria-label={workspaceLabel} value={value.workspaceId} onChange={event=>{setItems([]);setSelectedId('');setMessage('');onChange({workspaceId:event.target.value,resourceId:''},false)}}>
        <option value="">请选择</option>
        {value.workspaceId && !workspaceReady && <option value={value.workspaceId} disabled>{value.workspaceId} · 请重新读取工作区</option>}
        {workspaces.map(row=><option key={row.workspaceId} value={row.workspaceId}>{row.name} · {row.workspaceId}</option>)}
      </select></label>
      <button className="secondary-button" onClick={()=>load('workspaces')}>读取可用工作区</button>
    </div>}
    <div className="picker-action-row">
      <label>资源搜索<input value={query} maxLength={200} onChange={event=>setQuery(event.target.value)}/></label>
      <button className="secondary-button" disabled={!workspaceReady} onClick={()=>load('resources')}>读取可选资源</button>
    </div>
    {value.resourceId && selectedId!==value.resourceId && <p className="reselect-notice">待重新选择的资源 · {value.resourceId}</p>}
    <label>{label}<select aria-label={label} value={selectedId===value.resourceId?selectedId:''} onChange={event=>{const resourceId=event.target.value;setSelectedId(resourceId);onChange({resourceId,workspaceId:kind==='agent' || kind==='tool' && candidateOperation==='撤销批准'?items.find(row=>row.resourceId===resourceId)?.workspaceId ?? '':value.workspaceId},items.some(row=>row.resourceId===resourceId))}}>
      <option value="">请选择</option>
      {items.map(row=><option key={row.resourceId} value={row.resourceId}>{row.name} · {row.resourceId}</option>)}
    </select></label>
    <p role="status">{message}</p>
  </fieldset>
}
