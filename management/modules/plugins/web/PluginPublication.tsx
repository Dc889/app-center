import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useState} from 'react'
import {UploadIntake,type Intake} from '../../../platform/packages/public.web'
export function PluginPublication() {
  const [upload,setUpload]=useState<Intake|null>(null)
  const [form,setForm]=useState({description:'',instructions:'',permissions:'',accessMode:'公开免审安装',visibleOrgs:'',installationMethod:'本地包'})
  const [network,setNetwork]=useState<{domain:string;port:string;purpose:string}[]>([])
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [intakeId,setIntakeId]=useState(''),[restoredReference,setRestoredReference]=useState(''),[restoreKey,setRestoreKey]=useState(0),[uploadBusy,setUploadBusy]=useState(false)
  const draft=useApplicationDraft('PLG-01',{...form,network,intakeId},({intakeId,network,...value})=>{setForm(value);setNetwork(network);setIntakeId(intakeId);setRestoredReference(intakeId);setUpload(null);setRestoreKey(v=>v+1);setMessage('')})
  const {ticketNo}=draft
  const gaps=()=>submissionGaps([['待审文件',upload?.intakeId ?? ''],['功能说明',form.description]])
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    if(!upload)return
    setBusy(true)
    try {
      const list=(v:string)=>v.split(',').map(s=>s.trim()).filter(Boolean)
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'PLG-01',resourceId:upload.intakeId,fields:{...form,intakeId:upload.intakeId,permissions:list(form.permissions),
          visibleOrgs:list(form.visibleOrgs),networkAccess:network.map(n=>({...n,port:Number(n.port)}))}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || uploadBusy || draft.controller.busy}><legend>插件上架申请</legend>
    <UploadIntake kind="plugin" key={restoreKey} initialReference={restoredReference} onReference={setIntakeId} onBusyChange={setUploadBusy} onReady={setUpload}/>
    {upload?.packageMetadata && <div><p>插件 · {upload.packageMetadata.name} · {upload.packageMetadata.uniqueIdentifier} · {upload.packageMetadata.version}</p><pre>{JSON.stringify(upload.packageMetadata.dependencies,null,2)}</pre></div>}
    {(['description','instructions','permissions'] as const).map((key,i)=><label key={key}>{['功能说明','使用说明','权限声明（逗号分隔）'][i]}<input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
    <label>公开方式<select value={form.accessMode} onChange={e=>setForm({...form,accessMode:e.target.value})}><option>公开免审安装</option><option>受限安装</option></select></label>
    {form.accessMode==='受限安装' && <label>可见组织<input value={form.visibleOrgs} onChange={e=>setForm({...form,visibleOrgs:e.target.value})}/></label>}
    <label>Dify安装方式<select value={form.installationMethod} onChange={e=>setForm({...form,installationMethod:e.target.value})}>{['本地包','GitHub','市场'].map(s=><option key={s}>{s}</option>)}</select></label>
    <fieldset><legend>外部网络访问清单</legend>
      {network.map((row,index)=><div key={index}>{(['domain','port','purpose'] as const).map((key,i)=><label key={key}>{['域名','端口','用途'][i]}<input value={row[key]} onChange={e=>setNetwork(items=>items.map((n,j)=>j===index?{...n,[key]:e.target.value}:n))}/></label>)}
        <button onClick={()=>setNetwork(items=>items.filter((_,j)=>j!==index))}>删除访问项</button></div>)}
      <button onClick={()=>setNetwork(items=>[...items,{domain:'',port:'443',purpose:''}])}>添加网络访问</button>
    </fieldset>
    <button className="primary-button" disabled={!upload} onClick={submit}>提交插件上架审批</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
