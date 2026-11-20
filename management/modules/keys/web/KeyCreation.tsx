import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useState} from 'react'
import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
export function KeyCreation() {
  const [fields,setFields]=useState({resourceId:'',workspaceId:'',purpose:'本人调试',callerName:'',callerOrg:'',environment:'开发',allowedCidrs:'',peakQps:'1',expiresAt:'',publicationTicketNo:''})
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [selection,setSelection]=useState<{resourceId:string;workspaceId:string}|null>(null)
  const [pickerKey,setPickerKey]=useState(0)
  const draft=useApplicationDraft('KEY-01',fields,value=>{setFields(value);setSelection(null);setPickerKey(key=>key+1);setMessage('')})
  const {ticketNo}=draft
  const gaps=()=>submissionGaps([['Dify应用 ID',selection?.resourceId===fields.resourceId && selection?.workspaceId===fields.workspaceId?fields.resourceId:''],['工作区 ID',fields.workspaceId],['调用方名称',fields.callerName],['调用方组织',fields.callerOrg],['有效期截止时间',fields.expiresAt]])
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true)
    try {
      const {resourceId,workspaceId,...business}=fields
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'KEY-01',resourceId,workspaceId,fields:{...business,allowedCidrs:fields.allowedCidrs.split(',').map(s=>s.trim()).filter(Boolean),
          peakQps:Number(fields.peakQps),expiresAt:fields.expiresAt?new Date(fields.expiresAt).toISOString():''}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || draft.controller.busy}><legend>Dify API密钥创建登记</legend>
    <ResourcePicker key={pickerKey} kind="dify_app" value={fields} onChange={(value,verified)=>{setFields(previous=>({...previous,...value}));setSelection(verified?value:null)}}/>
    {(['callerName','callerOrg','allowedCidrs'] as const).map((key,i)=><label key={key}>{['调用方名称','调用方组织','允许来源CIDR（逗号分隔）'][i]}<input value={fields[key]} onChange={e=>setFields({...fields,[key]:e.target.value})}/></label>)}
    <label>密钥用途<select value={fields.purpose} onChange={e=>setFields({...fields,purpose:e.target.value})}>{['本人调试','已发布应用API调用','系统集成'].map(s=><option key={s}>{s}</option>)}</select></label>
    <label>调用环境<select value={fields.environment} onChange={e=>setFields({...fields,environment:e.target.value})}>{['开发','测试','生产'].map(s=><option key={s}>{s}</option>)}</select></label>
    <label>预计峰值QPS<input type="number" min="0.01" step="any" value={fields.peakQps} onChange={e=>setFields({...fields,peakQps:e.target.value})}/></label>
    <label>有效期截止时间<input type="datetime-local" value={fields.expiresAt} onChange={e=>setFields({...fields,expiresAt:e.target.value})}/></label>
    {fields.purpose!=='本人调试' && <label>关联发布工单号<input value={fields.publicationTicketNo} onChange={e=>setFields({...fields,publicationTicketNo:e.target.value})}/></label>}
    <button className="primary-button" onClick={submit}>提交密钥创建登记</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
