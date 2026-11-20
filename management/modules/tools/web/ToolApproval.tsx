import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useEffect,useRef,useState} from 'react'
import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
export function ToolApproval() {
  const [form,setForm]=useState({resourceId:'',workspaceId:'',operation:'首次批准',description:'',purpose:'',permissions:'',targetOrgs:'',classification:'内部',businessLine:''})
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [context,setContext]=useState<Record<string,unknown>|null>(null)
  const [pickerKey,setPickerKey]=useState(0)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  function reset(){controller.current?.abort();setContext(null);setBusy(false);setMessage('')}
  const draft=useApplicationDraft('TOL-01',form,value=>{reset();setForm(value);setPickerKey(key=>key+1)})
  const {ticketNo}=draft
  const gaps=()=>submissionGaps([['工具候选与配置核验',context?form.resourceId:''],['功能说明',form.description],['业务用途',form.purpose],['权限需求',form.permissions],['目标组织',form.targetOrgs],['业务线',form.businessLine]])
  async function select(value:{resourceId:string;workspaceId:string},verified:boolean) {
    reset();setForm(current=>({...current,...value}))
    if(!verified)return
    const request=new AbortController();controller.current=request;setBusy(true)
    try {
      const query=new URLSearchParams({ticketType:'TOL-01',action:'set_tool_approval',operation:form.operation,...value})
      const response=await fetch('/api/execution-contexts?'+query,{signal:request.signal});const data=await response.json()
      if(!response.ok)throw Error(data.error?.message ?? '工具配置读取失败')
      if(data.resourceId!==value.resourceId || data.operation!==form.operation || data.eligible!==true || data.fields?.['Dify workspace ID']!==value.workspaceId)throw Error('工具配置与所选对象不匹配')
      if(!request.signal.aborted)setContext(data.fields)
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'工具配置读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true)
    try {
      const {resourceId,workspaceId,...fields}=form
      const list=(value:string)=>value.split(',').map(s=>s.trim()).filter(Boolean)
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'TOL-01',resourceId,workspaceId,fields:{...fields,permissions:list(form.permissions),targetOrgs:list(form.targetOrgs)}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || draft.controller.busy}><legend>工具对外使用审批</legend>
    <label>操作类型<select aria-label="操作类型" value={form.operation} onChange={e=>{reset();setForm({...form,operation:e.target.value,resourceId:'',workspaceId:''});setPickerKey(key=>key+1)}}>{['首次批准','变更再审','撤销批准'].map(s=><option key={s}>{s}</option>)}</select></label>
    <ResourcePicker key={pickerKey} kind="tool" candidateOperation={form.operation} resourceLabel="工具候选 ID" value={form} onChange={select}/>
    {form.operation==='撤销批准' && <label>来源工作区<input readOnly value={form.workspaceId}/></label>}
    {context && <fieldset><legend>工具配置核验</legend>{Object.entries(context).map(([key,value])=><label key={key}>{key}<textarea aria-label={key} readOnly value={typeof value==='string'?value:JSON.stringify(value,null,2)}/></label>)}</fieldset>}
    {(['description','purpose','permissions','targetOrgs','businessLine'] as const).map((key,i)=><label key={key}>{['功能说明','业务用途','权限需求（逗号分隔）','目标组织（逗号分隔）','业务线'][i]}<input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
    <label>密级<select value={form.classification} onChange={e=>setForm({...form,classification:e.target.value})}>{['公开','内部','敏感','机密'].map(s=><option key={s}>{s}</option>)}</select></label>
    <button className="primary-button" onClick={submit}>提交工具审批</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
