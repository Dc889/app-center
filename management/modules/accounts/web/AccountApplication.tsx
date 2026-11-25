import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useEffect,useState} from 'react'
type Person={subjectId:string;account:string;name:string;roles:string[];org:string;businessLine:string;ragflowPermission:string;difyRole:string;workspaceId:string|null;active:boolean}
export function AccountApplication({type}:{type:'ACC-01'|'ACC-02'}) {
  const [people,setPeople]=useState<Person[]>([]),[catalog,setCatalog]=useState({orgs:[] as string[],businessLines:[] as string[]})
  const [subjectId,setSubjectId]=useState(''),[operation,setOperation]=useState('开通')
  const [roles,setRoles]=useState(['user']),[org,setOrg]=useState(''),[businessLine,setBusinessLine]=useState('')
  const [ragflowPermission,setRagflowPermission]=useState('个人'),[difyRole,setDifyRole]=useState('管理员'),[workspaceId,setWorkspaceId]=useState('')
  const [newAccount,setNewAccount]=useState(''),[effectiveAt,setEffectiveAt]=useState(''),[expiresAt,setExpiresAt]=useState(''),[reason,setReason]=useState('')
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [directoryReload,setDirectoryReload]=useState(0)
  useEffect(()=>{let active=true;fetch('/api/subjects').then(async r=>{
    if(!r.ok)throw Error('无法读取人员目录')
    const data=await r.json();if(active){setPeople(data.items);setCatalog(data.catalog)}
  }).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[directoryReload])
  const person=people.find(p=>p.subjectId===subjectId)
  function select(value:string) {
    setSubjectId(value);const p=people.find(row=>row.subjectId===value)
    if(p){setRoles(p.roles);setOrg(p.org || catalog.orgs[0] || '');setBusinessLine(p.businessLine || catalog.businessLines[0] || '');setRagflowPermission(p.ragflowPermission);setDifyRole(operation==='开通' ? '管理员' : (p.difyRole || '管理员'));setWorkspaceId(p.workspaceId ?? '')}
  }
  const draft=useApplicationDraft(type,{subjectId,operation,roles,org,businessLine,ragflowPermission,difyRole,workspaceId,newAccount,effectiveAt,expiresAt,reason},value=>{setSubjectId(value.subjectId);setOperation(value.operation);setRoles(value.roles);setOrg(value.org);setBusinessLine(value.businessLine);setRagflowPermission(value.ragflowPermission);setDifyRole(value.difyRole);setWorkspaceId(value.workspaceId);setNewAccount(value.newAccount);setEffectiveAt(value.effectiveAt);setExpiresAt(value.expiresAt);setReason(value.reason);setPeople([]);setDirectoryReload(v=>v+1);setMessage('')})
  const {ticketNo}=draft
  const gaps=()=>submissionGaps([['目标人员',person?.subjectId ?? ''],['账号生效时间',effectiveAt],['账号申请依据',reason],...type==='ACC-02'?[['新账户名',newAccount] as [string,string]]:[] ])
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true);setMessage('')
    try {
      const fields={reason,effectiveAt:new Date(effectiveAt).toISOString(),...(type==='ACC-02'?{newAccount}:{
        operation,roles,org,businessLine,ragflowPermission,difyRole,workspaceId:workspaceId || null,
        expiresAt:expiresAt?new Date(expiresAt).toISOString():null})}
      const r=await draft.submit('/api/account-applications',{ticketNo,ticketType:type,subjectId,fields})
      const data=await r.json();if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  const permissions=['开通','角色变更'].includes(operation),organization=['开通','组织变更'].includes(operation)
  return <fieldset disabled={busy || draft.controller.busy} className="form-section"><legend>{type==='ACC-01'?'账号开通与变更':'账号更名申请'}</legend>
    <label>目标人员<select aria-label="目标人员" value={subjectId} onChange={e=>select(e.target.value)}><option value="">请选择人员</option>{people.map(p=><option key={p.subjectId} value={p.subjectId}>{p.name} · {p.account} · {p.active?'已开通':'未开通'}</option>)}</select></label>
    {person && <p>稳定人员ID · {person.subjectId} · 当前账户名 {person.account}</p>}
    {type==='ACC-02'?<label>新账户名<input value={newAccount} onChange={e=>setNewAccount(e.target.value)}/></label>:<>
      <label>账号操作类型<select aria-label="账号操作类型" value={operation} onChange={e=>setOperation(e.target.value)}>{['开通','停用','组织变更','角色变更'].map(s=><option key={s}>{s}</option>)}</select></label>
      <fieldset disabled={!permissions}><legend>本平台目标角色</legend>{[['user','用户'],['operator','运维人员'],['admin','系统管理员']].map(([key,label])=><label key={key}><input type="checkbox" checked={roles.includes(key)} onChange={e=>setRoles(old=>e.target.checked?[...old,key]:old.filter(v=>v!==key))}/>{label}</label>)}</fieldset>
      <label>RAGFlow目标权限<select aria-label="RAGFlow目标权限" disabled={!permissions} value={ragflowPermission} onChange={e=>setRagflowPermission(e.target.value)}>{['个人','团队成员','管理员'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Dify目标workspace角色<select aria-label="Dify目标workspace角色" disabled={!permissions} value={difyRole} onChange={e=>setDifyRole(e.target.value)}>{['成员','编辑','管理员'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>账号目标工作区 ID<input disabled={!permissions} value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}/></label>
      <label>目标组织<select aria-label="目标组织" disabled={!organization} value={org} onChange={e=>setOrg(e.target.value)}>{catalog.orgs.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>目标业务线<select aria-label="目标业务线" disabled={!organization} value={businessLine} onChange={e=>setBusinessLine(e.target.value)}>{catalog.businessLines.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>账号失效时间<input type="datetime-local" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)}/></label>
    </>}
    <label>账号生效时间<input type="datetime-local" value={effectiveAt} onChange={e=>setEffectiveAt(e.target.value)}/></label>
    <label>账号申请依据<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button disabled={!person || !effectiveAt || !reason.trim()} onClick={submit}>提交账号审批</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button><ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
