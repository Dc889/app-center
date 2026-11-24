import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useState} from 'react'
import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
import {BUSINESS_LINE_PRESETS,ChipMultiInput,PresetInput,useOrgOptions} from '../../../shared-ui/PresetFields'

const MCP_PURPOSE_PRESETS = [
  '提供统一标准时间、工作日历与案件时区校准服务',
  '提供平台规范与制度文档只读检索工具',
  '对接内部只读数据查询服务，支持智能体结构化取数',
]

export function McpRegistration() {
  const orgs = useOrgOptions()
  const [form,setForm]=useState({resourceId:'',name:'',purpose:'',boundaryOrgs:'业务一部',classification:'内部',businessLine:'刑侦'})
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
    <ResourcePicker key={pickerKey} kind="mcp_registration" hideWorkspace autoLoad value={{resourceId:form.resourceId,workspaceId:''}} onChange={(value,verified)=>{setForm(previous=>({...previous,resourceId:value.resourceId}));setVerifiedId(verified?value.resourceId:'')}}/>
    <div className="form-row">
      <label>MCP名称<input value={form.name} placeholder="请输入面向用户的 MCP 展示名称" onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>密级<select value={form.classification} onChange={e=>setForm({...form,classification:e.target.value})}>{['公开','内部','敏感','机密'].map(s=><option key={s}>{s}</option>)}</select></label>
    </div>
    <PresetInput label="MCP用途" value={form.purpose} onChange={v=>setForm({...form,purpose:v})} presets={MCP_PURPOSE_PRESETS} />
    <PresetInput label="业务线" value={form.businessLine} onChange={v=>setForm({...form,businessLine:v})} presets={BUSINESS_LINE_PRESETS} />
    <ChipMultiInput label="组织边界（逗号分隔）" value={form.boundaryOrgs} onChange={v=>setForm({...form,boundaryOrgs:v})} options={orgs} />
    <div className="app-action-buttons" style={{marginTop:12}}>
      <button className="primary-button" onClick={submit}>提交MCP登记审批</button>
      <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    </div>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
