import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useState} from 'react'
import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
import {useResourceSnapshot} from '../../../shared-ui/useResourceSnapshot'
export function KnowledgeSync() {
  const [source,setSource]=useState('Dify')
  const [context,setContext]=useState('')
  const resource=useResourceSnapshot()
  const [pickerKey,setPickerKey]=useState(0)
  const [message,setMessage]=useState('')
  const [draftResourceId,setDraftResourceId]=useState('')
  const [busy,setBusy]=useState(false)
  const draft=useApplicationDraft('KB-01',{sourceSystem:source,workspaceId:context,resourceId:draftResourceId},value=>{setSource(value.sourceSystem);setContext(value.workspaceId);setDraftResourceId(value.resourceId);setPickerKey(key=>key+1);resource.reset();setMessage('')})
  const {ticketNo}=draft
  const resourceId=resource.snapshot?.resourceId ?? ''
  const gaps=()=>submissionGaps([[source==='Dify'?'workspace ID':'tenant ID',context],['知识库',resourceId]])
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true);setMessage('')
    try {
      const response=await draft.submit('/api/applications',{ticketNo,ticketType:'KB-01',resourceId,workspaceId:context,fields:{sourceSystem:source}})
      const data=await response.json()
      if(!response.ok)throw Error(data.error?.message ?? '读取或同步失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'操作失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || resource.busy || draft.controller.busy}><legend>个人知识库纳管同步</legend>
    <label>来源系统<select aria-label="来源系统" value={source} onChange={e=>{setSource(e.target.value);setContext('');setDraftResourceId('');setPickerKey(key=>key+1);resource.reset();setMessage('')}}><option>Dify</option><option>RAGFlow</option></select></label>
    <ResourcePicker key={pickerKey} kind={source==='Dify'?'dify_dataset':'ragflow_dataset'} workspaceLabel="workspace ID" value={{resourceId:draftResourceId,workspaceId:context}} onChange={(value,verified)=>{
      resource.reset();setContext(value.workspaceId);setDraftResourceId(value.resourceId);setMessage('')
      if(verified)void resource.read(source==='Dify'?'dify_dataset':'ragflow_dataset',value.resourceId,value.workspaceId).then(snapshot=>{if(snapshot && source==='RAGFlow')setContext(snapshot.data.tenantId as string)})
    }}/>
    {source==='RAGFlow' && <label>tenant ID<input aria-label="tenant ID" value={context} readOnly/></label>}
    {resource.snapshot && <p>快照 · {resource.snapshot.snapshotId} · {resource.snapshot.capturedAt}</p>}
    <p>同步至仅本人可见的个人目录</p>
    <button className="primary-button" disabled={!resourceId} onClick={submit}>提交知识库同步</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{resource.error || message}</p>
  </fieldset>
}
