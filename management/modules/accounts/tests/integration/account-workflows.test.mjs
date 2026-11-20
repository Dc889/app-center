import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {seedSubjects} from '../../../../platform/identity/public.server.mjs'
import {mockExecution,mockDownload,mockDelivered} from '../../../../../tests/support/execution-state.mjs'
import {body,json,listen,ledger,digest} from '../../../../../runtime/http.mjs'

async function fixture(t,{fail=false,secondAdmin=false,productRoleOverride=false,multiRoles=false,holdFile=false,downloadOrgs=[],recovery=false}={}) {
  const dir=await mkdtemp(join(tmpdir(),'account-workflows-'))
  let clock=Date.now(),productRevision=1,complete=false
  const commands=[],executions=new Map(),observedRoles=[],uploads=new Map(),uploadRequests=[]
  const downloadBytes=Buffer.from('verified-skill-bytes'),downloadOwners=new Map(),fileRequests=[],receiptRequests=[],deliveryStats={confirmed:0}
  let rejectReceipts=false,releaseFile
  let proof=null
  const fileGate=new Promise(resolve=>{releaseFile=resolve})
  const initialSubjects=[...seedSubjects.map(p=>p.account==='chen.yu' && multiRoles?{...p,roles:['user','admin']}:p),{subjectId:'person-new',account:'new.person',name:'待开通人员',roles:['user'],org:'业务一部',businessLine:'刑侦',active:false},
    ...(secondAdmin?[{subjectId:'person-admin-two',account:'admin.two',name:'第二管理员',roles:['admin'],org:'系统管理组',businessLine:'系统管理'}]:[])]
  const capability=await listen(async(req,res,path)=>{
    if(req.headers['x-role'])observedRoles.push(req.headers['x-role'])
    if(path==='/internal/v1/catalog')return json(res,{items:!downloadOrgs.length || downloadOrgs.includes(decodeURIComponent(req.headers['x-org']))?
      [{resourceId:'skill',name:'测试Skill',status:'approved',actions:['download'],data:{version:'v1',sha256:digest(downloadBytes)}}]:[],nextCursor:null})
    if(path.startsWith('/internal/v1/downloads/')) {
      const resultId=path.split('/')[4],slot=downloadOwners.get(resultId)
      if(!slot || req.headers['x-subject-id']!==slot.subjectId)return json(res,{error:{code:'NOT_FOUND'}},404)
      const p=await(await fetch(api.url+'/internal/v1/subjects/'+slot.subjectId,{headers:{authorization:'Bearer test'}})).json()
      if(req.headers['x-account']!==p.account || decodeURIComponent(req.headers['x-org'])!==p.org)return json(res,{error:{code:'NOT_FOUND'}},404)
      const headers={account:req.headers['x-account'],subjectId:req.headers['x-subject-id'],mode:req.headers['x-receipt-mode']}
      if(path.endsWith('/receipt')) {
        receiptRequests.push(headers)
        assert.equal(headers.mode,'server-settlement')
        if(rejectReceipts)return json(res,{error:{code:'TRY_LATER'}},503)
        const receipt=await body(req)
        assert.equal(receipt.sha256,digest(downloadBytes));assert.equal(receipt.bytesSent,downloadBytes.length)
        const state=executions.get(slot.executionId)
        if(state.status!=='succeeded')deliveryStats.confirmed++
        const result=mockDelivered(commands.find(c=>c.executionId===slot.executionId),resultId)
        executions.set(slot.executionId,result);return json(res,result)
      }
      if(!p.active || p.restricted)return json(res,{error:{code:'ACCOUNT_RESTRICTED'}},403)
      fileRequests.push(headers)
      if(holdFile)await fileGate
      res.writeHead(200,{'content-type':'application/octet-stream','content-length':downloadBytes.length,
        'content-disposition':'attachment; filename=test.bin','x-content-sha256':digest(downloadBytes)})
      return res.end(downloadBytes)
    }
    if(path.startsWith('/internal/v1/intake/')) {
      const kind=path.split('/')[4]
      uploadRequests.push({account:req.headers['x-account'],subjectId:req.headers['x-subject-id'],role:req.headers['x-role']})
      if(req.method==='POST') {
        const chunks=[];for await(const chunk of req)chunks.push(chunk)
        const hash=digest(Buffer.concat(chunks)),key=req.headers['idempotency-key']
        const previous=uploads.get(key)
        if(previous && (previous.sha256!==hash || previous.ownerSubjectId!==req.headers['x-subject-id']))return json(res,{error:{code:'UPLOAD_CONFLICT'}},409)
        const item=previous ?? {intakeId:'intake-'+uploads.size,kind,sha256:hash,ownerSubjectId:req.headers['x-subject-id']}
        uploads.set(key,item);return json(res,{intakeId:item.intakeId,status:'scanning'},202)
      }
      const item=[...uploads.values()].find(v=>v.kind===kind && path.endsWith('/'+v.intakeId))
      if(!item || item.ownerSubjectId!==req.headers['x-subject-id'])return json(res,{error:{code:'NOT_FOUND'}},404)
      return json(res,{intakeId:item.intakeId,status:'ready',sha256:item.sha256,sizeBytes:32,filename:'test.zip',
        scan:{verdict:'passed',checkedAt:new Date().toISOString(),findings:[{message:'private scan evidence'}]}})
    }
    if(path.includes('/execution-contexts/KB-05'))return json(res,{snapshotId:'disposal-context',ticketType:'KB-05',
      action:'dispose_dataset',resourceId:'kb',eligible:true,fields:{'知识库名称':'知识库','源workspace/tenant ID':'ws','来源系统':'Dify','源知识库ID':'source','文档清单快照ID':'manifest',
        '清单完整':true,'文档清单':[],'影响中的授权数':0,'影响中的智能体数':0,
        '处置目标清单':[{system:'平台',objectId:'kb',action:'暂停分享'}]},
      preconditions:[{kind:'dataset',id:'kb',revision:1},{kind:'dataset_manifest',id:'manifest',sha256:'a'.repeat(64)}]})
    if(path.includes('/execution-contexts/ACC-')) {
      const query=new URL(req.url,'http://localhost').searchParams,type=path.split('/').at(-1),subjectId=query.get('resourceId')
      const p=await(await fetch(api.url+'/internal/v1/subjects/'+subjectId,{headers:{authorization:'Bearer test'}})).json()
      return json(res,{snapshotId:'account-context',ticketType:type,action:type==='ACC-01'?'apply_account_change':'rename_account',resourceId:subjectId,
        ...(recovery?{recoveryBaseline:{ragflow:{accountId:'rag-'+subjectId,account:p.account,active:p.active,permission:productRoleOverride?'管理员':p.ragflowPermission},
          dify:{accountId:'dify-'+subjectId,workspaceId:query.get('workspaceId') ?? p.workspaceId ?? 'ws',account:p.account,active:p.active,role:productRoleOverride?'管理员':p.difyRole}}}:{}),
        fields:{'目标人员ID':subjectId,'当前账户名':p.account,'RAGFlow账户ID':subjectId==='person-new' && !p.ragflowAccountId?null:'rag-'+subjectId,
          'Dify账户ID':subjectId==='person-new' && !p.difyAccountId?null:'dify-'+subjectId,'Dify workspace ID':query.get('workspaceId') ?? p.workspaceId ?? 'ws',
          '当前RAGFlow权限':productRoleOverride?'管理员':p.ragflowPermission,'当前Dify workspace角色':productRoleOverride?'管理员':p.difyRole,
          '待校验新账户名':query.get('newAccount'),'RAGFlow唯一性校验':'通过','Dify唯一性校验':'通过',secret:'NEVER SAVE THIS'},
        preconditions:[{kind:'product_account_mapping',id:subjectId,revision:productRevision}]})
    }
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req);commands.push(command)
      if(command.action==='download') {
        const resultId='DL-'+command.executionId
        downloadOwners.set(resultId,{executionId:command.executionId,subjectId:req.headers['x-subject-id']})
        const state=mockDownload(command,resultId,{sizeBytes:downloadBytes.length,filename:'test.bin',contentType:'application/octet-stream'})
        executions.set(command.executionId,state);return json(res,state)
      }
      const state=mockExecution(command,{status:fail?'failed':'running',result:fail?{retryable:true,failureCode:'DIFY_STEP_FAILED',
        details:{values:{'RAGFlow执行结果':'成功','Dify执行结果':'失败','最终一致性':'需人工修复'}}}:null})
      fail=false;executions.set(command.executionId,state);return json(res,state)
    }
    if(path.endsWith('/account-consistency'))return proof?json(res,typeof proof==='function'?await proof():proof):json(res,{error:{code:'UPSTREAM_UNSUPPORTED'}},501)
    const state=executions.get(path.split('/').at(-1))
    if(state && complete && state.status==='running')return json(res,mockExecution(commands.find(c=>c.executionId===state.executionId),{status:'succeeded',result:{resultId:'consistent',details:{values:{'最终一致性':'一致'}}}}))
    return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const options={dir,token:'test',executor:capability.url,initialSubjects,now:()=>clock}
  let api=await startManagement(options)
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie='',data,method,internal=false)=>fetch(api.url+path,{method:method ?? (data===undefined?'GET':'POST'),
    headers:{cookie,'content-type':'application/json',...(internal?{authorization:'Bearer test'}:{})},body:data===undefined?undefined:JSON.stringify(data)})
  async function login(account,role) {
    const r=await request('/api/demo-session','',{account,...role?{role}:{}})
    assert.equal(r.status,200,await r.clone().text())
    return r.headers.get('set-cookie').split(';')[0]
  }
  async function row(no,cookie) {
    const r=await request('/api/account-applications?view=query',cookie);assert.equal(r.status,200)
    return (await r.json()).items.find(p=>p.ticketNo===no)
  }
  async function subject(subjectId,cookie){return (await(await request('/api/subjects',cookie)).json()).items.find(p=>p.subjectId===subjectId)}
  async function until(fn){const end=Date.now()+6500;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(resolve=>setTimeout(resolve,40))}assert.fail('账号流程未到达预期状态')}
  async function wait(no,status,cookie){return until(async()=>{const r=await row(no,cookie);return r.status===status && r})}
  async function act(no,cookie,action){const r=await row(no,cookie);return request('/api/account-applications/transition',cookie,{ticketNo:no,revision:r.revision,action,note:'核对申请与产品映射'})}
  const input=(type,suffix,subjectId='person-chen-yu',fields={})=>({ticketNo:type+'-'+suffix,ticketType:type,subjectId,fields:{
    reason:'业务需要调整',effectiveAt:new Date(clock-1000).toISOString(),...(type==='ACC-01'?{operation:'角色变更',roles:['operator'],
      ragflowPermission:'团队成员',difyRole:'编辑',workspaceId:'ws'}:{newAccount:'chen.new'}),...fields}})
  const commitBody=subjectId=>({subjectId,ragflowAccountId:'rag-'+subjectId,difyAccountId:'dify-'+subjectId,workspaceId:'ws'})
  const commit=(executionId,data,internal=true)=>request('/internal/v1/account-changes/'+executionId+'/commit','',data,'PUT',internal)
  const upload=(cookie,content='data',kind='skill')=>fetch(api.url+'/api/intake/'+kind,{method:'POST',headers:{cookie,
    'content-type':'multipart/form-data; boundary=stable-boundary','idempotency-key':'stable-user-key',
    'x-account':'chen.yu','x-subject-id':'person-chen-yu'},body:Buffer.from('--stable-boundary\r\nContent-Disposition: form-data; name="file"; filename="test.zip"\r\n\r\n'+content+'\r\n--stable-boundary--\r\n')})
  const uploadEvidence=cookie=>fetch(api.url+'/api/evidence',{method:'POST',headers:{cookie,'x-filename':'proof.txt'},body:Buffer.from('proof-bytes')})
  return {dir,request,login,row,subject,until,wait,act,input,commitBody,commit,commands,observedRoles,uploads,uploadRequests,upload,uploadEvidence,
    downloadBytes,fileRequests,receiptRequests,deliveryStats,releaseFiles(){holdFile=false;releaseFile()},rejectReceipts(value){rejectReceipts=value},
    forgetExecution(executionId){executions.delete(executionId)},
    setExecution(executionId,state){executions.set(executionId,state)},setProof(value){proof=value},
    complete(){complete=true},advance(ms){clock+=ms},reviseProduct(){productRevision++},async restart(){await api.close();api=await startManagement(options)}}
}

test('ACC-01 管理员专用，审批锁与最终提交原子，旧会话失效且角色来自获准输入',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang'),user=await f.login('chen.yu'),ops=await f.login('zhou.min')
  const input=f.input('ACC-01','roles')
  assert.equal((await f.request('/api/subjects',ops)).status,403)
  assert.equal((await f.request('/api/account-applications',ops,input)).status,403)
  assert.equal((await f.request('/api/account-applications?view=query',user)).status,403)
  const submitted=await f.request('/api/account-applications',admin,input)
  assert.equal(submitted.status,201)
  assert.equal(JSON.stringify(await submitted.json()).includes('NEVER SAVE THIS'),false)
  assert.equal(f.commands.length,0)
  assert.equal((await f.subject(input.subjectId,admin)).pendingChange,null)
  const approved=await(await f.act(input.ticketNo,admin,'批准')).json()
  assert.equal((await f.subject(input.subjectId,admin)).roles[0],'user')
  assert.equal((await f.request('/api/drafts',user,{draftId:'restricted',ticketType:'SKL-03',revision:0,fields:{}})).status,403)
  const b=f.commitBody(input.subjectId)
  const frozenInput=await(await f.request('/internal/v1/approved-inputs/'+approved.command.executionId,'',undefined,'GET',true)).json()
  assert.deepEqual(frozenInput.recoveryBaseline,approved.snapshot.recoveryBaseline)
  const proofUrl='/internal/v1/account-changes/'+approved.command.executionId+'/commit'
  assert.equal((await f.request(proofUrl)).status,403)
  assert.equal((await f.request(proofUrl,'',undefined,'GET',true)).status,404)
  assert.equal((await f.commit(approved.command.executionId,b,false)).status,403)
  assert.equal((await f.commit(approved.command.executionId,{...b,difyAccountId:'wrong'})).status,409)
  assert.equal((await f.commit(approved.command.executionId,{...b,roles:['admin']})).status,400)
  const committed=await f.commit(approved.command.executionId,b)
  assert.equal(committed.status,200)
  const response=await committed.json()
  assert.equal(response.revision,2)
  const beforeRead=await f.row(input.ticketNo,admin)
  const proof=await(await f.request(proofUrl,'',undefined,'GET',true)).json()
  assert.deepEqual(proof,{executionId:approved.command.executionId,request:b,response})
  assert.equal((await f.row(input.ticketNo,admin)).revision,beforeRead.revision)
  assert.deepEqual(await(await f.commit(approved.command.executionId,b)).json(),response)
  assert.equal((await f.commit(approved.command.executionId,{...b,workspaceId:'wrong'})).status,409)
  const profile=await f.subject(input.subjectId,admin)
  assert.deepEqual(profile.roles,['operator']);assert.equal(profile.pendingChange,null)
  assert.equal((await f.request('/api/drafts',user)).status,403)
  assert.equal((await f.request('/api/demo-session','',{account:'chen.yu',role:'admin'})).status,403)
  const fresh=await f.login('chen.yu','operator')
  assert.equal((await f.request('/api/account-applications?view=query',fresh)).status,403)
  f.complete();await f.wait(input.ticketNo,'待结果确认',admin)
  assert.equal((await f.act(input.ticketNo,admin,'确认结果')).status,200)
})

test('ACC-02 产品部分成功不提前改名，重启后受限，重试更新锁并拒绝旧执行提交',async t=>{
  const f=await fixture(t,{fail:true}),admin=await f.login('li.qiang'),user=await f.login('chen.yu')
  assert.equal((await f.request('/api/drafts',user,{draftId:'old-name-draft',ticketType:'SKL-03',revision:0,fields:{purpose:'原名历史'}})).status,200)
  const input=f.input('ACC-02','rename')
  assert.equal((await f.request('/api/account-applications',admin,input)).status,201)
  await f.act(input.ticketNo,admin,'批准')
  let row=await f.wait(input.ticketNo,'执行失败',admin)
  const oldId=row.command.executionId
  assert.equal((await f.subject(input.subjectId,admin)).account,'chen.yu')
  assert.equal((await f.request('/api/demo-session','',{account:'chen.new'})).status,403)
  assert.equal((await f.request('/api/drafts',user,{draftId:'blocked',ticketType:'SKL-03',revision:0,fields:{}})).status,403)
  await f.restart()
  assert.equal((await f.subject(input.subjectId,admin)).pendingChange.executionId,oldId)
  assert.equal((await f.act(input.ticketNo,admin,'重试执行')).status,200)
  row=await f.row(input.ticketNo,admin)
  assert.notEqual(row.command.executionId,oldId)
  assert.equal((await f.commit(oldId,f.commitBody(input.subjectId))).status,409)
  const old=await(await f.request('/internal/v1/approved-inputs/'+oldId,'',undefined,undefined,true)).json()
  assert.equal(old.fields['新账户名'],'chen.new')
  assert.equal((await f.commit(row.command.executionId,f.commitBody(input.subjectId))).status,200)
  assert.equal((await f.request('/api/demo-session','',{account:'chen.yu'})).status,403)
  const renamed=await f.login('chen.new')
  assert.equal((await f.request('/api/drafts',user)).status,403)
  const drafts=await(await f.request('/api/drafts',renamed)).json()
  assert.equal(drafts.items[0].draftId,'old-name-draft')
  f.complete();await f.wait(input.ticketNo,'待结果确认',admin)
  assert.equal((await f.subject(input.subjectId,admin)).aliases[0],'chen.yu')
})

test('ACC 并发申请不能覆盖目标锁或新名预约，最后一个管理员不可停用',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang')
  const a=f.input('ACC-02','a'),b=f.input('ACC-02','b','person-zhou-min'),c=f.input('ACC-01','same-subject')
  for(const input of [a,b,c])assert.equal((await f.request('/api/account-applications',admin,input)).status,201)
  assert.equal((await f.act(a.ticketNo,admin,'批准')).status,200)
  assert.equal((await f.act(b.ticketNo,admin,'批准')).status,409)
  assert.equal((await f.act(c.ticketNo,admin,'批准')).status,409)
  const last=f.input('ACC-01','last-admin','person-li-qiang',{operation:'停用'})
  assert.equal((await f.request('/api/account-applications',admin,last)).status,201)
  assert.equal((await f.act(last.ticketNo,admin,'批准')).status,409)
  assert.equal((await f.subject('person-li-qiang',admin)).pendingChange,null)
})

test('ACC 未来生效可以取消且解除预约，产品依据变化阻止批准',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang'),user=await f.login('chen.yu')
  const scheduled=f.input('ACC-02','future','person-chen-yu',{effectiveAt:new Date(Date.now()+600000).toISOString()})
  await f.request('/api/account-applications',admin,scheduled)
  await f.act(scheduled.ticketNo,admin,'批准')
  assert.equal(f.commands.length,0)
  assert.equal((await f.request('/api/drafts',user,{draftId:'before-effective',ticketType:'SKL-03',revision:0,fields:{}})).status,200)
  assert.equal((await f.act(scheduled.ticketNo,admin,'取消待生效')).status,200)
  assert.equal((await f.subject(scheduled.subjectId,admin)).pendingChange,null)
  const stale=f.input('ACC-02','stale')
  await f.request('/api/account-applications',admin,stale);f.reviseProduct()
  assert.equal((await f.act(stale.ticketNo,admin,'批准')).status,409)
})

test('ACC-01 开通、组织变更和停用均在产品回调之后生效，非适用字段不可扩权',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang')
  const open=f.input('ACC-01','open','person-new',{operation:'开通',roles:['user'],org:'业务一部',businessLine:'刑侦'})
  await f.request('/api/account-applications',admin,open)
  let r=await(await f.act(open.ticketNo,admin,'批准')).json()
  assert.equal((await f.subject('person-new',admin)).active,false)
  assert.equal((await f.commit(r.command.executionId,f.commitBody('person-new'))).status,200)
  const opened=await f.login('new.person')
  const org=f.input('ACC-01','org','person-new',{operation:'组织变更',org:'平台运营组',businessLine:'平台运营',roles:['admin'],difyRole:'管理员'})
  await f.request('/api/account-applications',admin,org);r=await(await f.act(org.ticketNo,admin,'批准')).json()
  assert.equal((await f.commit(r.command.executionId,f.commitBody('person-new'))).status,200)
  const profile=await f.subject('person-new',admin)
  assert.equal(profile.org,'平台运营组');assert.deepEqual(profile.roles,['user']);assert.equal(profile.difyRole,'编辑')
  assert.equal((await f.request('/api/drafts',opened)).status,403)
  const disabled=f.input('ACC-01','disable','person-new',{operation:'停用',org:'系统管理组',roles:['admin']})
  await f.request('/api/account-applications',admin,disabled);r=await(await f.act(disabled.ticketNo,admin,'批准')).json()
  assert.equal((await f.commit(r.command.executionId,f.commitBody('person-new'))).status,200)
  assert.equal((await f.subject('person-new',admin)).active,false)
  assert.equal((await f.request('/api/demo-session','',{account:'new.person'})).status,403)
})

test('ACC 本地尚未收到最终提交时，上游成功不能提前完成工单',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang')
  const input=f.input('ACC-02','missing-commit')
  await f.request('/api/account-applications',admin,input)
  await f.act(input.ticketNo,admin,'批准');f.complete()
  const row=await f.until(async()=>{const value=await f.row(input.ticketNo,admin);return value.deliveryBlocked && value})
  assert.equal(row.lastError.code,'LOCAL_COMMIT_REQUIRED')
  assert.equal((await f.subject(input.subjectId,admin)).account,'chen.yu')
  assert.equal((await f.act(input.ticketNo,admin,'确认结果')).status,409)
  assert.equal((await f.commit(row.command.executionId,f.commitBody(input.subjectId))).status,200)
  assert.equal((await f.act(input.ticketNo,admin,'查证原执行')).status,200)
  const reconciled=await f.wait(input.ticketNo,'待结果确认',admin)
  assert.equal(reconciled.deliveryBlocked,false)
  assert.equal(f.commands.length,1)
})

function restoration(row) {
  return {proofId:'proof-'+row.command.executionId,executionId:row.command.executionId,ticketNo:row.ticketNo,subjectId:row.subjectId,
    identityRevision:row.preconditions.find(p=>p.kind==='identity_mapping').revision,
    productMappingRevision:row.preconditions.find(p=>p.kind==='product_account_mapping').revision,
    executionStatus:'failed',sealed:true,outcome:'restored',checkedAt:new Date().toISOString(),products:row.snapshot.recoveryBaseline}
}

test('ACC 原执行丢失只能查询，重启不会重新下发或解除目标限制',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang'),user=await f.login('chen.yu')
  const input=f.input('ACC-02','lost-query')
  await f.request('/api/account-applications',admin,input);await f.act(input.ticketNo,admin,'批准')
  const row=await f.until(async()=>{const r=await f.row(input.ticketNo,admin);return r.executionKnown && r})
  f.forgetExecution(row.command.executionId)
  assert.equal((await f.act(row.ticketNo,admin,'查证原执行')).status,200)
  const blocked=await f.row(row.ticketNo,admin)
  assert.equal(blocked.lastError.code,'NOT_FOUND');assert.equal(blocked.deliveryBlocked,true)
  await f.restart();await new Promise(resolve=>setTimeout(resolve,2200))
  assert.equal(f.commands.length,1)
  assert.equal((await f.subject(row.subjectId,admin)).pendingChange.executionId,row.command.executionId)
  assert.equal((await f.request('/api/drafts',user,{draftId:'lost-query',ticketType:'SKL-03',revision:0,fields:{}})).status,403)
  f.setExecution(row.command.executionId,mockExecution(row.command,{status:'reconciling'}))
  assert.equal((await f.act(row.ticketNo,admin,'查证原执行')).status,200)
  assert.equal((await f.row(row.ticketNo,admin)).deliveryBlocked,false)
  assert.equal((await f.act(row.ticketNo,admin,'重试执行')).status,409)
})

test('ACC 安全解锁只接收原执行的完整封存恢复证明，保留原失败且重启可审计',async t=>{
  const f=await fixture(t,{fail:true,recovery:true}),admin=await f.login('li.qiang'),user=await f.login('chen.yu'),ops=await f.login('zhou.min')
  const input=f.input('ACC-02','restore-proof')
  await f.request('/api/account-applications',admin,input);await f.act(input.ticketNo,admin,'批准')
  const row=await f.wait(input.ticketNo,'执行失败',admin),original=await f.subject(row.subjectId,admin)
  f.setProof(restoration(row))
  assert.equal((await f.request('/api/account-applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'核验恢复并解锁',note:'伪造办理'})).status,403)
  assert.equal((await f.act(row.ticketNo,admin,'核验恢复并解锁')).status,200)
  const resolved=await f.row(row.ticketNo,admin),profile=await f.subject(row.subjectId,admin)
  assert.equal(resolved.status,'已终止');assert.equal(resolved.reservedName,null)
  assert.deepEqual(resolved.execution,row.execution);assert.deepEqual(resolved.attempts,row.attempts)
  assert.deepEqual(profile,{...original,pendingChange:null})
  assert.equal((await f.request('/api/drafts',user,{draftId:'after-restore',ticketType:'SKL-03',revision:0,fields:{}})).status,200)
  assert.equal((await f.commit(row.command.executionId,f.commitBody(row.subjectId))).status,409)
  assert.equal((await f.act(row.ticketNo,admin,'重试执行')).status,409)
  assert.equal((await f.act(row.ticketNo,admin,'核验恢复并解锁')).status,409)
  await f.restart()
  assert.deepEqual((await f.row(row.ticketNo,admin)).recovery,resolved.recovery)
  const audit=(await(await f.request('/api/audit',admin)).json()).items
  assert.ok(audit.some(e=>e.reference===row.ticketNo && e.action==='核验恢复并解锁' && e.actorSubjectId==='person-li-qiang'))
  const next=f.input('ACC-02','restore-reservation','person-zhou-min')
  assert.equal((await f.request('/api/account-applications',admin,next)).status,201)
  assert.equal((await f.act(next.ticketNo,admin,'批准')).status,200)
})

test('ACC 缺失、过期、部分恢复及错对象证明均不释放锁，不信任浏览器提交的证明',async t=>{
  const f=await fixture(t,{fail:true,recovery:true}),admin=await f.login('li.qiang')
  const input=f.input('ACC-02','invalid-proof')
  await f.request('/api/account-applications',admin,input);await f.act(input.ticketNo,admin,'批准')
  const row=await f.wait(input.ticketNo,'执行失败',admin),proof=restoration(row)
  const spoof=await f.request('/api/account-applications/transition',admin,{ticketNo:row.ticketNo,revision:row.revision,
    action:'核验恢复并解锁',note:'浏览器不能提供事实',proof})
  assert.equal(spoof.status,501)
  for(const patch of [{sealed:false},{outcome:'partial'},{outcome:'unknown'},{executionStatus:'running'},
    {executionId:'other'},{ticketNo:'other'},{subjectId:'other'},{identityRevision:2},{productMappingRevision:2},
    {checkedAt:'invalid'},{checkedAt:new Date(Date.now()-120000).toISOString()},
    {products:{...proof.products,dify:{...proof.products.dify,workspaceId:'wrong'}}},
    {products:{...proof.products,ragflow:{...proof.products.ragflow,account:'chen.new'}}}]) {
    f.setProof({...proof,...patch})
    assert.equal((await f.act(row.ticketNo,admin,'核验恢复并解锁')).status,409,JSON.stringify(patch))
    assert.equal((await f.subject(row.subjectId,admin)).pendingChange.executionId,row.command.executionId)
  }
  assert.equal(f.commands.length,1)
  assert.deepEqual((await f.row(row.ticketNo,admin)).execution,row.execution)
})

test('ACC 旧部署没有审批前产品基线时不能解锁，也不能对已提交身份反向恢复',async t=>{
  const f=await fixture(t,{fail:true}),admin=await f.login('li.qiang')
  const input=f.input('ACC-02','legacy-baseline')
  await f.request('/api/account-applications',admin,input);await f.act(input.ticketNo,admin,'批准')
  const row=await f.wait(input.ticketNo,'执行失败',admin)
  const response=await f.act(row.ticketNo,admin,'核验恢复并解锁')
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,'RECOVERY_BASELINE_REQUIRED')
  assert.equal((await f.act(row.ticketNo,admin,'重试执行')).status,200)
  const retried=await f.row(row.ticketNo,admin)
  await f.commit(retried.command.executionId,f.commitBody(row.subjectId))
  assert.equal((await f.act(row.ticketNo,admin,'核验恢复并解锁')).status,409)
  assert.equal((await f.subject(row.subjectId,admin)).account,'chen.new')
})

test('ACC 查证期间互斥，等待产品证明时管理员身份失效不得解锁',async t=>{
  const f=await fixture(t,{fail:true,recovery:true,multiRoles:true}),admin=await f.login('li.qiang'),other=await f.login('chen.yu','admin')
  const input=f.input('ACC-02','proof-concurrent','person-zhou-min',{newAccount:'zhou.fixed'})
  await f.request('/api/account-applications',other,input);await f.act(input.ticketNo,other,'批准')
  const row=await f.wait(input.ticketNo,'执行失败',admin)
  let release,started
  const gate=new Promise(resolve=>{release=resolve}),entered=new Promise(resolve=>{started=resolve})
  t.after(()=>release())
  f.setProof(async()=>{started();await gate;return restoration(row)})
  const pending=f.act(row.ticketNo,other,'核验恢复并解锁')
  await Promise.race([entered,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('未进入证明查询')),5000);timer.unref()})])
  assert.equal((await f.act(row.ticketNo,admin,'核验恢复并解锁')).status,409)
  assert.equal((await f.act(row.ticketNo,admin,'重试执行')).status,409)
  const demote=f.input('ACC-01','proof-admin-demoted','person-chen-yu',{roles:['user']})
  await f.request('/api/account-applications',admin,demote)
  const change=await(await f.act(demote.ticketNo,admin,'批准')).json()
  assert.equal((await f.commit(change.command.executionId,f.commitBody(demote.subjectId))).status,200)
  release()
  assert.equal((await pending).status,403)
  assert.equal((await f.subject(row.subjectId,admin)).pendingChange.executionId,row.command.executionId)
  f.setProof(restoration(row))
  assert.equal((await f.act(row.ticketNo,admin,'核验恢复并解锁')).status,200)
})

test('ACC 组织变更的只读产品权限来自可信产品现状，不用未核验的本地默认值覆盖',async t=>{
  const f=await fixture(t,{productRoleOverride:true}),admin=await f.login('li.qiang')
  const input=f.input('ACC-01','trusted-permissions','person-chen-yu',{operation:'组织变更',org:'平台运营组',businessLine:'平台运营',
    roles:['admin'],ragflowPermission:'个人',difyRole:'成员'})
  assert.equal((await f.request('/api/account-applications',admin,input)).status,201)
  const approved=await(await f.act(input.ticketNo,admin,'批准')).json()
  assert.deepEqual(approved.approvedFields['本平台目标角色'],['user'])
  assert.equal(approved.approvedFields['RAGFlow目标权限'],'管理员')
  assert.equal(approved.approvedFields['Dify目标workspace角色'],'管理员')
  assert.equal((await f.commit(approved.command.executionId,f.commitBody(input.subjectId))).status,200)
  assert.equal((await f.subject(input.subjectId,admin)).difyRole,'管理员')
})

test('ACC 多角色人员按当前登录身份鉴权，用户身份不会隐含管理员请求头',async t=>{
  const f=await fixture(t,{multiRoles:true}),userMode=await f.login('chen.yu','user')
  assert.equal((await f.request('/api/subjects',userMode)).status,403)
  assert.equal((await f.request('/api/account-applications?view=query',userMode)).status,403)
  assert.equal((await f.request('/api/catalog?kind=skill',userMode)).status,200)
  assert.equal(f.observedRoles.at(-1),'user')
  const adminMode=await f.login('chen.yu','admin')
  assert.equal((await f.request('/api/subjects',adminMode)).status,200)
})

test('ACC严格拒绝缺失协议字段，不采纳错误终态且不重复下发',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang')
  const input=f.input('ACC-02','strict-response')
  await f.request('/api/account-applications',admin,input);await f.act(input.ticketNo,admin,'批准')
  let row=await f.until(async()=>{const r=await f.row(input.ticketNo,admin);return r.execution?.status==='running' && r})
  const baseline=row.execution,valid=mockExecution(row.command,{status:'running'})
  for(const key of ['executionId','ticketNo','updatedAt','delivery','result']) {
    const raw={...valid};delete raw[key];f.setExecution(row.command.executionId,raw)
    assert.equal((await f.act(row.ticketNo,admin,'查证原执行')).status,200)
    row=await f.row(row.ticketNo,admin)
    assert.equal(row.deliveryBlocked,true);assert.deepEqual(row.execution,baseline)
    assert.equal((await f.subject(row.subjectId,admin)).pendingChange.executionId,row.command.executionId)
  }
  assert.equal(f.commands.length,1)
})

test('ACC-02 改名不改变事件人员归属，也不能绕过另一人独立复核',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang'),ops=await f.login('zhou.min'),reviewer=await f.login('wang.ning')
  let event=await(await f.request('/api/events',ops,{ticketNo:'EVT-01-rename-review',resourceId:'plugin',objectType:'插件',facts:'测试账号改名后的复核归属'})).json()
  event=await(await f.request('/api/events/transition',ops,{ticketNo:event.ticketNo,revision:event.revision,action:'开始处置',note:'记录事实',
    assessment:{severity:'一般',conclusion:'真实故障',cause:'未知',impact:'测试对象'}})).json()
  event=await(await f.request('/api/events/transition',ops,{ticketNo:event.ticketNo,revision:event.revision,action:'提交复核',note:'观察处置后复核',
    disposition:{actions:['观察'],result:'已记录观察事实',recovered:false}})).json()
  const input=f.input('ACC-02','operator-rename','person-zhou-min',{newAccount:'zhou.renamed'})
  await f.request('/api/account-applications',admin,input)
  const row=await(await f.act(input.ticketNo,admin,'批准')).json()
  assert.equal((await f.commit(row.command.executionId,f.commitBody(input.subjectId))).status,200)
  const renamed=await f.login('zhou.renamed')
  const mine=await(await f.request('/api/events?view=mine',renamed)).json()
  assert.equal(mine.items[0].ticketNo,event.ticketNo)
  assert.equal(mine.items[0].handledByCurrent,true)
  const review={ticketNo:event.ticketNo,revision:event.revision,action:'确认关闭',note:'独立核对'}
  assert.equal((await f.request('/api/events/transition',renamed,review)).status,403)
  assert.equal((await f.request('/api/events/transition',reviewer,review)).status,200)
})

test('审计保存操作时组织、角色及人员修订，调岗改名后不改写历史且按历史组织过滤',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang'),original=await f.login('zhou.min'),reviewer=await f.login('wang.ning')
  const report=(ticketNo,cookie)=>f.request('/api/events',cookie,{ticketNo,resourceId:'plugin',objectType:'插件',facts:'验证历史身份快照'})
  const audit=async cookie=>(await(await f.request('/api/audit',cookie)).json()).items
  await report('EVT-01-org-before',original)
  const before=(await audit(admin)).find(e=>e.reference==='EVT-01-org-before')
  assert.equal(before.org,'平台运营组');assert.equal(before.actorRole,'operator');assert.equal(before.actorRevision,1)
  assert.equal(before.actorSubjectId,'person-zhou-min');assert.equal(before.actorSource,'session_snapshot')
  const org=f.input('ACC-01','audit-org','person-zhou-min',{operation:'组织变更',org:'业务一部',businessLine:'刑侦'})
  await f.request('/api/account-applications',admin,org)
  const approved=await(await f.act(org.ticketNo,admin,'批准')).json()
  await f.commit(approved.command.executionId,f.commitBody(org.subjectId))
  const moved=await f.login('zhou.min')
  await report('EVT-01-org-after',moved)
  const entries=await audit(admin),after=entries.find(e=>e.reference==='EVT-01-org-after')
  assert.deepEqual(entries.find(e=>e.reference==='EVT-01-org-before'),before)
  assert.equal(after.org,'业务一部');assert.equal(after.actorRevision,2)
  assert.ok((await audit(reviewer)).some(e=>e.reference==='EVT-01-org-before'))
  assert.ok(!(await audit(reviewer)).some(e=>e.reference==='EVT-01-org-after'))
  assert.ok(!(await audit(moved)).some(e=>e.reference==='EVT-01-org-before'))
  const rename=f.input('ACC-02','audit-rename','person-zhou-min',{newAccount:'zhou.audit'})
  await f.request('/api/account-applications',admin,rename)
  const renameRow=await(await f.act(rename.ticketNo,admin,'批准')).json()
  await f.commit(renameRow.command.executionId,f.commitBody(rename.subjectId))
  const renamed=await f.login('zhou.audit')
  await report('EVT-01-org-renamed',renamed)
  await f.restart()
  const history=await audit(admin)
  assert.deepEqual(history.find(e=>e.reference==='EVT-01-org-before'),before)
  assert.deepEqual(history.find(e=>e.reference==='EVT-01-org-after'),after)
  assert.equal(history.find(e=>e.reference==='EVT-01-org-renamed').actorSubjectId,before.actorSubjectId)
  assert.equal(history.find(e=>e.reference==='EVT-01-org-renamed').actorRevision,3)
})

test('旧审计缺失组织时保持未采集，追加操作不补写旧事实，历史前缀不可修改',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang'),ops=await f.login('zhou.min')
  const raw=ledger(f.dir,'reported-events')
  const ticketNo='EVT-01-legacy-org',event={ticketNo,account:'zhou.min',resourceId:'plugin',objectType:'插件',facts:'旧记录',status:'未研判',version:'1',revision:1,
    history:[{at:new Date().toISOString(),actor:'zhou.min',action:'人工报告'}]}
  raw.put(ticketNo,event);raw.close()
  const legacy=(await(await f.request('/api/audit',admin)).json()).items.find(e=>e.reference===ticketNo)
  assert.equal(legacy.org,null);assert.equal(legacy.actorSource,'not_collected')
  assert.ok(!(await(await f.request('/api/audit',ops)).json()).items.some(e=>e.reference===ticketNo))
  assert.equal((await f.request('/api/events/transition',ops,{ticketNo,revision:1,action:'开始处置',note:'核对旧事件',
    assessment:{severity:'一般',conclusion:'真实故障',cause:'未知',impact:'测试对象'}})).status,200)
  const rows=(await(await f.request('/api/audit',admin)).json()).items.filter(e=>e.reference===ticketNo)
  assert.equal(rows.find(e=>e.action==='人工报告').org,null)
  assert.equal(rows.find(e=>e.action==='开始处置').org,'平台运营组')
  const guarded=ledger(f.dir,'reported-events',()=>({org:'伪造组织'}))
  const current=guarded.get(ticketNo)
  assert.throws(()=>guarded.put(ticketNo,{...current,history:current.history.map((h,i)=>i? h:{...h,org:'伪造组织'})}),e=>e.code==='AUDIT_HISTORY_IMMUTABLE')
  guarded.close()
})

test('并发不同登录身份的审计快照互不串用，客户端组织和角色字段无效',async t=>{
  const f=await fixture(t,{multiRoles:true}),admin=await f.login('li.qiang'),userMode=await f.login('chen.yu','user'),adminMode=await f.login('chen.yu','admin')
  const requests=[]
  for(let i=0;i<6;i++)for(const [role,cookie] of [['user',userMode],['admin',adminMode]])requests.push(f.request('/api/events',cookie,{
    ticketNo:'EVT-01-concurrent-'+role+'-'+i,resourceId:'plugin',objectType:'插件',facts:'并发身份',org:'伪造组织',actorRole:'system'}))
  assert.ok((await Promise.all(requests)).every(r=>r.status===201))
  const rows=(await(await f.request('/api/audit',admin)).json()).items.filter(e=>e.reference.startsWith('EVT-01-concurrent-'))
  assert.equal(rows.length,12)
  for(const row of rows){assert.equal(row.org,'业务一部');assert.equal(row.actorSource,'session_snapshot');assert.equal(row.actorRole,row.reference.includes('-user-')?'user':'admin')}
})

test('改名后上传件重试按稳定人员去重，扫描与证据沿用本人归属且不使用旧账户凭据',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang'),user=await f.login('chen.yu'),other=await f.login('zhou.min')
  const first=await f.upload(user);assert.equal(first.status,202)
  const intake=await first.json()
  const evidence=await(await f.uploadEvidence(user)).json()
  assert.equal(evidence.ownerSubjectId,'person-chen-yu')
  assert.equal((await f.request('/api/evidence/'+evidence.evidenceId+'/file',other)).status,404)
  const rename=f.input('ACC-02','upload-owner')
  await f.request('/api/account-applications',admin,rename)
  const row=await(await f.act(rename.ticketNo,admin,'批准')).json()
  assert.equal((await f.commit(row.command.executionId,f.commitBody(rename.subjectId))).status,200)
  const renamed=await f.login('chen.new')
  await f.restart()
  assert.equal((await f.request('/api/intake/skill/'+intake.intakeId,user)).status,403)
  const scan=await f.request('/api/intake/skill/'+intake.intakeId,renamed)
  assert.equal(scan.status,200)
  assert.equal((await scan.json()).scan.findings,undefined)
  const repeat=await f.upload(renamed)
  assert.equal(repeat.status,202);assert.equal((await repeat.json()).intakeId,intake.intakeId)
  assert.equal(f.uploads.size,1)
  assert.equal((await f.upload(renamed,'changed')).status,409)
  assert.equal(f.uploadRequests.at(-1).account,'chen.new')
  assert.equal(f.uploadRequests.at(-1).subjectId,'person-chen-yu')
  assert.equal((await f.request('/api/intake/skill/'+intake.intakeId,other)).status,404)
  const another=await(await f.upload(other)).json()
  assert.notEqual(another.intakeId,intake.intakeId)
  assert.equal(f.uploadRequests.at(-1).subjectId,'person-zhou-min')
  const proof=await f.request('/api/evidence/'+evidence.evidenceId+'/file',renamed)
  assert.equal(proof.status,200);assert.equal(await proof.text(),'proof-bytes')
  const input={ticketNo:'KB-05-renamed-proof',ticketType:'KB-05',resourceId:'kb',fields:{target:'整库',documentIds:[],reason:'内容违规',facts:'本人证据',evidenceIds:[evidence.evidenceId]}}
  assert.equal((await f.request('/api/applications',other,input)).status,403)
  const submitted=await f.request('/api/applications',renamed,input)
  assert.equal(submitted.status,201)
  assert.equal((await submitted.json()).evidenceRefs[0].evidenceId,evidence.evidenceId)
})

async function startDownload(f,user,suffix) {
  const ticketNo='SKL-03-'+suffix
  const r=await f.request('/api/tickets',user,{ticketNo,ticketType:'SKL-03',action:'download',account:'chen.yu',resourceId:'skill'})
  assert.equal(r.status,200)
  return {ticketNo,...await r.json()}
}
async function changeDownloadOwner(f,admin,suffix,fields={newAccount:'chen.files'}) {
  const type=fields.operation?'ACC-01':'ACC-02',input=f.input(type,suffix,'person-chen-yu',fields)
  assert.equal((await f.request('/api/account-applications',admin,input)).status,201)
  const row=await(await f.act(input.ticketNo,admin,'批准')).json()
  assert.equal((await f.commit(row.command.executionId,f.commitBody(input.subjectId))).status,200)
}

test('改名后历史文件领取和回执使用当前身份，重复领取不重复计数',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang'),user=await f.login('chen.yu'),other=await f.login('zhou.min')
  const download=await startDownload(f,user,'renamed-file')
  await changeDownloadOwner(f,admin,'rename-file-owner')
  const renamed=await f.login('chen.files')
  assert.equal((await f.request('/api/tickets/'+download.ticketNo+'/file',user)).status,404)
  assert.equal((await f.request('/api/tickets/'+download.ticketNo+'/file',other)).status,404)
  const file=await f.request('/api/tickets/'+download.ticketNo+'/file',renamed)
  assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),f.downloadBytes)
  await f.until(()=>f.deliveryStats.confirmed===1)
  assert.equal(f.fileRequests[0].account,'chen.files');assert.equal(f.fileRequests[0].subjectId,'person-chen-yu')
  assert.equal(f.receiptRequests[0].account,'chen.files')
  const again=await f.request('/api/tickets/'+download.ticketNo+'/file',renamed)
  assert.equal(again.status,200);await again.arrayBuffer()
  assert.equal(f.deliveryStats.confirmed,1)
  assert.equal(f.commands.filter(c=>c.action==='download').length,1)
})

test('文件拉取期间身份变化则阻止发送，不产生交付回执；新身份重新核对后可领取',async t=>{
  const f=await fixture(t,{holdFile:true}),admin=await f.login('li.qiang'),user=await f.login('chen.yu')
  const download=await startDownload(f,user,'identity-race')
  const pending=f.request('/api/tickets/'+download.ticketNo+'/file',user)
  await f.until(()=>f.fileRequests.length===1)
  await changeDownloadOwner(f,admin,'rename-during-file')
  f.releaseFiles()
  const rejected=await pending
  assert.equal(rejected.status,403)
  assert.equal((await rejected.json()).error.code,'DELIVERY_IDENTITY_CHANGED')
  assert.equal(f.receiptRequests.length,0)
  const renamed=await f.login('chen.files')
  const retry=await f.request('/api/tickets/'+download.ticketNo+'/file',renamed)
  assert.equal(retry.status,200);await retry.arrayBuffer()
  await f.until(()=>f.deliveryStats.confirmed===1)
})

test('历史执行丢失不能用旧身份重建，组织变化后旧文件仍须通过当前下载范围',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang'),user=await f.login('chen.yu')
  const download=await startDownload(f,user,'lost-execution')
  const oldExecution=f.commands.find(c=>c.action==='download').executionId
  await changeDownloadOwner(f,admin,'rename-lost-execution');f.forgetExecution(oldExecution)
  const renamed=await f.login('chen.files')
  const denied=await f.request('/api/tickets/'+download.ticketNo+'/file',renamed)
  assert.equal(denied.status,409);assert.equal((await denied.json()).error.code,'EXECUTION_IDENTITY_CHANGED')
  assert.equal(f.commands.filter(c=>c.action==='download').length,1)
  const scoped=await fixture(t,{downloadOrgs:['业务一部']}),admin2=await scoped.login('li.qiang'),user2=await scoped.login('chen.yu')
  const original=await startDownload(scoped,user2,'scope-change')
  await changeDownloadOwner(scoped,admin2,'change-org-for-file',{operation:'组织变更',org:'平台运营组',businessLine:'平台运营'})
  const moved=await scoped.login('chen.yu')
  assert.equal((await scoped.request('/api/tickets/'+original.ticketNo+'/file',moved)).status,403)
  assert.equal(scoped.fileRequests.length,0)
  assert.equal(scoped.deliveryStats.confirmed,0)
})

test('已经发送的文件在改名或停用后仍可按原流水恢复回执，只结算一次且不开放新读取',async t=>{
  for(const operation of ['改名','停用']) {
    const f=await fixture(t),admin=await f.login('li.qiang'),user=await f.login('chen.yu')
    f.rejectReceipts(true)
    const download=await startDownload(f,user,'pending-receipt-'+(operation==='改名'?'rename':'disable'))
    const file=await f.request('/api/tickets/'+download.ticketNo+'/file',user)
    assert.equal(file.status,200);await file.arrayBuffer()
    await f.until(()=>f.receiptRequests.length>0)
    await changeDownloadOwner(f,admin,'pending-'+(operation==='改名'?'rename':'disable'),operation==='改名'?{newAccount:'chen.files'}:{operation:'停用'})
    f.rejectReceipts(false);await f.restart()
    await f.until(()=>f.deliveryStats.confirmed===1)
    assert.equal(f.receiptRequests.at(-1).account,operation==='改名'?'chen.files':'chen.yu')
    assert.equal(f.receiptRequests.at(-1).mode,'server-settlement')
    assert.equal((await f.request('/api/tickets/'+download.ticketNo+'/file',user)).status,404)
    assert.equal(f.commands.filter(c=>c.action==='download').length,1)
  }
})

test('旧匿名交付在身份变化后须同时证明原浏览器会话与当前本人身份',async t=>{
  const f=await fixture(t),admin=await f.login('li.qiang'),other=await f.login('zhou.min')
  const r=await f.request('/api/tickets','',{ticketNo:'SKL-03-anonymous-owner',ticketType:'SKL-03',action:'download',account:'chen.yu',resourceId:'skill'})
  assert.equal(r.status,200)
  const originalSession=r.headers.get('set-cookie').split(';')[0]
  await changeDownloadOwner(f,admin,'rename-anonymous-owner')
  const current=await f.login('chen.files')
  const file='/api/tickets/SKL-03-anonymous-owner/file'
  assert.equal((await f.request(file,originalSession)).status,404)
  assert.equal((await f.request(file,current)).status,404)
  assert.equal((await f.request(file,originalSession+'; '+other)).status,404)
  const owned=await f.request(file,originalSession+'; '+current)
  assert.equal(owned.status,200);assert.deepEqual(Buffer.from(await owned.arrayBuffer()),f.downloadBytes)
  await f.until(()=>f.deliveryStats.confirmed===1)
})
