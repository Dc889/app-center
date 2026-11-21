import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useEffect,useRef,useState} from 'react'
import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
import {useResourceSnapshot} from '../../../shared-ui/useResourceSnapshot'
import {PublicationApplicationPicker} from '../../agents/public.web'
type Context={snapshotId:string;capturedAt:string;fields:Record<string,unknown>;preconditions:unknown[]}
export function DatasetPublicationContext() {
  const [form,setForm]=useState({shareMode:'共享目录',targetOrgs:'',targetAccounts:'',relatedAppId:'',relatedWorkspaceId:'',purpose:'',boundaryOrgs:'',classification:'内部',businessLine:'',name:'',description:'',tags:'',expiresAt:''})
  const [associationVerified,setAssociationVerified]=useState(false),[associationKey,setAssociationKey]=useState(0)
  const [submitted,setSubmitted]=useState(false)
  const [resourceId,setResourceId]=useState('')
  const [workspaceId,setWorkspaceId]=useState('')
  const [sourceSystem,setSourceSystem]=useState('Dify')
  const [pickerKey,setPickerKey]=useState(0)
  const resource=useResourceSnapshot()
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>{controller.current?.abort()},[])
  const [context,setContext]=useState<Context|null>(null)
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const draft=useApplicationDraft('KB-02',{...form,resourceId,workspaceId,sourceSystem},({resourceId,workspaceId,sourceSystem,...value})=>{setForm(value);setAssociationVerified(false);setAssociationKey(key=>key+1);setResourceId(resourceId);setWorkspaceId(workspaceId);setSourceSystem(sourceSystem);setPickerKey(key=>key+1);resource.reset();controller.current?.abort();setContext(null);setSubmitted(false);setMessage('')})
  const {ticketNo}=draft
  async function read() {
    if(!resource.snapshot || resource.snapshot.resourceId!==resourceId)return
    setBusy(true);setContext(null);setMessage('');setAssociationVerified(false);setAssociationKey(key=>key+1)
    controller.current?.abort()
    const request=new AbortController();controller.current=request
    try {
      const params=new URLSearchParams({ticketType:'KB-02',action:'publish_dataset',resourceId})
      if(workspaceId)params.set('workspaceId',workspaceId)
      const r=await fetch('/api/execution-contexts?'+params,{signal:request.signal})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '审批依据读取失败')
      const f=data.fields,docs=f?.['文档审查明细']
      if(data.ticketType!=='KB-02' || data.action!=='publish_dataset' || data.resourceId!==resourceId ||
        typeof data.snapshotId!=='string' || !data.snapshotId.trim() || typeof data.capturedAt!=='string' || !Number.isFinite(Date.parse(data.capturedAt)) ||
        f?.['来源系统']!==sourceSystem || f?.['workspace/tenant ID']!==workspaceId || typeof f?.['所有者账户名']!=='string' || !f['所有者账户名'] ||
        !Array.isArray(docs) || !Number.isInteger(f['文档数']) || f['文档数']!==docs.length ||
        !docs.every((d:Record<string,unknown>)=>d && typeof d.documentId==='string' && d.documentId && typeof d.sha256==='string' && /^[a-f0-9]{64}$/.test(d.sha256)) ||
        new Set(docs.map((d:{documentId:string})=>d.documentId)).size!==docs.length ||
        typeof f['文档清单快照ID']!=='string' || !f['文档清单快照ID'] || !Array.isArray(data.preconditions) ||
        !data.preconditions.some((p:Record<string,unknown>)=>p && p.kind==='dataset_manifest' && p.id===f['文档清单快照ID'] && typeof p.sha256==='string' && /^[a-f0-9]{64}$/.test(p.sha256)))throw Error('文档审查依据与所选来源、范围或文档清单不匹配，请重新读取')
      if(!request.signal.aborted)setContext(data)
    }catch(e){if(!request.signal.aborted)setMessage(e instanceof Error?e.message:'读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function submit() {
    const gap=submissionGaps([['源知识库 ID',resourceId],['文档审查与模型核对',context?.snapshotId ?? ''],['业务用途',form.purpose]])
    if(gap){setMessage(gap);return}
    if(form.shareMode==='随应用发布' && (!form.relatedAppId || !form.relatedWorkspaceId || !associationVerified)){setMessage('请重新选择并核验关联应用和Dify工作区');return}
    if(!context)return
    setBusy(true)
    try {
      const list=(v:string)=>v.split(',').map(s=>s.trim()).filter(Boolean)
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'KB-02',resourceId,workspaceId,
        fields:{...form,sourceSystem,targetOrgs:list(form.targetOrgs),targetAccounts:list(form.targetAccounts),
          boundaryOrgs:list(form.boundaryOrgs),tags:list(form.tags),expiresAt:form.expiresAt?new Date(form.expiresAt).toISOString():null}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setSubmitted(true);setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || resource.busy || draft.controller.busy}><legend>知识库发布审批依据</legend>
    <fieldset disabled={submitted}><legend>来源知识库</legend>
      <label>来源系统<select aria-label="来源系统" value={sourceSystem} onChange={e=>{controller.current?.abort();setAssociationVerified(false);setAssociationKey(key=>key+1);setSourceSystem(e.target.value);setResourceId('');setWorkspaceId('');setContext(null);setPickerKey(key=>key+1);resource.reset();setMessage('')}}><option>Dify</option><option>RAGFlow</option></select></label>
      <ResourcePicker key={pickerKey} kind={sourceSystem==='Dify'?'dify_dataset':'ragflow_dataset'} workspaceLabel="workspace ID（Dify 来源填写）" resourceLabel="源知识库 ID" value={{resourceId,workspaceId}} onChange={(value,verified)=>{
        controller.current?.abort();setAssociationVerified(false);setAssociationKey(key=>key+1);resource.reset();setResourceId(value.resourceId);setWorkspaceId(value.workspaceId);setContext(null);setMessage('')
        if(verified)void resource.read(sourceSystem==='Dify'?'dify_dataset':'ragflow_dataset',value.resourceId,value.workspaceId).then(snapshot=>{if(snapshot && sourceSystem==='RAGFlow')setWorkspaceId(snapshot.data.tenantId as string)})
      }}/>
      {sourceSystem==='RAGFlow' && <label>tenant ID<input aria-label="tenant ID" readOnly value={workspaceId}/></label>}
      <button className="secondary-button" disabled={!resource.snapshot} onClick={read}>读取文档审查与模型核对</button>
    </fieldset>
    {context && <div><p>依据快照 {context.snapshotId} · {context.capturedAt}</p><details className="technical-details"><summary>详细信息</summary><pre>{JSON.stringify(context.fields,null,2)}</pre></details></div>}
    {context && <fieldset disabled={submitted}><legend>知识库分享申请</legend>
      <label>分享方式<select aria-label="分享方式" value={form.shareMode} onChange={e=>{setForm({...form,shareMode:e.target.value});setAssociationVerified(false);setAssociationKey(key=>key+1)}}>{['共享目录','指定组织','指定人员','随应用发布'].map(s=><option key={s}>{s}</option>)}</select></label>
      {(['purpose','boundaryOrgs','businessLine','name','description','tags'] as const).map((key,i)=><label key={key}>{['业务用途','组织边界（逗号分隔）','业务线','目录展示名称','目录简介','目录标签（逗号分隔）'][i]}<input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
      {form.shareMode==='指定组织' && <label>目标组织<input value={form.targetOrgs} onChange={e=>setForm({...form,targetOrgs:e.target.value})}/></label>}
      {form.shareMode==='指定人员' && <label>目标人员<input value={form.targetAccounts} onChange={e=>setForm({...form,targetAccounts:e.target.value})}/></label>}
      {form.shareMode==='随应用发布' && <PublicationApplicationPicker key={associationKey} workspaceId={form.relatedWorkspaceId} appId={form.relatedAppId} onWorkspace={value=>{setForm(current=>({...current,relatedWorkspaceId:value}));setAssociationVerified(false)}} onChange={(value,verified)=>{setForm(current=>({...current,relatedAppId:value}));setAssociationVerified(verified)}}/>}
      <label>密级<select value={form.classification} onChange={e=>setForm({...form,classification:e.target.value})}>{['公开','内部','敏感','机密'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>有效期截止时间（选填）<input type="datetime-local" value={form.expiresAt} onChange={e=>setForm({...form,expiresAt:e.target.value})}/></label>
      <button className="primary-button" onClick={submit}>提交知识库分享审批</button>
    </fieldset>}
    <button className="secondary-button" onClick={()=>setMessage(submissionGaps([['源知识库 ID',resourceId],['文档审查与模型核对',context?.snapshotId ?? ''],['业务用途',form.purpose]]) || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{resource.error || message}</p>
  </fieldset>
}
