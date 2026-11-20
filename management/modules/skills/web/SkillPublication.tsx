import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useState} from 'react'
import {UploadIntake,type Intake} from '../../../platform/packages/public.web'
export function SkillPublication() {
  const [upload,setUpload]=useState<Intake|null>(null)
  const [form,setForm]=useState({resourceId:'',name:'',version:'',description:'',instructions:'',license:'',scope:'全网段公开',targetOrgs:'',targetAccounts:'',tags:''})
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [intakeId,setIntakeId]=useState(''),[restoredReference,setRestoredReference]=useState(''),[restoreKey,setRestoreKey]=useState(0),[uploadBusy,setUploadBusy]=useState(false)
  const draft=useApplicationDraft('SKL-01',{...form,intakeId},({intakeId,...value})=>{setForm(value);setIntakeId(intakeId);setRestoredReference(intakeId);setUpload(null);setRestoreKey(v=>v+1);setMessage('')})
  const {ticketNo}=draft
  const gaps=()=>submissionGaps([['待审文件',upload?.intakeId ?? ''],['Skill唯一标识',form.resourceId],['Skill名称',form.name],['版本号',form.version]])
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    if(!upload)return
    setBusy(true)
    try {
      const {resourceId,...fields}=form
      const list=(value:string)=>value.split(',').map(s=>s.trim()).filter(Boolean)
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'SKL-01',resourceId,fields:{...fields,intakeId:upload.intakeId,targetOrgs:list(form.targetOrgs),
          targetAccounts:list(form.targetAccounts),tags:list(form.tags)}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || uploadBusy || draft.controller.busy}><legend>Skill上架申请</legend>
    <UploadIntake kind="skill" key={restoreKey} initialReference={restoredReference} onReference={setIntakeId} onBusyChange={setUploadBusy} onReady={setUpload}/>
    {(['resourceId','name','version','description','instructions','license','tags'] as const).map((key,i)=><label key={key}>{['Skill唯一标识','Skill名称','版本号','功能说明','使用说明','许可证','目录标签（逗号分隔）'][i]}<input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
    <label>公开方式<select value={form.scope} onChange={e=>setForm({...form,scope:e.target.value})}>{['全网段公开','指定组织','指定人员'].map(s=><option key={s}>{s}</option>)}</select></label>
    {form.scope==='指定组织' && <label>目标组织<input value={form.targetOrgs} onChange={e=>setForm({...form,targetOrgs:e.target.value})}/></label>}
    {form.scope==='指定人员' && <label>目标人员<input value={form.targetAccounts} onChange={e=>setForm({...form,targetAccounts:e.target.value})}/></label>}
    <button className="primary-button" disabled={!upload} onClick={submit}>提交Skill上架审批</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
