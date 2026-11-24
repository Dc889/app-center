import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useState} from 'react'
import {UploadIntake,type Intake} from '../../../platform/packages/public.web'
import {ChipMultiInput,PERMISSION_PRESETS,PresetInput,useOrgOptions} from '../../../shared-ui/PresetFields'

const PLG_DESC_PRESETS = [
  '提供标准文档格式解析与关键字段抽取能力',
  '对接内部业务系统只读查询接口，辅助智能体研判',
  '提供数据脱敏、格式校验与标准化输出工具',
]
const PLG_INST_PRESETS = [
  '安装至目标工作区后，在 Dify 工作流中添加对应工具节点并配置参数即可使用',
  '无需额外密钥配置，安装后立即可在 Chatflow / Agent 中调用',
]

export function PluginPublication() {
  const orgs = useOrgOptions()
  const [upload,setUpload]=useState<Intake|null>(null)
  const [form,setForm]=useState({description:'',instructions:'',permissions:'读取文本',accessMode:'公开免审安装',visibleOrgs:'',installationMethod:'本地包'})
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
    {upload?.packageMetadata && (
      <div className="app-audit-card is-pass" style={{marginBlock:10}}>
        <div className="app-audit-head">
          <div className="app-audit-title">
            <h4>{upload.packageMetadata.name}</h4>
            <span className="app-mode-chip">{upload.packageMetadata.uniqueIdentifier}</span>
            <span className="app-mode-chip">v{upload.packageMetadata.version}</span>
          </div>
          <span className="app-status-pill tone-success">本地代码安全扫描通过</span>
        </div>
        {Array.isArray(upload.packageMetadata.dependencies) && upload.packageMetadata.dependencies.length > 0 && (
          <p className="app-link-note">Python 依赖：{upload.packageMetadata.dependencies.map((d:{name:string;version:string})=>`${d.name}${d.version}`).join('、')}</p>
        )}
      </div>
    )}
    <PresetInput label="功能说明" value={form.description} onChange={v=>setForm({...form,description:v})} presets={PLG_DESC_PRESETS} />
    <PresetInput label="使用说明" value={form.instructions} onChange={v=>setForm({...form,instructions:v})} presets={PLG_INST_PRESETS} />
    <ChipMultiInput label="权限声明（逗号分隔）" value={form.permissions} onChange={v=>setForm({...form,permissions:v})} options={PERMISSION_PRESETS} />
    <div className="form-row">
      <label>公开方式<select value={form.accessMode} onChange={e=>setForm({...form,accessMode:e.target.value})}><option>公开免审安装</option><option>受限安装</option></select></label>
      <label>Dify安装方式<select value={form.installationMethod} onChange={e=>setForm({...form,installationMethod:e.target.value})}>{['本地包','GitHub','市场'].map(s=><option key={s}>{s}</option>)}</select></label>
    </div>
    {form.accessMode==='受限安装' && <ChipMultiInput label="可见组织" value={form.visibleOrgs} onChange={v=>setForm({...form,visibleOrgs:v})} options={orgs} />}
    <fieldset><legend>外部网络访问清单</legend>
      {network.map((row,index)=><div key={index} className="form-row">
        {(['domain','port','purpose'] as const).map((key,i)=><label key={key}>{['域名','端口','用途'][i]}<input value={row[key]} placeholder={['internal.kpw.local','443','内部业务查询'][i]} onChange={e=>setNetwork(items=>items.map((n,j)=>j===index?{...n,[key]:e.target.value}:n))}/></label>)}
        <button type="button" className="secondary-button" onClick={()=>setNetwork(items=>items.filter((_,j)=>j!==index))}>删除访问项</button>
      </div>)}
      <button type="button" className="secondary-button" onClick={()=>setNetwork(items=>[...items,{domain:'',port:'443',purpose:''}])}>+ 添加网络访问</button>
    </fieldset>
    <div className="app-action-buttons" style={{marginTop:12}}>
      <button className="primary-button" disabled={!upload} onClick={submit}>提交插件上架审批</button>
      <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    </div>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
