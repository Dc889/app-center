import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useEffect,useRef,useState} from 'react'
import {PluginOperationPicker} from './PluginOperationPicker'
const labels:Record<string,string>={workspaceId:'目标工作区',operation:'操作',name:'插件名称',version:'批准版本号',sha256:'版本指纹',installationId:'安装实例ID',installedVersion:'原安装版本号',installedSha256:'原安装指纹',access:'权限匹配结果',upgradePolicy:'升级策略'}
export function PluginOperation() {
  const [form,setForm]=useState({resourceId:'',workspaceId:'',installationId:'',operation:'安装',purpose:''})
  const [context,setContext]=useState<Record<string,unknown>|null>(null),[verified,setVerified]=useState(false)
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[pickerKey,setPickerKey]=useState(0)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  function reset(){controller.current?.abort();setContext(null);setBusy(false);setMessage('')}
  const draft=useApplicationDraft('PLG-03',form,value=>{reset();setVerified(false);setForm(value);setPickerKey(key=>key+1)})
  const {ticketNo}=draft
  const gaps=()=>submissionGaps([['插件候选与操作依据',verified && context?form.resourceId:''],['目标Dify workspace ID',form.workspaceId],['使用目的',form.operation!=='安装' || context?.access==='approval'?form.purpose:'无需填写']])
  async function read(value:{resourceId:string;workspaceId:string;installationId:string},valid:boolean) {
    reset();setForm(current=>({...current,...value}));setVerified(valid)
    if(!valid)return
    const request=new AbortController();controller.current=request;setBusy(true)
    try {
      const query=new URLSearchParams({...value,operation:form.operation})
      const response=await fetch('/api/plugin-operation-context?'+query,{signal:request.signal});const data=await response.json()
      if(!response.ok)throw Error(data.error?.message ?? '操作依据读取失败')
      if(data.workspaceId!==value.workspaceId || data.operation!==form.operation || (data.installationId ?? '')!==value.installationId || !['instant','approval'].includes(data.access))throw Error('操作依据与所选实例不匹配')
      if(!request.signal.aborted)setContext(data)
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'操作依据读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true);setMessage('')
    try {
      const {resourceId,workspaceId,...fields}=form
      const response=await draft.submit('/api/applications',{ticketNo,ticketType:'PLG-03',resourceId,workspaceId,fields})
      const data=await response.json();if(!response.ok)throw Error(data.error?.message ?? '操作失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(error){setMessage(error instanceof Error?error.message:'操作失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || draft.controller.busy}><legend>插件安装、升级与卸载</legend>
    <label>操作类型<select aria-label="操作类型" value={form.operation} onChange={event=>{reset();setVerified(false);setForm({...form,operation:event.target.value,resourceId:'',workspaceId:'',installationId:''});setPickerKey(key=>key+1)}}>{['安装','升级','卸载'].map(value=><option key={value}>{value}</option>)}</select></label>
    <PluginOperationPicker key={pickerKey} operation={form.operation} value={form} onChange={read}/>
    <label>使用目的<textarea aria-label="使用目的" value={form.purpose} onChange={event=>setForm({...form,purpose:event.target.value})}/></label>
    <button disabled={!verified} onClick={()=>read(form,verified)}>读取操作依据</button>
    {context && <fieldset><legend>插件操作依据</legend>{Object.entries(context).map(([key,value])=><label key={key}>{labels[key] ?? key}<input aria-label={labels[key] ?? key} readOnly value={key==='access'?(value==='instant'?'免审':'需审批'):String(value ?? '')}/></label>)}</fieldset>}
    <button className="primary-button" onClick={submit}>提交插件操作</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
