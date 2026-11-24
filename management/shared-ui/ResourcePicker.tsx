import {useCallback,useEffect,useRef,useState} from 'react'
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

export function ResourcePicker({kind,value,onChange,workspaceLabel='工作区 ID',resourceLabel,catalogAction,candidateOperation,hideWorkspace=false,searchLabel='资源搜索',nameOnly=false,autoLoad=true,searchAction='刷新资源'}:{kind:'dify_app'|'mcp_registration'|'dify_dataset'|'ragflow_dataset'|'agent'|'mcp'|'skill'|'tool';value:Selection;onChange:(value:Selection,verified:boolean)=>void;workspaceLabel?:string;resourceLabel?:string;candidateOperation?:string;catalogAction?:'republish'|'withdraw_app'|'withdraw_skill'|'unbind_mcp'|'isolate_mcp'|'withdraw_mcp';hideWorkspace?:boolean;searchLabel?:string;nameOnly?:boolean;autoLoad?:boolean;searchAction?:string}) {
  const [workspaces,setWorkspaces]=useState<Workspace[]>([])
  const [items,setItems]=useState<Resource[]>([])
  const [selectedId,setSelectedId]=useState('')
  const [query,setQuery]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const controller=useRef<AbortController|null>(null)
  const onChangeRef=useRef(onChange)
  const valueRef=useRef(value)
  onChangeRef.current=onChange
  valueRef.current=value

  useEffect(()=>()=>{controller.current?.abort()},[])
  const catalog=kind==='agent' || kind==='mcp' || kind==='skill'
  const workspaceRequired=!hideWorkspace && (kind==='dify_app' || kind==='dify_dataset' || kind==='mcp' && !catalogAction || kind==='tool' && candidateOperation!=='撤销批准')
  const showWorkspaceSelector=workspaceRequired && workspaces.length>1
  const workspaceReady=!workspaceRequired || Boolean(value.workspaceId)
  const label=resourceLabel ?? (kind==='skill'?'Skill目录 ID':kind==='agent'?'仓库应用 ID':kind==='mcp'?'MCP目录 ID':kind==='dify_app'?'Dify应用 ID':kind==='mcp_registration'?'技术注册 ID':'知识库')

  const fetchResources=useCallback(async (wsId:string,searchText:string)=>{
    controller.current?.abort()
    const request=new AbortController();controller.current=request
    setBusy(true);setMessage('');setItems([]);setSelectedId('')
    onChangeRef.current({...valueRef.current,workspaceId:wsId || valueRef.current.workspaceId},false)
    try {
      const params=new URLSearchParams({kind,q:searchText.trim()})
      if(catalog && catalogAction)params.set('action',catalogAction)
      if(workspaceRequired && wsId)params.set('workspaceId',wsId)
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
      if(new Set(rows.map(row=>row.resourceId)).size!==rows.length)throw Error('资源目录存在重复标识')
      if(!request.signal.aborted){
        setItems(rows)
        setMessage(rows.length?'已自动同步当前账户可用资源，请选择；提交时将再次核验权限与快照':'当前账户下暂无可选资源')
      }
    }catch(error){
      if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'目录读取失败')
    }finally{
      if(!request.signal.aborted)setBusy(false)
    }
  },[catalog,catalogAction,candidateOperation,kind,workspaceRequired])

  // Auto-resolve user's tenant workspace(s) and load resources immediately on mount
  useEffect(()=>{
    let cancelled=false
    const initController=new AbortController()
    async function init() {
      if(workspaceRequired) {
        try {
          const rows=await pages('/api/workspaces?product=dify',isWorkspace,initController.signal)
          if(cancelled) return
          setWorkspaces(rows)
          const defaultWs=valueRef.current.workspaceId && rows.some(r=>r.workspaceId===valueRef.current.workspaceId)
            ? valueRef.current.workspaceId
            : (rows[0]?.workspaceId ?? '')
          if(defaultWs) {
            onChangeRef.current({...valueRef.current,workspaceId:defaultWs},false)
            if(autoLoad) await fetchResources(defaultWs,'')
          } else {
            setMessage('当前账户没有可用工作区')
          }
        } catch (err) {
          if(!cancelled && !initController.signal.aborted) {
            setMessage(err instanceof Error?err.message:'工作区读取失败')
          }
        }
      } else if(autoLoad) {
        await fetchResources('','')
      }
    }
    void init()
    return ()=>{cancelled=true;initController.abort()}
  },[autoLoad,fetchResources,workspaceRequired])

  return <fieldset disabled={busy}><legend>{kind==='tool'?'选择当前操作有资格的工具':kind==='skill'?'选择有下架资格的Skill':kind==='agent'?catalogAction?'选择有管理操作资格的智能体':'选择已发布智能体':kind==='mcp'?catalogAction?'选择有当前处置资格的MCP':'选择可申请绑定的MCP':kind==='dify_app'?'选择当前账户可用应用':kind==='mcp_registration'?'选择当前账户可用技术注册':'选择当前账户可用知识库'}</legend>
    {showWorkspaceSelector && <div className="picker-action-row">
      <label>{workspaceLabel}<select aria-label={workspaceLabel} value={value.workspaceId} onChange={event=>{const nextWs=event.target.value;setItems([]);setSelectedId('');setMessage('');onChange({workspaceId:nextWs,resourceId:''},false);if(nextWs)void fetchResources(nextWs,query)}}>
        {workspaces.map(row=><option key={row.workspaceId} value={row.workspaceId}>{row.name}</option>)}
      </select></label>
    </div>}
    <div className="picker-action-row">
      <label>{searchLabel}<input aria-label={searchLabel} value={query} maxLength={200} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void fetchResources(value.workspaceId,query)}}}/></label>
      <button type="button" className="secondary-button" disabled={!workspaceReady} onClick={()=>void fetchResources(value.workspaceId,query)}>{searchAction}</button>
    </div>
    {value.resourceId && selectedId!==value.resourceId && <p className="reselect-notice">{nameOnly?'请重新选择知识库':`待重新选择的资源 · ${value.resourceId}`}</p>}
    <label>{label}<select aria-label={label} value={selectedId===value.resourceId?selectedId:''} onChange={event=>{const resourceId=event.target.value;setSelectedId(resourceId);onChange({resourceId,workspaceId:selectedWorkspace(kind,candidateOperation,hideWorkspace,resourceId,items,value.workspaceId)},items.some(row=>row.resourceId===resourceId))}}>
      <option value="">请选择</option>
      {items.map(row=><option key={row.resourceId} value={row.resourceId}>{nameOnly?row.name:`${row.name} · ${row.resourceId}`}</option>)}
    </select></label>
    <p role="status">{message}</p>
  </fieldset>
}

function selectedWorkspace(kind:string,candidateOperation:string|undefined,hideWorkspace:boolean,resourceId:string,items:Resource[],current:string) {
  if(hideWorkspace) return items.find(row=>row.resourceId===resourceId)?.workspaceId ?? ''
  if(kind==='agent' || kind==='tool' && candidateOperation==='撤销批准') return items.find(row=>row.resourceId===resourceId)?.workspaceId ?? ''
  return current || items.find(row=>row.resourceId===resourceId)?.workspaceId || ''
}
