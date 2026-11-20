import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useEffect,useRef,useState} from 'react'
import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
const actions={'单用户解绑':'unbind_mcp','目录隔离':'isolate_mcp','目录下架':'withdraw_mcp'} as const
type Binding={account:string;workspaceId:string}
export function McpDisposition({account}:{account:string}) {
  const [fields,setFields]=useState({resourceId:'',workspaceId:'',operation:'单用户解绑',targetAccount:account,reason:'主动解绑',facts:''})
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [bindings,setBindings]=useState<Binding[]>([])
  const [snapshotId,setSnapshotId]=useState('')
  const [pair,setPair]=useState('')
  const [pickerKey,setPickerKey]=useState(0)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>{controller.current?.abort()},[])
  function reset(){controller.current?.abort();setBindings([]);setSnapshotId('');setPair('');setMessage('')}
  const draft=useApplicationDraft('MCP-03',fields,value=>{setFields(value);reset();setPickerKey(key=>key+1)})
  const {ticketNo}=draft
  const action=actions[fields.operation as keyof typeof actions]
  const gaps=()=>submissionGaps([['MCP目录 ID',snapshotId?fields.resourceId:''],['事实说明',fields.facts],
    ...fields.operation==='单用户解绑'?[['目标绑定',pair]] as [string,string][]:[]])
  async function read(resourceId:string) {
    reset();setBusy(true)
    const request=new AbortController();controller.current=request
    try {
      const response=await fetch('/api/execution-contexts?'+new URLSearchParams({ticketType:'MCP-03',action,resourceId}),{signal:request.signal})
      const data=await response.json(),f=data.fields,rows=f?.['绑定清单']
      if(!response.ok)throw Error(data.error?.message ?? '处置绑定读取失败')
      if(data.ticketType!=='MCP-03' || data.action!==action || data.resourceId!==resourceId || typeof data.snapshotId!=='string' || !data.snapshotId ||
        !Array.isArray(rows) || !rows.every((b:Binding)=>b && typeof b.account==='string' && b.account && typeof b.workspaceId==='string' && b.workspaceId) ||
        fields.operation!=='单用户解绑' && f['绑定清单完整']!==true)throw Error('处置依据与当前动作或绑定范围不匹配')
      if(!request.signal.aborted){setBindings(rows.map(({account,workspaceId}:Binding)=>({account,workspaceId})));setSnapshotId(data.snapshotId)}
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'处置绑定读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true)
    try {
      const {resourceId,workspaceId,...business}=fields
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'MCP-03',resourceId,workspaceId,fields:business})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || draft.controller.busy}><legend>MCP解绑与隔离申请</legend>
    <label>处置类型<select aria-label="处置类型" value={fields.operation} onChange={e=>{reset();setPickerKey(key=>key+1);setFields(current=>({...current,operation:e.target.value,resourceId:'',workspaceId:'',targetAccount:''}))}}>{['单用户解绑','目录隔离','目录下架'].map(s=><option key={s}>{s}</option>)}</select></label>
    <ResourcePicker key={pickerKey} kind="mcp" catalogAction={action} value={fields} onChange={(value,verified)=>{reset();setFields(current=>({...current,resourceId:value.resourceId,workspaceId:'',targetAccount:''}));if(verified)void read(value.resourceId)}}/>
    {fields.operation==='单用户解绑' && <><label>目标绑定<select aria-label="目标绑定" value={pair} onChange={e=>{const selected=bindings.find(b=>JSON.stringify([b.account,b.workspaceId])===e.target.value);setPair(selected?e.target.value:'');setFields(current=>({...current,targetAccount:selected?.account ?? '',workspaceId:selected?.workspaceId ?? ''}))}}><option value="">请选择账户与工作区</option>{bindings.map(b=><option key={JSON.stringify([b.account,b.workspaceId])} value={JSON.stringify([b.account,b.workspaceId])}>{b.account} · {b.workspaceId}</option>)}</select></label>
      <label>目标账户名<input aria-label="目标账户名" readOnly value={fields.targetAccount}/></label><label>目标workspace ID<input aria-label="目标workspace ID" readOnly value={fields.workspaceId}/></label></>}
    {snapshotId && <div><p>处置依据 · {snapshotId} · {bindings.length}组账户/工作区</p>{fields.operation!=='单用户解绑' && bindings.map(b=><p key={JSON.stringify([b.account,b.workspaceId])}>{b.account} · {b.workspaceId}</p>)}</div>}
    <label>处置原因<select value={fields.reason} onChange={e=>setFields({...fields,reason:e.target.value})}>{['主动解绑','授权到期','异常调用','安全问题','其他'].map(s=><option key={s}>{s}</option>)}</select></label>
    <label>事实说明<textarea value={fields.facts} onChange={e=>setFields({...fields,facts:e.target.value})}/></label>
    <button className="primary-button" onClick={submit}>提交MCP处置审批</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
