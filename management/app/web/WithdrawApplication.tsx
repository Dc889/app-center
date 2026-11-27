import {ApplicationDrafts} from '../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../shared-ui/form-check'
import {useApplicationDraft} from '../../platform/workflow/public.web'
import {useEffect,useRef,useState} from 'react'
import {ResourcePicker} from '../../shared-ui/ResourcePicker'
import {useResourceSnapshot} from '../../shared-ui/useResourceSnapshot'
import {AgentReplacementPicker} from '../../modules/agents/public.web'
import {AgentImpactPanel} from '../../modules/agents/public.web'
import type {AgentImpact} from '../../modules/agents/public.web'
function defaultLocalDateTime() {
  const d = new Date(Date.now() + 60_000 - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

export function WithdrawApplication({ticketType='AG-05'}:{ticketType?:'AG-04'|'AG-05'|'SKL-04'}) {
  const [fields,setFields]=useState(()=>({resourceId:'',workspaceId:'',reason:'主动下架',explanation:'',effectiveAt:defaultLocalDateTime(),replacementAppId:''}))
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const resource=useResourceSnapshot()
  const [original,setOriginal]=useState<Record<string,unknown>|null>(null)
  const [impact,setImpact]=useState<AgentImpact|null>(null)
  const [pickerKey,setPickerKey]=useState(0)
  const [replacementVerified,setReplacementVerified]=useState(false),[replacementKey,setReplacementKey]=useState(0)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>{controller.current?.abort()},[])
  const action=ticketType==='SKL-04'?'withdraw_skill':ticketType==='AG-04'?'republish':'withdraw_app'
  const draft=useApplicationDraft(ticketType,fields,value=>{setFields(value);setImpact(null);setReplacementVerified(false);setReplacementKey(key=>key+1);setOriginal(null);resource.reset();controller.current?.abort();setPickerKey(key=>key+1);setMessage('')})
  const {ticketNo}=draft
  const gaps=()=>submissionGaps([[ticketType==='SKL-04'?'Skill目录 ID':'仓库应用 ID',original && (ticketType==='SKL-04' || resource.snapshot)?fields.resourceId:''],['原因说明',fields.explanation],
    ...ticketType==='AG-04'?[]:[['生效时间',fields.effectiveAt]] as [string,string][],...ticketType==='SKL-04'?[]:[['完整影响依据',impact && impact.dependencies.state==='collected' && (ticketType==='AG-04' || impact.grants.state==='collected' && impact.keys.state==='collected')?'已采集':'']] as [string,string][]])
  async function read(value:{resourceId:string;workspaceId:string}) {
    controller.current?.abort()
    const request=new AbortController();controller.current=request
    setBusy(true);setOriginal(null);setImpact(null);setMessage('')
    try {
      if(ticketType==='SKL-04') {
        const response=await fetch('/api/execution-contexts?'+new URLSearchParams({ticketType,action,resourceId:value.resourceId}),{signal:request.signal})
        const snapshot=await response.json(),f=snapshot.fields
        if(!response.ok)throw Error(snapshot.error?.message ?? '下架依据读取失败')
        if(snapshot.ticketType!=='SKL-04' || snapshot.action!==action || snapshot.resourceId!==value.resourceId || typeof snapshot.snapshotId!=='string' || !snapshot.snapshotId ||
          !f || typeof f['Skill名称']!=='string' || !f['Skill名称'] || typeof f['当前版本号']!=='string' || !f['当前版本号'] ||
          !['历史下载次数','历史下载人数'].every(key=>Number.isInteger(f[key]) && f[key]>=0))throw Error('下架依据与所选Skill不匹配或统计不完整')
        if(!request.signal.aborted)setOriginal({'Skill名称':f['Skill名称'],'当前版本号':f['当前版本号'],'历史下载次数':f['历史下载次数'],'历史下载人数':f['历史下载人数']})
        return
      }
      const r=await fetch('/api/catalog/agent/'+encodeURIComponent(value.resourceId)+'?action='+action,{signal:request.signal})
      const data=await r.json(),d=data.data
      if(!r.ok)throw Error(data.error?.message ?? '目录依据读取失败')
      if(data.resourceId!==value.resourceId || !d || d.workspaceId!==value.workspaceId || typeof d.appId!=='string' || !d.appId ||
        !Array.isArray(data.actions) || !data.actions.includes(action) ||
        !(action==='republish'?['active','unavailable','withdrawn']:['active','unavailable']).includes(data.status))throw Error('当前目录不允许此管理操作，或资源范围已变化')
      if(ticketType==='AG-04' && !['publicationVersionId','workflowSnapshotId','policyRef'].every(key=>typeof d[key]==='string' && d[key]))throw Error('目录缺少原发布版本、工作流或授权依据')
      const snapshot=await resource.read('dify_app',d.appId,value.workspaceId)
      if(request.signal.aborted || !snapshot)return
      if(typeof snapshot.data.publicationVersionId!=='string' || !snapshot.data.publicationVersionId || !Number.isInteger(snapshot.data.catalogRevision) ||
        ticketType==='AG-04' && (typeof snapshot.data.workflowSnapshotId!=='string' || !snapshot.data.workflowSnapshotId))throw Error('应用快照缺少新发布版本、工作流或目录修订')
      const impactResponse=await fetch('/api/agent-impact?'+new URLSearchParams({resourceId:value.resourceId,workspaceId:value.workspaceId,action}),{signal:request.signal})
      const evidence=await impactResponse.json()
      if(!impactResponse.ok)throw Error(evidence.error?.message ?? '影响依据读取失败')
      if(evidence.impact?.resourceId!==value.resourceId || evidence.impact?.appId!==d.appId || evidence.impact?.workspaceId!==value.workspaceId ||
        evidence.publicationVersionId!==snapshot.data.publicationVersionId || evidence.catalogRevision!==snapshot.data.catalogRevision || evidence.workflowSnapshotId!==(snapshot.data.workflowSnapshotId ?? null))throw Error('影响依据与所选应用版本不匹配')
      if(!request.signal.aborted){setImpact(evidence.impact);setOriginal({appId:d.appId,publicationVersionId:d.publicationVersionId,workflowSnapshotId:d.workflowSnapshotId})}
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'目录依据读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    if(ticketType==='AG-05' && fields.replacementAppId && !replacementVerified){setMessage('请重新选择并核验替代应用');return}
    setBusy(true)
    try {
      const {resourceId,workspaceId,...business}=fields
      const response=await draft.submit('/api/applications',{ticketNo,ticketType,resourceId,workspaceId,fields:{
          ...business,changeDescription:fields.explanation,effectiveAt:fields.effectiveAt ? new Date(fields.effectiveAt).toISOString() : ''}})
      const data=await response.json()
      if(!response.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || resource.busy || draft.controller.busy}><legend>{ticketType==='AG-04'?'智能体变更再发布':ticketType==='SKL-04'?'Skill下架申请':'智能体下架申请'}</legend>
    <ResourcePicker key={'source:'+pickerKey} kind={ticketType==='SKL-04'?'skill':'agent'} catalogAction={action} value={fields} onChange={(value,verified)=>{controller.current?.abort();resource.reset();setFields(current=>({...current,...value}));setImpact(null);setReplacementVerified(false);setReplacementKey(key=>key+1);setOriginal(null);setMessage('');if(verified)void read(value)}}/>
    {ticketType!=='SKL-04' && <>
      <label>来源工作区<input aria-label="来源工作区" readOnly value={fields.workspaceId}/></label>
      <label>Dify应用 ID<input aria-label="Dify应用 ID" readOnly value={String(original?.appId ?? '')}/></label>
      {original && ticketType==='AG-04' && <p>原发布版本 · {String(original.publicationVersionId)} · 原工作流 · {String(original.workflowSnapshotId)}<br/>新发布版本 · {String(resource.snapshot?.data.publicationVersionId)} · 新工作流 · {String(resource.snapshot?.data.workflowSnapshotId)}</p>}
    </>}
    {original && ticketType==='SKL-04' && <p>Skill · {String(original['Skill名称'])} · 当前版本 · {String(original['当前版本号'])}<br/>历史下载次数 · {String(original['历史下载次数'])} · 历史下载人数 · {String(original['历史下载人数'])}</p>}
    {impact && <AgentImpactPanel impact={impact}/>}
    <label>原因说明<textarea value={fields.explanation} rows={2} onChange={e=>setFields({...fields,explanation:e.target.value})}/></label>
    {ticketType==='AG-05' && <AgentReplacementPicker key={'replacement:'+replacementKey} sourceResourceId={fields.resourceId} value={fields.replacementAppId} enabled={!!original && !!resource.snapshot} onChange={(value,verified)=>{setFields(current=>({...current,replacementAppId:value}));setReplacementVerified(verified)}}/>}
    {ticketType!=='AG-04' && <><label>下架原因<select value={fields.reason} onChange={e=>setFields({...fields,reason:e.target.value})}>{(ticketType==='SKL-04'?['主动下架','安全问题','授权问题','过期','其他']:['主动下架','版本替换','安全事件','长期故障','其他']).map(s=><option key={s}>{s}</option>)}</select></label>
    <label>生效时间<input type="datetime-local" value={fields.effectiveAt} onChange={e=>setFields({...fields,effectiveAt:e.target.value})}/></label></>}
    <button className="primary-button" onClick={submit}>{ticketType==='AG-04'?'提交再发布审批':'提交下架审批'}</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{resource.error || message}</p>
  </fieldset>
}
