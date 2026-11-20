import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useState} from 'react'

import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
import {useResourceSnapshot} from '../../../shared-ui/useResourceSnapshot'
export function PublishResource({onMeta,ticketType='AG-02'}:{ticketType?:'AG-01'|'AG-02';onMeta:(meta:{name:string;level:string;line:string})=>void}) {
  const [workspace,setWorkspace]=useState('')
  const resource=useResourceSnapshot()
  const {snapshot}=resource
  const [pickerKey,setPickerKey]=useState(0)
  const [message,setMessage]=useState('')
  const [usages,setUsages]=useState(['run','embed'])
  const [fields,setFields]=useState({scenario:'',instructions:'',businessLine:'',classification:'内部',scope:'all',boundaryOrgs:'',targetOrgs:'',targetAccounts:''})
  const [draftResourceId,setDraftResourceId]=useState('')
  const [busy,setBusy]=useState(false)
  const draft=useApplicationDraft(ticketType,{...fields,usages,workspaceId:workspace,resourceId:draftResourceId},({resourceId,workspaceId,usages,...value})=>{setFields(value);setUsages(usages);setWorkspace(workspaceId);setDraftResourceId(resourceId);setPickerKey(key=>key+1);resource.reset();setMessage('');onMeta({name:'',level:'',line:''})})
  const {ticketNo}=draft
  async function submit() {
    const gap=submissionGaps([['本人应用',snapshot?.resourceId ?? ''],...ticketType==='AG-02'?[['业务场景',fields.scenario],['使用说明',fields.instructions],['业务线',fields.businessLine],['开放使用方式',usages.join(',')]] as [string,string][]:[]])
    if(gap){setMessage(gap);return}
    if(!snapshot)return
    setBusy(true)
    try {
      const list=(value:string)=>value.split(',').map(s=>s.trim()).filter(Boolean)
      const response=await draft.submit('/api/applications',{
        ticketNo,ticketType,resourceId:snapshot.resourceId,workspaceId:workspace,
        fields:ticketType==='AG-01'?{}:{...fields,boundaryOrgs:list(fields.boundaryOrgs),targetOrgs:list(fields.targetOrgs),targetAccounts:list(fields.targetAccounts),usages}})
      const data=await response.json()
      if(!response.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    } catch(error){setMessage(error instanceof Error?error.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || resource.busy || draft.controller.busy}><legend>Dify 应用与发布快照</legend>
    <ResourcePicker key={pickerKey} kind="dify_app" value={{resourceId:draftResourceId,workspaceId:workspace}} onChange={(value,verified)=>{
      resource.reset();setWorkspace(value.workspaceId);setDraftResourceId(value.resourceId);setMessage('');onMeta({name:'',level:'',line:''})
      if(verified)void resource.read('dify_app',value.resourceId,value.workspaceId).then(snapshot=>{if(snapshot)onMeta({name:snapshot.resourceId,level:'',line:''})})
    }}/>
    {snapshot && <div><p>资源 · {snapshot.resourceId}</p><p>快照 · {snapshot.snapshotId} · {snapshot.capturedAt}</p>
      <pre>{JSON.stringify(snapshot.data,null,2)}</pre></div>}
    {snapshot && ticketType==='AG-01' && <button className="primary-button" disabled={busy || draft.controller.busy} onClick={submit}>提交本人纳管同步</button>}
    {snapshot && ticketType==='AG-02' && <fieldset disabled={busy || draft.controller.busy}><legend>发布申请</legend>
      {(['scenario','instructions','businessLine','boundaryOrgs'] as const).map((key,i)=><label key={key}>{['业务场景','使用说明','业务线','组织边界（逗号分隔）'][i]}<input value={fields[key]} onChange={e=>setFields({...fields,[key]:e.target.value})}/></label>)}
      <label>密级<select value={fields.classification} onChange={e=>setFields({...fields,classification:e.target.value})}>{['公开','内部','敏感','机密'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>目标用户范围<select value={fields.scope} onChange={e=>setFields({...fields,scope:e.target.value})}><option value="all">全网段</option><option value="orgs">指定组织</option><option value="accounts">指定人员</option></select></label>
      {fields.scope==='orgs' && <label>目标组织（逗号分隔）<input value={fields.targetOrgs} onChange={e=>setFields({...fields,targetOrgs:e.target.value})}/></label>}
      {fields.scope==='accounts' && <label>目标人员（逗号分隔）<input value={fields.targetAccounts} onChange={e=>setFields({...fields,targetAccounts:e.target.value})}/></label>}
      <fieldset><legend>开放使用方式</legend>{[['run','运行'],['embed','嵌入网站'],['api','访问 API']].map(([key,label])=><label key={key}><input type="checkbox" checked={usages.includes(key)} onChange={e=>setUsages(items=>e.target.checked?[...items,key]:items.filter(item=>item!==key))}/>{label}</label>)}</fieldset>
      <button className="primary-button" disabled={!usages.length} onClick={submit}>提交发布审批</button>
    </fieldset>}
    <button className="secondary-button" onClick={()=>setMessage(submissionGaps([['本人应用',snapshot?.resourceId ?? ''],...ticketType==='AG-02'?[['业务场景',fields.scenario],['使用说明',fields.instructions],['业务线',fields.businessLine],['开放使用方式',usages.join(',')]] as [string,string][]:[]]) || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{resource.error || message}</p>
  </fieldset>
}
