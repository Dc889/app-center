import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useState} from 'react'
import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
export function McpRegistration() {
  const [form,setForm]=useState({resourceId:'',name:'',purpose:'',boundaryOrgs:'',classification:'内部',businessLine:''})
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [verifiedId,setVerifiedId]=useState('')
  const [pickerKey,setPickerKey]=useState(0)
  const draft=useApplicationDraft('MCP-01',form,value=>{setForm(value);setVerifiedId('');setPickerKey(key=>key+1);setMessage('')})
  const {ticketNo}=draft
  const gaps=()=>submissionGaps([['技术注册 ID',verifiedId===form.resourceId?form.resourceId:''],['MCP名称',form.name],['MCP用途',form.purpose]])
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true)
    try {
      const {resourceId,...fields}=form
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'MCP-01',resourceId,fields:{...fields,boundaryOrgs:form.boundaryOrgs.split(',').map(s=>s.trim()).filter(Boolean)}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || draft.controller.busy}><legend>MCP上架登记</legend>
    <ResourcePicker key={pickerKey} kind="mcp_registration" value={{resourceId:form.resourceId,workspaceId:''}} onChange={(value,verified)=>{setForm(previous=>({...previous,resourceId:value.resourceId}));setVerifiedId(verified?value.resourceId:'')}}/>
    {(['name','purpose','boundaryOrgs','businessLine'] as const).map((key,i)=><label key={key}>{['MCP名称','MCP用途','组织边界（逗号分隔）','业务线'][i]}<input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
    <label>密级<select value={form.classification} onChange={e=>setForm({...form,classification:e.target.value})}>{['公开','内部','敏感','机密'].map(s=><option key={s}>{s}</option>)}</select></label>
    <button className="primary-button" onClick={submit}>提交MCP登记审批</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
