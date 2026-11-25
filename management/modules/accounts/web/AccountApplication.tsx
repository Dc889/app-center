import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {FormField} from '../../../shared-ui/UiPrimitives'
import {useEffect,useState} from 'react'

type Person={subjectId:string;account:string;name:string;roles:string[];org:string;businessLine:string;ragflowPermission:string;difyRole:string;workspaceId:string|null;active:boolean}

function defaultEffectiveLocal() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AccountApplication({type}:{type:'ACC-01'|'ACC-02'}) {
  const [people,setPeople]=useState<Person[]>([]),[catalog,setCatalog]=useState({orgs:[] as string[],businessLines:[] as string[]})
  const [subjectId,setSubjectId]=useState(type==='ACC-01'?'__NEW__':'')
  const [operation,setOperation]=useState('开通')
  const [newAcc,setNewAcc]=useState(''),[newName,setNewName]=useState(''),[newEmail,setNewEmail]=useState(''),[newPassword,setNewPassword]=useState('Kpw@2026!')
  const [roles,setRoles]=useState(['user']),[org,setOrg]=useState(''),[businessLine,setBusinessLine]=useState('')
  const [ragflowPermission,setRagflowPermission]=useState('个人'),[difyRole,setDifyRole]=useState('管理员'),[workspaceId,setWorkspaceId]=useState('ws-default')
  const [newAccount,setNewAccount]=useState(''),[effectiveAt,setEffectiveAt]=useState(defaultEffectiveLocal),[expiresAt,setExpiresAt]=useState(''),[reason,setReason]=useState('')
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [directoryReload,setDirectoryReload]=useState(0)

  useEffect(()=>{let active=true;fetch('/api/subjects').then(async r=>{
    if(!r.ok)throw Error('无法读取人员目录')
    const data=await r.json();if(active){
      setPeople(data.items);setCatalog(data.catalog)
      setOrg(prev=>prev || data.catalog?.orgs?.[0] || '')
      setBusinessLine(prev=>prev || data.catalog?.businessLines?.[0] || '')
    }
  }).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[directoryReload])

  const isCreatingNew = type==='ACC-01' && operation==='开通' && subjectId==='__NEW__'
  const person=people.find(p=>p.subjectId===subjectId)

  function select(value:string) {
    setSubjectId(value)
    if(value==='__NEW__') {
      setRoles(['user']);setOrg(catalog.orgs[0] || '');setBusinessLine(catalog.businessLines[0] || '')
      setRagflowPermission('个人');setDifyRole('管理员');setWorkspaceId('ws-default')
      return
    }
    const p=people.find(row=>row.subjectId===value)
    if(p){
      setRoles(p.roles);setOrg(p.org || catalog.orgs[0] || '');setBusinessLine(p.businessLine || catalog.businessLines[0] || '')
      setRagflowPermission(p.ragflowPermission);setDifyRole(operation==='开通' ? '管理员' : (p.difyRole || '管理员'));setWorkspaceId(p.workspaceId ?? 'ws-default')
    }
  }

  function changeOperation(nextOp: string) {
    setOperation(nextOp)
    if(nextOp!=='开通' && subjectId==='__NEW__') setSubjectId('')
    if(nextOp==='开通') {
      setDifyRole('管理员')
      if(!subjectId) setSubjectId('__NEW__')
    }
  }

  const draft=useApplicationDraft(type,{subjectId,operation,roles,org,businessLine,ragflowPermission,difyRole,workspaceId,newAccount,effectiveAt,expiresAt,reason},value=>{setSubjectId(value.subjectId);setOperation(value.operation);setRoles(value.roles);setOrg(value.org);setBusinessLine(value.businessLine);setRagflowPermission(value.ragflowPermission);setDifyRole(value.difyRole);setWorkspaceId(value.workspaceId);setNewAccount(value.newAccount);setEffectiveAt(value.effectiveAt);setExpiresAt(value.expiresAt);setReason(value.reason);setPeople([]);setDirectoryReload(v=>v+1);setMessage('')})
  const {ticketNo}=draft

  const gaps=()=>submissionGaps([
    ...(isCreatingNew ? [['登录账号',newAcc] as [string,string],['真实姓名',newName] as [string,string]] : [['目标人员',person?.subjectId ?? ''] as [string,string]]),
    ['账号生效时间',effectiveAt],
    ['账号申请依据',reason],
    ...type==='ACC-02'?[['新账户名',newAccount] as [string,string]]:[],
  ])

  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    setBusy(true);setMessage('')
    try {
      const fields={reason,effectiveAt:new Date(effectiveAt).toISOString(),...(type==='ACC-02'?{newAccount}:{
        operation,roles,org,businessLine,ragflowPermission,difyRole,workspaceId:workspaceId || 'ws-default',
        expiresAt:expiresAt?new Date(expiresAt).toISOString():null})}
      const payload: Record<string, unknown> = {
        ticketNo,
        ticketType:type,
        subjectId: isCreatingNew ? '' : subjectId,
        fields,
      }
      if(isCreatingNew) {
        payload.newPerson = {
          account: newAcc.trim(),
          name: newName.trim(),
          email: newEmail.trim() || `${newAcc.trim()}@kpw.com`,
          password: newPassword.trim() || 'Kpw@2026!',
        }
      }
      const r=await draft.submit('/api/account-applications',payload)
      const data=await r.json();if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(`${data.ticketNo} · ${data.status}`)
      if(isCreatingNew) {
        setNewAcc('');setNewName('');setNewEmail('');setReason('')
        setDirectoryReload(v=>v+1)
      }
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }

  const permissions=['开通','角色变更'].includes(operation),organization=['开通','组织变更'].includes(operation)
  const canSubmit = (isCreatingNew ? Boolean(newAcc.trim() && newName.trim()) : Boolean(person)) && Boolean(effectiveAt && reason.trim())

  return (
    <fieldset disabled={busy || draft.controller.busy} className="form-section">
      <div className="section-heading">
        <span>02</span>
        <div><h4>{type==='ACC-01'?'账号开通与变更':'账号更名申请'}</h4></div>
      </div>

      <div className="form-row">
        {type==='ACC-01' && (
          <FormField label="账号操作类型" source="用户" required>
            <select aria-label="账号操作类型" value={operation} onChange={e=>changeOperation(e.target.value)}>
              {['开通','停用','组织变更','角色变更'].map(s=><option key={s}>{s}</option>)}
            </select>
          </FormField>
        )}

        <FormField label="目标人员" source="用户" required>
          <select aria-label="目标人员" value={subjectId} onChange={e=>select(e.target.value)}>
            {type==='ACC-01' && operation==='开通' && <option value="__NEW__">+ 新建人员账号</option>}
            <option value="">请选择已有人员</option>
            {people.map(p=><option key={p.subjectId} value={p.subjectId}>{p.name} · {p.account} · {p.active?'已开通':'未开通'}</option>)}
          </select>
        </FormField>
      </div>

      {isCreatingNew && (
        <div className="form-row">
          <FormField label="登录账号" source="用户" required>
            <input aria-label="登录账号" value={newAcc} onChange={e=>{setNewAcc(e.target.value); if(!newEmail) setNewEmail('')}} placeholder="如 zhang.san" />
          </FormField>
          <FormField label="真实姓名" source="用户" required>
            <input aria-label="真实姓名" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="如 张三" />
          </FormField>
          <FormField label="登录邮箱" source="用户">
            <input aria-label="登录邮箱" value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder={newAcc.trim()?`${newAcc.trim()}@kpw.com`:'默认 账号@kpw.com'} />
          </FormField>
          <FormField label="初始密码" source="用户">
            <input aria-label="初始密码" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="默认 Kpw@2026!" />
          </FormField>
        </div>
      )}

      {person && <p style={{fontSize:12,color:'#667085',margin:'4px 0'}}>稳定人员ID · {person.subjectId} · 当前账户名 {person.account}</p>}

      {type==='ACC-02' ? (
        <FormField label="新账户名" source="用户" required>
          <input value={newAccount} onChange={e=>setNewAccount(e.target.value)} placeholder="请输入新账户名" />
        </FormField>
      ) : (
        <>
          <div className="form-row">
            <FormField label="目标组织" source="用户" required={organization}>
              <select aria-label="目标组织" disabled={!organization} value={org} onChange={e=>setOrg(e.target.value)}>
                {catalog.orgs.map(s=><option key={s}>{s}</option>)}
              </select>
            </FormField>
            <FormField label="目标业务线" source="用户" required={organization}>
              <select aria-label="目标业务线" disabled={!organization} value={businessLine} onChange={e=>setBusinessLine(e.target.value)}>
                {catalog.businessLines.map(s=><option key={s}>{s}</option>)}
              </select>
            </FormField>
            <FormField label="Dify目标workspace角色" source="用户">
              <select aria-label="Dify目标workspace角色" disabled={!permissions} value={difyRole} onChange={e=>setDifyRole(e.target.value)}>
                {['管理员','编辑','成员'].map(s=><option key={s}>{s}</option>)}
              </select>
            </FormField>
          </div>

          <div className="form-row">
            <FormField label="RAGFlow目标权限" source="用户">
              <select aria-label="RAGFlow目标权限" disabled={!permissions} value={ragflowPermission} onChange={e=>setRagflowPermission(e.target.value)}>
                {['个人','团队成员','管理员'].map(s=><option key={s}>{s}</option>)}
              </select>
            </FormField>
            <FormField label="账号目标工作区 ID" source="用户">
              <input disabled={!permissions} value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)} placeholder="默认 ws-default" />
            </FormField>
            <FormField label="账号失效时间" source="用户">
              <input type="datetime-local" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)} />
            </FormField>
          </div>

          <fieldset disabled={!permissions} style={{border:'1px solid #e4e7ec',borderRadius:8,padding:'10px 14px',margin:'4px 0'}}>
            <legend style={{fontSize:12,color:'#475467',padding:'0 6px'}}>本平台目标角色</legend>
            <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
              {[['user','用户'],['operator','运维人员'],['admin','系统管理员']].map(([key,label])=>(
                <label key={key} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:13}}>
                  <input type="checkbox" checked={roles.includes(key)} onChange={e=>setRoles(old=>e.target.checked?[...old,key]:old.filter(v=>v!==key))} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}

      <div className="form-row">
        <FormField label="账号生效时间" source="用户" required>
          <input type="datetime-local" value={effectiveAt} onChange={e=>setEffectiveAt(e.target.value)} />
        </FormField>
      </div>

      <FormField label="账号申请依据" source="用户" required>
        <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="请输入开通或变更原因" />
      </FormField>

      <div className="form-actions" style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
        <button className="primary-button" disabled={!canSubmit} onClick={submit}>提交账号审批</button>
        <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
        <ApplicationDrafts draft={draft.controller} />
      </div>
      {message && <p role="status" style={{fontSize:13,margin:'8px 0 0'}}>{message}</p>}
    </fieldset>
  )
}
