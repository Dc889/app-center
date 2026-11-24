import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useState} from 'react'
import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
import {CIDR_PRESETS,ChipMultiInput,PresetInput,QPS_PRESETS,useOrgOptions} from '../../../shared-ui/PresetFields'

const CALLER_PRESETS = ['本地联调客户端', '业务中台微服务', '警务研判门户', '自动化巡检脚本']

function addDaysLocal(days: number): string {
  const d = new Date(Date.now() + days * 86400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function KeyCreation() {
  const orgs = useOrgOptions()
  const [fields,setFields]=useState({resourceId:'',workspaceId:'',purpose:'本人调试',callerName:'',callerOrg:'业务一部',environment:'开发',allowedCidrs:'10.0.0.0/8',peakQps:'5',expiresAt:addDaysLocal(30),publicationTicketNo:''})
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
    <ResourcePicker key={pickerKey} kind="dify_app" hideWorkspace autoLoad value={fields} onChange={(value,verified)=>{setFields(previous=>({...previous,...value}));setSelection(verified?value:null)}}/>
    <div className="form-row">
      <PresetInput label="调用方名称" value={fields.callerName} onChange={v=>setFields({...fields,callerName:v})} presets={CALLER_PRESETS} />
      <PresetInput label="调用方组织" value={fields.callerOrg} onChange={v=>setFields({...fields,callerOrg:v})} presets={orgs} />
    </div>
    <div className="form-row">
      <label>密钥用途<select value={fields.purpose} onChange={e=>setFields({...fields,purpose:e.target.value})}>{['本人调试','已发布应用API调用','系统集成'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>调用环境<select value={fields.environment} onChange={e=>setFields({...fields,environment:e.target.value})}>{['开发','测试','生产'].map(s=><option key={s}>{s}</option>)}</select></label>
    </div>
    <ChipMultiInput label="允许来源CIDR（逗号分隔）" value={fields.allowedCidrs} onChange={v=>setFields({...fields,allowedCidrs:v})} options={CIDR_PRESETS} />
    <div className="form-row">
      <div className="preset-chip-field">
        <label>预计峰值QPS<input type="number" min="0.01" step="any" value={fields.peakQps} onChange={e=>setFields({...fields,peakQps:e.target.value})}/></label>
        <div className="preset-chip-row">
          {QPS_PRESETS.map(q=><button key={q} type="button" className={`preset-chip ${fields.peakQps===q?'is-active':''}`} onClick={()=>setFields({...fields,peakQps:q})}>{q} QPS</button>)}
        </div>
      </div>
      <div className="preset-chip-field">
        <label>有效期截止时间<input type="datetime-local" value={fields.expiresAt} onChange={e=>setFields({...fields,expiresAt:e.target.value})}/></label>
        <div className="preset-chip-row">
          {[7,30,90].map(days=><button key={days} type="button" className="preset-chip" onClick={()=>setFields({...fields,expiresAt:addDaysLocal(days)})}>+{days} 天</button>)}
        </div>
      </div>
    </div>
    {fields.purpose!=='本人调试' && <label>关联发布工单号<input value={fields.publicationTicketNo} placeholder="填写对应的 AG-02 发布工单号" onChange={e=>setFields({...fields,publicationTicketNo:e.target.value})}/></label>}
    <div className="app-action-buttons" style={{marginTop:12}}>
      <button className="primary-button" onClick={submit}>提交密钥创建登记</button>
      <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    </div>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
