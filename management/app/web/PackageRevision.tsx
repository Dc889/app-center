import {ApplicationDrafts} from '../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../shared-ui/form-check'
import {useApplicationDraft} from '../../platform/workflow/public.web'
import {useState} from 'react'
import {UploadIntake,type Intake} from '../../platform/packages/public.web'
export function PackageRevision({kind}:{kind:'skill'|'plugin'}) {
  const ticketType=kind==='skill'?'SKL-02':'PLG-02'
  const [upload,setUpload]=useState<Intake|null>(null)
  const [form,setForm]=useState({resourceId:'',newVersion:'',changeDescription:'',compatibility:'',upgradePolicy:'逐个工单升级'})
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [intakeId,setIntakeId]=useState(''),[restoredReference,setRestoredReference]=useState(''),[restoreKey,setRestoreKey]=useState(0),[uploadBusy,setUploadBusy]=useState(false)
  const draft=useApplicationDraft(ticketType,{...form,intakeId},({intakeId,...value})=>{setForm(value);setIntakeId(intakeId);setRestoredReference(intakeId);setUpload(null);setRestoreKey(v=>v+1);setMessage('')})
  const {ticketNo}=draft
  const gaps=()=>submissionGaps([['待审文件',upload?.intakeId ?? ''],['目录 ID',form.resourceId],['变更说明',form.changeDescription],...kind==='skill'?[['新版本号',form.newVersion] as [string,string]]:[] ])
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    if(!upload)return
    setBusy(true)
    try {
      const {resourceId,...fields}=form
      const r=await draft.submit('/api/applications',{ticketNo,ticketType,resourceId,fields:{...fields,intakeId:upload.intakeId}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || uploadBusy || draft.controller.busy}><legend>{kind==='skill'?'Skill版本变更再审':'插件版本变更再审'}</legend>
    <label>目录 ID<input value={form.resourceId} onChange={e=>setForm({...form,resourceId:e.target.value})}/></label>
    <UploadIntake kind={kind} key={restoreKey} initialReference={restoredReference} onReference={setIntakeId} onBusyChange={setUploadBusy} onReady={setUpload}/>
    {kind==='skill'?<><label>新版本号<input value={form.newVersion} onChange={e=>setForm({...form,newVersion:e.target.value})}/></label>
      <label>兼容性说明<textarea value={form.compatibility} onChange={e=>setForm({...form,compatibility:e.target.value})}/></label></>:
      <><p>新版本 · {upload?.packageMetadata?.version ?? '等待包扫描'}</p><label>升级策略<select value={form.upgradePolicy} onChange={e=>setForm({...form,upgradePolicy:e.target.value})}><option>逐个工单升级</option><option>仅新安装使用新版本</option></select></label></>}
    <label>变更说明<textarea value={form.changeDescription} onChange={e=>setForm({...form,changeDescription:e.target.value})}/></label>
    <button className="primary-button" disabled={!upload} onClick={submit}>提交版本变更再审</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
