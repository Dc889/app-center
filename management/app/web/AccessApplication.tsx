import {ApplicationDrafts} from '../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../shared-ui/form-check'
import {useApplicationDraft} from '../../platform/workflow/public.web'
import {useEffect,useRef,useState} from 'react'
import {ResourcePicker} from '../../shared-ui/ResourcePicker'
import {KnowledgeBindingPicker} from '../../modules/knowledge/public.web'
import type {BindingCandidate} from '../../modules/knowledge/public.web'
import {ApplicationTargetPicker} from '../../modules/agents/public.web'
export function AccessApplication({ticketType='AG-03'}:{ticketType?:'AG-03'|'KB-03'|'MCP-02'}) {
  const [fields,setFields]=useState({resourceId:'',workspaceId:'',purpose:'',startsAt:'',expiresAt:'',permission:'检索使用',targetAppId:''})
  const [context,setContext]=useState<Record<string,unknown>|null>(null)
  const [usages,setUsages]=useState(['run'])
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [selection,setSelection]=useState<{resourceId:string;workspaceId:string}|null>(null)
  const [pickerKey,setPickerKey]=useState(0)
  const [datasetCandidate,setDatasetCandidate]=useState<BindingCandidate|null>(null)
  const [targetVerified,setTargetVerified]=useState(false),[targetKey,setTargetKey]=useState(0)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>{controller.current?.abort()},[])
  const draft=useApplicationDraft(ticketType,{...fields,usages},({usages,...value})=>{setFields(value);setUsages(usages);setSelection(null);setDatasetCandidate(null);setTargetVerified(false);setTargetKey(key=>key+1);setPickerKey(key=>key+1);controller.current?.abort();setContext(null);setMessage('')})
  const {ticketNo}=draft
  const selected=selection?.resourceId===fields.resourceId && selection?.workspaceId===fields.workspaceId
  const gaps=()=>submissionGaps([[ticketType==='KB-03'?'目录知识库 ID':ticketType==='MCP-02'?'MCP目录 ID':'仓库应用 ID',selected?fields.resourceId:''],
    ['工作区 ID',fields.workspaceId],['使用目的',fields.purpose],['使用开始时间',fields.startsAt],['使用截止时间',fields.expiresAt],
    ['当前资源依据',context?'已读取':''],...ticketType==='AG-03'?[['申请访问方式',usages.join(',')]] as [string,string][]:[['目标应用核验',!fields.targetAppId || targetVerified?'已核验':'']] as [string,string][]])
  async function readAgent(value:{resourceId:string;workspaceId:string}) {
    controller.current?.abort()
    const request=new AbortController();controller.current=request
    setBusy(true);setContext(null);setMessage('')
    try {
      const r=await fetch('/api/catalog/agent/'+encodeURIComponent(value.resourceId),{signal:request.signal})
      const data=await r.json(),d=data.data
      if(!r.ok)throw Error(data.error?.message ?? '智能体依据读取失败')
      if(data.resourceId!==value.resourceId || data.status!=='active' || !d || d.workspaceId!==value.workspaceId ||
        typeof d.appId!=='string' || !d.appId || !Array.isArray(d.usages) || !d.usages.length ||
        !d.usages.every((usage:unknown)=>typeof usage==='string' && ['run','embed','api'].includes(usage)))throw Error('智能体目录详情与所选资源、工作区或使用方式不匹配')
      if(!request.signal.aborted){setContext({appId:d.appId,workspaceId:d.workspaceId,usages:d.usages});setUsages(current=>current.filter(usage=>d.usages.includes(usage)))}
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'智能体依据读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true)
    try {
      const r=await draft.submit('/api/applications',{ticketNo,ticketType,resourceId:fields.resourceId,workspaceId:fields.workspaceId,fields:{
          purpose:fields.purpose,permission:fields.permission,targetAppId:fields.targetAppId,startsAt:fields.startsAt?new Date(fields.startsAt).toISOString():'',
          expiresAt:fields.expiresAt?new Date(fields.expiresAt).toISOString():'',usages}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  async function readContext(targetOverride?:string) {
    if(!selected)return
    if(targetOverride===undefined){setTargetVerified(false);setTargetKey(key=>key+1)}
    controller.current?.abort()
    const request=new AbortController();controller.current=request
    setBusy(true);setContext(null)
    try {
      const params=new URLSearchParams({resourceId:fields.resourceId,workspaceId:fields.workspaceId})
      if(ticketType==='KB-03'){params.set('ticketType','KB-03');params.set('action','bind_dataset');params.set('permission',fields.permission);if(targetOverride ?? fields.targetAppId)params.set('targetAppId',targetOverride ?? fields.targetAppId)}
      const r=await fetch((ticketType==='MCP-02'?'/api/mcp-binding-context?':'/api/execution-contexts?')+params,{signal:request.signal})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '读取失败')
      if(ticketType==='MCP-02' && (data.resourceId!==fields.resourceId || data.workspaceId!==fields.workspaceId || !['instant','approval'].includes(data.bindingAccess)))throw Error('绑定依据与所选MCP或工作区不匹配')
      if(ticketType==='KB-03' && (!datasetCandidate || data.resourceId!==fields.resourceId || data.eligible!==true || data.fields?.['目标Dify workspace ID']!==fields.workspaceId ||
        data.fields?.['目录来源']!==datasetCandidate.source || data.fields?.['来源系统']!==datasetCandidate.sourceSystem || data.fields?.['源workspace/tenant ID']!==datasetCandidate.sourceScopeId ||
        data.fields?.['源知识库ID']!==datasetCandidate.sourceResourceId || data.fields?.['源所有者账户名']!==datasetCandidate.ownerAccount))throw Error('绑定依据与所选知识库来源不匹配，请重新选择')
      if(!request.signal.aborted){setContext(ticketType==='MCP-02'?{resourceId:data.resourceId,workspaceId:data.workspaceId,bindingAccess:data.bindingAccess}:data.fields);setMessage('')}
    }catch(e){if(!request.signal.aborted)setMessage(e instanceof Error?e.message:'读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || draft.controller.busy}><legend>{ticketType==='KB-03'?'知识库使用与绑定':ticketType==='MCP-02'?'MCP使用与绑定':'智能体使用授权'}</legend>
    {ticketType==='KB-03'?<KnowledgeBindingPicker key={pickerKey} value={fields} permission={fields.permission} onChange={(value,row)=>{controller.current?.abort();setFields(current=>({...current,...value}));setTargetVerified(false);setTargetKey(key=>key+1);setDatasetCandidate(row);setSelection(row?value:null);setContext(null);setMessage('')}}/>:
      <ResourcePicker key={pickerKey} kind={ticketType==='AG-03'?'agent':'mcp'} value={fields} onChange={(value,verified)=>{
        controller.current?.abort();setFields(current=>({...current,...value}));setTargetVerified(false);setTargetKey(key=>key+1);setSelection(verified?value:null);setContext(null);setMessage('')
        if(verified && ticketType==='AG-03')void readAgent(value)
      }}/>}
    {ticketType==='AG-03' && <><label>来源工作区<input aria-label="来源工作区" readOnly value={fields.workspaceId}/></label><label>Dify应用 ID<input aria-label="Dify应用 ID" readOnly value={String(context?.appId ?? '')}/></label></>}
    <label>使用目的<input value={fields.purpose} onChange={e=>setFields({...fields,purpose:e.target.value})}/></label>
    <label>使用开始时间<input type="datetime-local" value={fields.startsAt} onChange={e=>setFields({...fields,startsAt:e.target.value})}/></label>
    <label>使用截止时间<input type="datetime-local" value={fields.expiresAt} onChange={e=>setFields({...fields,expiresAt:e.target.value})}/></label>
    {ticketType==='AG-03' && ([['run','运行'],['embed','嵌入网站'],['api','访问 API']] as const).map(([key,label])=><label key={key}><input type="checkbox" disabled={!Array.isArray(context?.usages) || !context.usages.includes(key)} checked={usages.includes(key)} onChange={e=>setUsages(values=>e.target.checked?[...values,key]:values.filter(v=>v!==key))}/>{label}</label>)}
    {['KB-03','MCP-02'].includes(ticketType) && <div>{ticketType==='KB-03' && <label>申请权限<select aria-label="申请权限" value={fields.permission} onChange={e=>{controller.current?.abort();setFields({...fields,permission:e.target.value});setTargetVerified(false);setTargetKey(key=>key+1);setSelection(null);setDatasetCandidate(null);setContext(null);setPickerKey(key=>key+1)}}><option>检索使用</option><option>编排绑定</option></select></label>}
      <ApplicationTargetPicker key={targetKey+':'+fields.workspaceId} purpose={ticketType==='KB-03'?'dataset_binding':'mcp_binding'} workspaceId={fields.workspaceId} value={fields.targetAppId} enabled={!!selected && (ticketType==='KB-03' || !!context)} onChange={(value,verified)=>{setFields(current=>({...current,targetAppId:value}));setTargetVerified(verified);if(ticketType==='KB-03'){setContext(null);if(verified)void readContext(value)}}}/>
      <button className="secondary-button" disabled={!selected} onClick={()=>void readContext()}>读取绑定依据</button>
      {context && (ticketType==='KB-03'?<fieldset><legend>知识库绑定依据</legend>{Object.entries(context).filter(([key])=>key!=='policyRef').map(([key,value])=><label key={key}>{key}<textarea aria-label={key} readOnly value={typeof value==='string'?value:JSON.stringify(value)}/></label>)}</fieldset>:<details className="technical-details"><summary>详细信息</summary><pre>{JSON.stringify(context,null,2)}</pre></details>)}
    </div>}
    <button className="primary-button" disabled={ticketType==='AG-03' && !usages.length} onClick={submit}>提交使用授权</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
