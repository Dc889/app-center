import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useEffect,useRef,useState} from 'react'
import {KeyRegistrationPicker} from './KeyRegistrationPicker'
export function KeyLifecycle() {
  const [fields,setFields]=useState({resourceId:'',operation:'撤销',reason:'',effectiveAt:'',newExpiresAt:''})
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [context,setContext]=useState<Record<string,string>|null>(null)
  const [pickerKey,setPickerKey]=useState(0)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>{controller.current?.abort()},[])
  const draft=useApplicationDraft('KEY-02',fields,value=>{controller.current?.abort();setFields(value);setContext(null);setPickerKey(key=>key+1);setMessage('')})
  const {ticketNo}=draft
  const action=fields.operation==='轮换'?'rotate_key':fields.operation==='撤销'?'revoke_key':undefined
  const gaps=()=>submissionGaps([['密钥登记 ID',context?fields.resourceId:''],['操作原因',fields.reason],['生效时间',fields.effectiveAt],...fields.operation==='轮换'?[['新有效期截止时间',fields.newExpiresAt]] as [string,string][]:[]])
  async function read(resourceId:string) {
    if(!action)return
    controller.current?.abort();const request=new AbortController();controller.current=request
    setBusy(true);setContext(null);setMessage('')
    try {
      const response=await fetch('/api/execution-contexts?'+new URLSearchParams({ticketType:'KEY-02',action,resourceId}),{signal:request.signal})
      const data=await response.json(),f=data.fields
      if(!response.ok)throw Error(data.error?.message ?? '密钥操作依据读取失败')
      if(data.ticketType!=='KEY-02' || data.action!==action || data.resourceId!==resourceId || !f || f['密钥登记ID']!==resourceId ||
        !['Dify workspace ID','Dify应用ID','Dify密钥ID','密钥后四位'].every(key=>typeof f[key]==='string' && f[key]) || f['密钥后四位'].length!==4)throw Error('密钥操作依据与所选登记不匹配')
      if(!request.signal.aborted)setContext(Object.fromEntries(['密钥登记ID','Dify workspace ID','Dify应用ID','Dify密钥ID','密钥后四位'].map(key=>[key,f[key]])))
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'密钥操作依据读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true)
    try {
      const {resourceId,...business}=fields
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'KEY-02',resourceId,fields:{...business,effectiveAt:fields.effectiveAt?new Date(fields.effectiveAt).toISOString():'',
          newExpiresAt:fields.operation==='轮换' && fields.newExpiresAt?new Date(fields.newExpiresAt).toISOString():null}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || draft.controller.busy}><legend>Dify API密钥轮换与撤销</legend>
    <label>操作类型<select aria-label="操作类型" value={fields.operation} onChange={e=>{controller.current?.abort();setFields({...fields,operation:e.target.value,resourceId:'',newExpiresAt:''});setContext(null);setPickerKey(key=>key+1);setMessage('')}}><option>撤销</option><option>轮换</option></select></label>
    <KeyRegistrationPicker key={pickerKey} action={action} value={fields.resourceId} onChange={(resourceId,verified)=>{controller.current?.abort();setFields(current=>({...current,resourceId}));setContext(null);setMessage('');if(verified)void read(resourceId)}}/>
    {context && <div>{['Dify workspace ID','Dify应用ID','Dify密钥ID','密钥后四位'].map(key=><label key={key}>{key}<input aria-label={key} readOnly value={context[key]}/></label>)}</div>}
    <label>操作原因<textarea value={fields.reason} onChange={e=>setFields({...fields,reason:e.target.value})}/></label>
    <label>生效时间<input type="datetime-local" value={fields.effectiveAt} onChange={e=>setFields({...fields,effectiveAt:e.target.value})}/></label>
    {fields.operation==='轮换' && <label>新有效期截止时间<input type="datetime-local" value={fields.newExpiresAt} onChange={e=>setFields({...fields,newExpiresAt:e.target.value})}/></label>}
    <button className="primary-button" onClick={submit}>提交密钥审批</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
