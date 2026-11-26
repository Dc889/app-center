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
  const [mode,setMode]=useState<'direct'|'registry'>('direct')
  const [form,setForm]=useState({resourceId:'',endpointUrl:'',transport:'streamable-http',authType:'none',name:'',purpose:'',boundaryOrgs:'刑侦一支队',classification:'内部',businessLine:'刑侦'})
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [verifiedId,setVerifiedId]=useState('')
  const [pickerKey,setPickerKey]=useState(0)
  const draft=useApplicationDraft('MCP-01',form,value=>{setForm(previous=>({...previous,...value}));if(value.endpointUrl)setMode('direct');setVerifiedId('');setPickerKey(key=>key+1);setMessage('')})
  const {ticketNo}=draft
  const gaps=()=>submissionGaps([
    mode==='direct'
      ? ['MCP 服务地址',/^https?:\/\/[^\s]+$/i.test(form.endpointUrl.trim())?form.endpointUrl.trim():'']
      : ['技术注册 ID',verifiedId===form.resourceId?form.resourceId:''],
    ['MCP名称',form.name],
    ['MCP用途',form.purpose],
  ])

  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true)
    setMessage(mode==='direct' ? '正在执行 MCP 连通性与工具清单协议探测...' : '')
    try {
      const {resourceId,...fields}=form
      const payloadResourceId = mode==='direct' ? ('direct-' + Date.now()) : resourceId
      const payloadFields = {
        name: fields.name,
        purpose: fields.purpose,
        classification: fields.classification,
        businessLine: fields.businessLine,
        boundaryOrgs: form.boundaryOrgs.split(',').map(s=>s.trim()).filter(Boolean),
        ...(mode==='direct' ? {endpointUrl: fields.endpointUrl.trim(), transport: fields.transport, authType: fields.authType} : {}),
      }
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'MCP-01',resourceId:payloadResourceId,fields:payloadFields})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }

  return <fieldset className="form-section" disabled={busy || draft.controller.busy}><legend>MCP上架登记</legend>
    <div style={{display:'flex',gap:8,marginBottom:12}}>
      <button type="button" className={mode==='direct'?'primary-button':'secondary-button'} onClick={()=>{setMode('direct');setMessage('')}}>直接填写服务地址（推荐）</button>
      <button type="button" className={mode==='registry'?'primary-button':'secondary-button'} onClick={()=>{setMode('registry');setMessage('')}}>从已有技术注册选择</button>
    </div>
    {mode==='direct' ? (
      <>
        <div className="form-row">
          <label>MCP 服务地址 (Endpoint URL)<input value={form.endpointUrl} placeholder="例如：http://192.168.0.7:4390/mcp" onChange={e=>setForm({...form,endpointUrl:e.target.value})}/></label>
          <label>传输协议<select value={form.transport} onChange={e=>setForm({...form,transport:e.target.value})}>
            <option value="streamable-http">Streamable HTTP</option>
            <option value="sse">SSE</option>
          </select></label>
        </div>
        <div className="form-row">
          <label>鉴权方式<select value={form.authType} onChange={e=>setForm({...form,authType:e.target.value})}>
            <option value="none">无鉴权（内网直连）</option>
            <option value="bearer">Bearer Token</option>
            <option value="api_key">API Key Header</option>
          </select></label>
          <div style={{display:'flex',alignItems:'flex-end',fontSize:12,color:'#64748b',paddingBottom:6}}>提交时将自动执行 JSON-RPC initialize 与 tools/list 协议探测</div>
        </div>
      </>
    ) : (
      <ResourcePicker key={pickerKey} kind="mcp_registration" hideWorkspace autoLoad value={{resourceId:form.resourceId,workspaceId:''}} onChange={(value,verified)=>{setForm(previous=>({...previous,resourceId:value.resourceId}));setVerifiedId(verified?value.resourceId:'')}}/>
    )}
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
