import {body,check,json,id,same} from '../../../../runtime/http.mjs'
import {platformRoles} from '../../../platform/identity/public.server.mjs'
import {recoveryBaseline,verifiedRestoration} from './account-recovery.mjs'
import {readExecution} from '../../../../runtime/execution-state.mjs'
const text=v=>typeof v==='string' && v.trim() && v.length<=4000
const accountName=v=>typeof v==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(v)
const actions={'ACC-01':'apply_account_change','ACC-02':'rename_account'}
export function accountWorkflows({directory,cap,types,headersFor,catalog,now=Date.now}) {
  const store=directory.store,busy=new Set()
  let closed=false
  const rows=()=>store.all().filter(r=>r.kind==='account-ticket')
  const get=no=>store.get('ticket:'+no)
  const put=row=>store.put('ticket:'+row.ticketNo,row)
  const at=()=>new Date(now()).toISOString()
  function currentAdmin(identity) {
    const p=directory.get(identity.subjectId)
    check(directory.isActive(p) && p.revision===identity.profileRevision && p.roles.includes('admin'),403,'ADMIN_SESSION_CHANGED')
  }
  function unique(name,subjectId) {
    check(!directory.subjects().some(p=>p.subjectId!==subjectId && [p.account,...p.aliases].some(v=>v.toLowerCase()===name.toLowerCase())) &&
      !rows().some(r=>r.subjectId!==subjectId && r.reservedName?.toLowerCase()===name.toLowerCase() && !['已撤回','已驳回'].includes(r.status)),409,'ACCOUNT_NAME_CONFLICT')
  }
  async function context(type,profile,fields,actor) {
    const params=new URLSearchParams({action:actions[type],resourceId:profile.subjectId})
    if(fields.workspaceId)params.set('workspaceId',fields.workspaceId)
    if(type==='ACC-02')params.set('newAccount',fields.newAccount)
    const raw=await(await cap('/execution-contexts/'+type+'?'+params,'GET',undefined,
      headersFor({command:{account:actor.account,org:actor.org,actorRole:'admin'}},true))).json()
    const f=raw.fields
    check(raw.ticketType===type && raw.action===actions[type] && raw.resourceId===profile.subjectId && text(raw.snapshotId) &&
      f && f['目标人员ID']===profile.subjectId && f['当前账户名']===profile.account &&
      ['RAGFlow唯一性校验','Dify唯一性校验'].every(k=>f[k]==='通过') &&
      ['RAGFlow账户ID','Dify账户ID'].every(k=>f[k]===null || text(f[k])) &&
      (type==='ACC-01' && fields.operation==='开通' || ['个人','团队成员','管理员'].includes(f['当前RAGFlow权限']) && ['成员','编辑','管理员'].includes(f['当前Dify workspace角色'])) &&
      (f['Dify workspace ID']===null || text(f['Dify workspace ID'])) &&
      (type==='ACC-01' && fields.operation==='开通' || text(f['RAGFlow账户ID']) && text(f['Dify账户ID'])) &&
      Array.isArray(raw.preconditions) && raw.preconditions.some(p=>p.kind==='product_account_mapping' && p.id===profile.subjectId && Number.isInteger(p.revision)),409,'INCOMPLETE_ACCOUNT_CONTEXT')
    if(type==='ACC-02')check(f['待校验新账户名']===fields.newAccount,409,'ACCOUNT_CONTEXT_MISMATCH')
    if(fields.workspaceId)check(f['Dify workspace ID']===fields.workspaceId,409,'WORKSPACE_MISMATCH')
    return {snapshotId:raw.snapshotId,resourceId:raw.resourceId,recoveryBaseline:recoveryBaseline(raw.recoveryBaseline,f),fields:Object.fromEntries([
      '目标人员ID','当前账户名','RAGFlow账户ID','Dify账户ID','Dify workspace ID','当前RAGFlow权限','当前Dify workspace角色','RAGFlow唯一性校验','Dify唯一性校验',
      ...(type==='ACC-02'?['待校验新账户名']:[])].map(k=>[k,f[k] ?? null])),preconditions:[...raw.preconditions,
        {kind:'identity_mapping',id:profile.subjectId,revision:profile.revision}]}
  }
  function target(profile,type,fields) {
    check(fields && text(fields.reason) && typeof fields.effectiveAt==='string' && Number.isFinite(Date.parse(fields.effectiveAt)),400,'INVALID_ACCOUNT_FIELDS')
    if(type==='ACC-02') {
      check(accountName(fields.newAccount) && fields.newAccount!==profile.account,400,'INVALID_NEW_ACCOUNT')
      unique(fields.newAccount,profile.subjectId)
      return {account:fields.newAccount,roles:profile.roles,org:profile.org,businessLine:profile.businessLine,
        active:profile.active,ragflowPermission:profile.ragflowPermission,difyRole:profile.difyRole,expiresAt:profile.expiresAt ?? null}
    }
    check(['开通','停用','组织变更','角色变更'].includes(fields.operation),400,'INVALID_ACCOUNT_OPERATION')
    const permissionChange=['开通','角色变更'].includes(fields.operation),orgChange=['开通','组织变更'].includes(fields.operation)
    const roles=permissionChange?fields.roles:profile.roles
    check(Array.isArray(roles) && roles.length && new Set(roles).size===roles.length && roles.every(r=>platformRoles.includes(r)) &&
      (!permissionChange || ['个人','团队成员','管理员'].includes(fields.ragflowPermission) && ['成员','编辑','管理员'].includes(fields.difyRole)),400,'INVALID_TARGET_ROLES')
    const org=orgChange?fields.org:profile.org,businessLine=orgChange?fields.businessLine:profile.businessLine
    check(catalog.orgs.includes(org) && catalog.businessLines.includes(businessLine),400,'UNKNOWN_ORGANIZATION')
    check(!fields.expiresAt || typeof fields.expiresAt==='string' && Date.parse(fields.expiresAt)>Math.max(now(),Date.parse(fields.effectiveAt)),400,'INVALID_ACCOUNT_EXPIRY')
    check(fields.operation!=='开通' || !profile.active,409,'ACCOUNT_ALREADY_ACTIVE')
    if(permissionChange)check(text(fields.workspaceId),400,'WORKSPACE_REQUIRED')
    return {account:profile.account,roles,org,businessLine,active:fields.operation==='开通'?true:fields.operation==='停用'?false:profile.active,
      ragflowPermission:permissionChange?fields.ragflowPermission:profile.ragflowPermission,
      difyRole:permissionChange?fields.difyRole:profile.difyRole,expiresAt:fields.expiresAt===undefined?(profile.expiresAt ?? null):fields.expiresAt}
  }
  function keepAdmin(profile,value) {
    if(profile.active && profile.roles.includes('admin') && (!value.active || !value.roles.includes('admin') || value.expiresAt))
      check(directory.subjects().some(p=>p.subjectId!==profile.subjectId && directory.isActive(p) && p.roles.includes('admin') && !p.pendingChange),409,'LAST_ADMIN_REQUIRED')
  }
  async function deliver(row,{queryOnly=false}={}) {
    if(closed || busy.has(row.ticketNo) || Date.parse(row.submission.fields.effectiveAt)>now())return
    busy.add(row.ticketNo)
    let observed=false
    try {
      let response
      try {response=await cap('/executions/'+row.command.executionId)}
      catch(error){if(error.status!==404 || queryOnly || row.executionKnown || row.execution || row.localCommit)throw error;
        const approver=directory.byAccount(row.command.account)
        check(directory.isActive(approver) && approver.roles.includes('admin') && (!approver.pendingChange || approver.pendingChange.ticketNo===row.ticketNo),403,'APPROVER_UNAVAILABLE')
        response=await cap('/executions','POST',row.command)}
      observed=true
      const execution=await readExecution(response,row.command,{previous:row.execution})
      if(closed)return
      const latest=get(row.ticketNo)
      if(latest.command.executionId!==row.command.executionId || latest.execution?.result)return
      check(execution.status!=='succeeded' || latest.localCommit?.executionId===row.command.executionId,409,'LOCAL_COMMIT_REQUIRED')
      put({...latest,execution,executionKnown:true,status:execution.status==='succeeded'?'待结果确认':execution.status==='failed'?'执行失败':execution.status==='cancelled'?'已终止':'执行中',
        revision:latest.revision+1,lastError:null,deliveryBlocked:false,attempts:latest.attempts.map(a=>a.command.executionId===row.command.executionId?{...a,execution}:a),
        history:[...latest.history,{at:at(),actor:'system',action:'执行状态 '+execution.status}]})
    }catch(error){if(!closed){const latest=get(row.ticketNo);put({...latest,executionKnown:latest.executionKnown || observed,lastError:{code:error.code ?? 'NETWORK_ERROR'},deliveryBlocked:!!error.status && error.status<500})}}
    finally{busy.delete(row.ticketNo)}
  }
  const timer=setInterval(()=>{for(const row of rows())if(row.command && !row.execution?.result && !row.deliveryBlocked && row.status==='执行中')void deliver(row)},2000)
  timer.unref()
  async function handle(req,res,path,identity) {
    check(identity?.active && identity.roles.includes('admin'),403,'ACCESS_DENIED')
    if(req.method==='GET') {
      const view=new URL(req.url,'http://localhost').searchParams.get('view')
      check(['mine','todo','query'].includes(view),400,'INVALID_VIEW')
      return json(res,{items:rows().filter(r=>view==='mine'?r.applicantSubjectId===identity.subjectId:view==='todo'?['待受理','执行失败','待结果确认'].includes(r.status) || r.deliveryBlocked:true).reverse()
        .map(row=>({...row,canCancel:row.status==='执行中' && !row.execution && Date.parse(row.submission.fields.effectiveAt)>now()}))})
    }
    check(req.method==='POST' && (!req.headers.origin || new URL(req.headers.origin).host===req.headers.host),403,'ACCESS_DENIED')
    const input=await body(req)
    currentAdmin(identity)
    check(typeof input.ticketNo==='string' && /^ACC-0[12]-[\w-]{1,85}$/.test(input.ticketNo),400,'INVALID_TICKET')
    const previous=get(input.ticketNo)
    if(path==='/api/account-applications') {
      check(Object.hasOwn(actions,input.ticketType) && input.ticketNo.startsWith(input.ticketType+'-'),400,'INVALID_ACCOUNT_TYPE')
      const profile=directory.get(input.subjectId)
      check(profile,404,'SUBJECT_NOT_FOUND')
      const value=target(profile,input.ticketType,input.fields)
      const submission={subjectId:profile.subjectId,fields:input.fields}
      if(previous){check(previous.applicantSubjectId===identity.subjectId && same(previous.submission,submission),409,'APPLICATION_CONFLICT');return json(res,previous)}
      const version=types.activeVersion(input.ticketType,input.fields.workspaceId ?? '')
      const snapshot=await context(input.ticketType,profile,input.fields,identity)
      if(input.ticketType==='ACC-02' || !['开通','角色变更'].includes(input.fields.operation)) {
        value.ragflowPermission=snapshot.fields['当前RAGFlow权限'];value.difyRole=snapshot.fields['当前Dify workspace角色']
      }
      check(types.activeVersion(input.ticketType,input.fields.workspaceId ?? '')===version,409,'TYPE_VERSION_CHANGED')
      return json(res,store.transaction(()=>{
        currentAdmin(identity)
        const concurrent=get(input.ticketNo)
        if(concurrent){check(concurrent.applicantSubjectId===identity.subjectId && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT');return concurrent}
        check(directory.get(profile.subjectId).revision===profile.revision,409,'IDENTITY_CHANGED')
        return put({kind:'account-ticket',ticketNo:input.ticketNo,ticketType:input.ticketType,ticketTypeVersion:version,originDraft:req.draftClaim ?? null,
          subjectId:profile.subjectId,applicantSubjectId:identity.subjectId,account:identity.account,org:identity.org,
          submission,target:value,snapshot,preconditions:snapshot.preconditions,status:'待受理',revision:1,attempts:[],
          history:[{at:at(),actor:identity.account,action:'提交账号申请'}]})
      }),201)
    }
    check(path==='/api/account-applications/transition' && previous,404,'NOT_FOUND')
    check(input.revision===previous.revision,409,'VERSION_CONFLICT')
    check(text(input.note),400,'NOTE_REQUIRED')
    if(input.action==='查证原执行') {
      check(previous.status==='执行中' && previous.command && !previous.execution?.result,409,'INVALID_TRANSITION')
      check(!busy.has(previous.ticketNo),409,'EXECUTION_BUSY')
      const row=put({...previous,revision:previous.revision+1,
        history:[...previous.history,{at:at(),actor:identity.account,action:input.action,note:input.note}]})
      await deliver(row,{queryOnly:true}) // Never POST a missing execution from this entrance.
      return json(res,get(row.ticketNo))
    }
    if(input.action==='核验恢复并解锁') {
      check(previous.status==='执行失败' && previous.execution?.status==='failed' && !previous.localCommit && !previous.recovery,409,'INVALID_TRANSITION')
      check(previous.snapshot.recoveryBaseline,409,'RECOVERY_BASELINE_REQUIRED')
      check(!busy.has(previous.ticketNo),409,'EXECUTION_BUSY')
      busy.add(previous.ticketNo)
      try {
        const startedAt=now()
        // This endpoint reads a capability-owned, sealed proof; it does not run compensation.
        const raw=await(await cap('/executions/'+previous.command.executionId+'/account-consistency')).json()
        return json(res,store.transaction(()=>{
          currentAdmin(identity)
          const row=get(previous.ticketNo),p=directory.get(row.subjectId)
          check(row.revision===input.revision && row.status==='执行失败' && !row.localCommit,409,'VERSION_CONFLICT')
          check(p.pendingChange?.executionId===row.command.executionId && p.revision===row.preconditions.find(v=>v.kind==='identity_mapping').revision,409,'IDENTITY_LOCK_CHANGED')
          const proof=verifiedRestoration(raw,row,startedAt,now())
          store.put('person:'+p.subjectId,{...p,pendingChange:null})
          return put({...row,status:'已终止',reservedName:null,deliveryBlocked:false,lastError:null,recovery:proof,revision:row.revision+1,
            history:[...row.history,{at:at(),actor:identity.account,action:input.action,note:input.note,proofId:proof.proofId}]})
        }))
      }finally{busy.delete(previous.ticketNo)}
    }
    if(['确认结果','驳回','撤回','取消待生效'].includes(input.action))return json(res,store.transaction(()=>{
      const row=get(input.ticketNo);check(row.revision===input.revision,409,'VERSION_CONFLICT')
      if(input.action==='确认结果')check(row.status==='待结果确认',409,'INVALID_TRANSITION')
      else if(input.action==='取消待生效') {
        check(row.status==='执行中' && !row.execution && Date.parse(row.submission.fields.effectiveAt)>now(),409,'ALREADY_STARTED')
        const p=directory.get(row.subjectId)
        check(p.pendingChange?.executionId===row.command.executionId,409,'LOCK_CHANGED')
        store.put('person:'+p.subjectId,{...p,pendingChange:null})
      }else {check(row.status==='待受理',409,'INVALID_TRANSITION');if(input.action==='撤回')check(row.applicantSubjectId===identity.subjectId,403,'ACCESS_DENIED')}
      return put({...row,status:input.action==='确认结果'?'已完成':input.action==='驳回'?'已驳回':'已撤回',reservedName:null,revision:row.revision+1,
        history:[...row.history,{at:at(),actor:identity.account,action:input.action,note:input.note}]})
    }))
    if(input.action==='重试执行')return json(res,store.transaction(()=>{
      const row=get(input.ticketNo)
      check(!busy.has(row.ticketNo),409,'EXECUTION_BUSY')
      check(row.revision===input.revision && row.status==='执行失败' && row.execution?.result?.retryable===true && !row.localCommit,409,'NOT_RETRYABLE')
      const p=directory.get(row.subjectId)
      check(p.pendingChange?.executionId===row.command.executionId,409,'LOCK_CHANGED')
      const executionId=id(),command={...row.command,executionId,payload:{decisionRef:'dec-'+executionId}}
      store.put('person:'+p.subjectId,{...p,pendingChange:{...p.pendingChange,executionId}})
      const retried=put({...row,command,execution:null,executionKnown:false,deliveryBlocked:false,lastError:null,status:'执行中',revision:row.revision+1,
        attempts:[...row.attempts,{command,approvedFields:row.approvedFields,preconditions:row.preconditions}],history:[...row.history,{at:at(),actor:identity.account,action:'重试执行',note:input.note}]})
      queueMicrotask(()=>void deliver(retried));return retried
    }))
    check(input.action==='批准' && previous.status==='待受理',409,'INVALID_TRANSITION')
    const profile=directory.get(previous.subjectId)
    check(profile.revision===previous.preconditions.find(p=>p.kind==='identity_mapping').revision,409,'IDENTITY_CHANGED')
    const current=await context(previous.ticketType,profile,previous.submission.fields,identity)
    check(same(current.fields,previous.snapshot.fields) && same(current.preconditions,previous.preconditions) &&
      same(current.recoveryBaseline,previous.snapshot.recoveryBaseline ?? null),409,'STALE_ACCOUNT_CONTEXT')
    const approved=store.transaction(()=>{
      currentAdmin(identity)
      const row=get(input.ticketNo),p=directory.get(row.subjectId)
      check(row.revision===input.revision && row.status==='待受理' && p.revision===profile.revision,409,'VERSION_CONFLICT')
      check(!p.pendingChange,409,'SUBJECT_CHANGE_BUSY')
      unique(row.target.account,p.subjectId);keepAdmin(p,row.target)
      const executionId=id(),command={executionId,ticketNo:row.ticketNo,ticketType:row.ticketType,ticketTypeVersion:row.ticketTypeVersion,
        action:actions[row.ticketType],resourceId:p.subjectId,account:identity.account,org:identity.org,payload:{decisionRef:'dec-'+executionId}}
      const f=row.submission.fields
      const approvedFields={'目标人员ID':p.subjectId,'唯一账户名':p.account,'原账户名':p.account,'新账户名':row.target.account,
        '操作类型':f.operation ?? '账户名变更','本平台目标角色':row.target.roles,'RAGFlow目标权限':row.target.ragflowPermission,
        'Dify目标workspace角色':row.target.difyRole,'目标组织':row.target.org,'目标业务线':row.target.businessLine,
        '生效时间':f.effectiveAt,'失效时间':row.target.expiresAt,'申请依据':f.reason,'Dify workspace ID':current.fields['Dify workspace ID']}
      store.put('person:'+p.subjectId,{...p,pendingChange:{ticketNo:row.ticketNo,executionId,effectiveAt:f.effectiveAt}})
      return put({...row,status:'执行中',revision:row.revision+1,command,approvedFields,approvedBy:identity.account,
        reservedName:row.target.account,attempts:[{command,approvedFields,preconditions:row.preconditions}],
        history:[...row.history,{at:at(),actor:identity.account,action:'批准',note:input.note}]})
    })
    void deliver(approved);return json(res,approved)
  }
  async function commit(req,res,executionId,token) {
    check(req.method==='PUT' && req.headers.authorization==='Bearer '+token,403,'ACCESS_DENIED')
    const input=await body(req)
    check(text(input.subjectId) && text(input.ragflowAccountId) && text(input.difyAccountId) &&
      (input.workspaceId===null || text(input.workspaceId)) &&
      Object.keys(input).every(k=>['subjectId','ragflowAccountId','difyAccountId','workspaceId'].includes(k)),400,'INVALID_ACCOUNT_COMMIT')
    const result=store.transaction(()=>{
      const saved=store.get('commit:'+executionId)
      if(saved){check(same(saved.request,input),409,'COMMIT_CONFLICT');return saved.response}
      const row=rows().find(r=>r.command?.executionId===executionId)
      check(row && row.status==='执行中' && row.subjectId===input.subjectId && Date.parse(row.submission.fields.effectiveAt)<=now(),409,'INACTIVE_ACCOUNT_EXECUTION')
      const p=directory.get(row.subjectId)
      check(p.pendingChange?.executionId===executionId && p.revision===row.preconditions.find(v=>v.kind==='identity_mapping').revision,409,'IDENTITY_LOCK_CHANGED')
      check(input.workspaceId===row.snapshot.fields['Dify workspace ID'] &&
        ['RAGFlow账户ID','Dify账户ID'].every((key,i)=>!row.snapshot.fields[key] || row.snapshot.fields[key]===input[i?'difyAccountId':'ragflowAccountId']),409,'PRODUCT_MAPPING_MISMATCH')
      unique(row.target.account,p.subjectId);keepAdmin(p,row.target)
      const response={subjectId:p.subjectId,revision:p.revision+1,committedAt:at()}
      store.put('person:'+p.subjectId,{...p,...row.target,revision:response.revision,aliases:row.target.account!==p.account?[...new Set([...p.aliases,p.account])]:p.aliases,
        ragflowAccountId:input.ragflowAccountId,difyAccountId:input.difyAccountId,workspaceId:input.workspaceId,pendingChange:null})
      store.put('commit:'+executionId,{kind:'commit',request:input,response})
      put({...row,localCommit:{executionId,...response},revision:row.revision+1,history:[...row.history,{at:at(),actor:'capability',action:'产品核验后提交本平台身份'}]})
      return response
    })
    return json(res,result)
  }
  return {handle,commit,records:rows,close(){closed=true;clearInterval(timer)}}
}
