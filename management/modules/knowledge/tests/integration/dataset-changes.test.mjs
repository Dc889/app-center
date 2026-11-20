import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {body,json,listen} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'

async function fixture(t,{owner='chen.yu',reject=false,paused=false,mismatch=false,pauseBumps=false}={}) {
  const dir=await mkdtemp(join(tmpdir(),'dataset-changes-'))
  const states=new Map(),commands=[]
  let revision=1,contentRevision=1,linkAvailable=!reject
  const changes=[{documentId:'new',name:'新增文件',changeType:'新增',sha256:'a'.repeat(64),autoVerdict:'通过'},
    {documentId:'changed',name:'变更文件',changeType:'修改',sha256:'b'.repeat(64),autoVerdict:reject?'不通过':'通过'},
    {documentId:'deleted',name:'删除文件',changeType:'删除',sha256:'c'.repeat(64)}]
  const capability=await listen(async(req,res,path)=>{
    const query=new URL(req.url,'http://localhost').searchParams
    if(path.includes('/execution-contexts/KB-04'))return json(res,{snapshotId:'review-'+revision,ticketType:'KB-04',action:'review_dataset_changes',resourceId:'kb',
      fields:{'变更事件ID':query.get('sourceEventId'),'所有者账户名':owner,'来源系统':'Dify','源知识库ID':'source-kb','workspace/tenant ID':'ws',
        '知识库名称':'测试知识库','上次快照ID':'old','当前快照ID':'new-'+contentRevision,'文档清单快照ID':'manifest',
        '处置证据事件ID':'proof-'+query.get('sourceEventId'),'人工处置证据事件ID':'manual-proof-'+query.get('sourceEventId'),'原目录状态':paused?'暂停分享':'已发布',
        '新增文档数':changes.filter(d=>d.changeType==='新增').length,'变更文档数':changes.filter(d=>d.changeType==='修改').length,
        '删除文档数':changes.filter(d=>d.changeType==='删除').length,'变更明细':changes,rawBody:'PRIVATE-DOCUMENT-TEXT'},
      preconditions:[{kind:'dataset',id:'kb',revision},{kind:'dataset_manifest',id:'manifest',sha256:'d'.repeat(64)}]})
    if(path.includes('/execution-contexts/KB-05')) {
      if(!linkAvailable)return json(res,{error:{code:'TRY_LATER'}},503)
      return json(res,{snapshotId:'disposition',ticketType:'KB-05',action:query.get('action'),resourceId:'kb',eligible:true,fields:{
        '知识库名称':'知识库','源workspace/tenant ID':'ws','来源系统':'Dify','源知识库ID':'source-kb','文档清单快照ID':'manifest','清单完整':true,
        '文档清单':changes.filter(d=>d.changeType!=='删除').map(d=>({documentId:d.documentId,sha256:d.sha256})),
        '影响中的授权数':2,'影响中的智能体数':1,'处置目标清单':[{system:'平台',objectId:'kb',action:'暂停分享'},
          ...changes.filter(d=>d.changeType!=='删除').map(d=>({system:'Dify',objectId:d.documentId,documentId:d.documentId,action:'停用文档'}))],
        '告警ID':query.get('sourceEventId'),'告警证据':[{evidenceId:'proof',sha256:'e'.repeat(64)}]},
        preconditions:[{kind:'dataset',id:'kb',revision},{kind:'dataset_manifest',id:'manifest',sha256:'d'.repeat(64)}]})
    }
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req);commands.push(command)
      if(pauseBumps && command.action==='pause_share'){revision++;paused=true}
      const approved=await(await fetch(api.url+'/internal/v1/approved-inputs/'+command.executionId,{headers:{authorization:'Bearer test'}})).json()
      const state=mockExecution(command,{status:'succeeded',result:{resultId:'updated',details:{values:{'新目录状态':mismatch?'保持发布':approved.fields['新目录状态'] ?? '暂停分享'}}}})
      states.set(command.executionId,state);return json(res,state)
    }
    const state=states.get(path.split('/').at(-1))
    return state?json(res,typeof state==='function'?await state():state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const options={dir,token:'test',executor:capability.url}
  let api=await startManagement(options)
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie='',data,internal=false)=>fetch(api.url+path,{method:data===undefined?'GET':'POST',headers:{
    cookie,'content-type':'application/json',...(internal?{authorization:'Bearer test'}:{})},body:data===undefined?undefined:JSON.stringify(data)})
  async function login(account){return (await request('/api/demo-session','',{account})).headers.get('set-cookie').split(';')[0]}
  async function row(ticketNo,cookie,view='query') {
    const r=await request('/api/applications?view='+view,cookie)
    assert.equal(r.status,200)
    return (await r.json()).items.find(v=>v.ticketNo===ticketNo)
  }
  async function until(predicate) {
    const deadline=Date.now()+7000
    while(Date.now()<deadline){const v=await predicate();if(v)return v;await new Promise(resolve=>setTimeout(resolve,50))}
    assert.fail('工作流未达到预期状态')
  }
  return {commands,changes,request,login,row,until,setExecution(id,value){if(value)states.set(id,value);else states.delete(id)},revise(){revision++;contentRevision++},available(){linkAvailable=true},
    async restart(){await api.close();api=await startManagement(options)}}
}
const confirmations=[{documentId:'new',sha256:'a'.repeat(64),verdict:'通过'},{documentId:'changed',sha256:'b'.repeat(64),verdict:'通过'}]

test('KB-04 系统起草由所有者补正提交，逐文档复核与分页回调绑定冻结版本',async t=>{
  const f=await fixture(t),user=await f.login('chen.yu'),ops=await f.login('zhou.min'),admin=await f.login('li.qiang')
  const event={sourceEventId:'change-1',resourceId:'kb'}
  assert.equal((await f.request('/internal/v1/dataset-changes',user,event)).status,403)
  assert.equal((await f.request('/api/applications',user,{ticketNo:'KB-04-manual',ticketType:'KB-04',resourceId:'kb',workspaceId:'ws',fields:{}})).status,400)
  const r=await f.request('/internal/v1/dataset-changes','',event,true)
  assert.equal(r.status,201)
  let row=await r.json()
  assert.equal(row.status,'待所有者提交')
  assert.equal(JSON.stringify(row).includes('PRIVATE-DOCUMENT-TEXT'),false)
  assert.equal((await f.request('/internal/v1/dataset-changes','',event,true)).status,201)
  assert.equal((await f.request('/internal/v1/dataset-changes','',{...event,resourceId:'other'},true)).status,409)
  assert.equal((await f.row(row.ticketNo,user,'mine')).account,'chen.yu')
  assert.equal((await f.row(row.ticketNo,ops,'mine')),undefined)
  const transition=(cookie,action,note='业务内容更新',extra={})=>f.request('/api/applications/transition',cookie,{ticketNo:row.ticketNo,revision:row.revision,action,note,...extra})
  assert.equal((await transition(admin,'提交变更审查')).status,403)
  assert.equal((await transition(user,'提交变更审查','')).status,400)
  row=await(await transition(user,'提交变更审查')).json()
  assert.equal(row.status,'待受理');assert.equal(f.commands.length,0)
  row=await(await transition(ops,'退回补正','请补充变更背景')).json()
  assert.equal(row.status,'待补正')
  row=await(await transition(user,'提交变更审查','新增业务内容')).json()
  assert.equal((await transition(ops,'批准')).status,400)
  assert.equal((await transition(admin,'确认审查','核对',{reviewVerdict:'通过',confirmations})).status,403)
  assert.equal((await transition(ops,'确认审查','核对',{reviewVerdict:'通过',confirmations:[]})).status,400)
  assert.equal((await transition(ops,'确认审查','核对',{reviewVerdict:'通过',confirmations:[{...confirmations[0],sha256:'f'.repeat(64)},confirmations[1]]})).status,400)
  row=await(await transition(ops,'确认审查','逐文档通过',{reviewVerdict:'通过',confirmations})).json()
  assert.equal(row.approvedFields['新目录状态'],'保持发布')
  assert.equal(row.approvedFields['变更明细'].length,3)
  assert.equal(row.approvedFields['文档确认记录'].length,2)
  assert.equal(row.approvedFields['变更原因'],'新增业务内容')
  const executionId=row.command.executionId
  const path='/internal/v1/approved-inputs/'+executionId+'/documents'
  assert.equal((await f.request(path,user)).status,403)
  const first=await(await f.request(path+'?limit=1','',undefined,true)).json()
  assert.equal(first.snapshotId,'manifest');assert.equal(first.items[0].verdict,'pass');assert.equal(first.nextCursor,'1')
  const last=await(await f.request(path+'?limit=1&cursor=1','',undefined,true)).json()
  assert.equal(last.nextCursor,null);assert.equal(last.items[0].documentId,'changed')
  assert.equal((await f.request(path+'?cursor=-1','',undefined,true)).status,400)
  assert.equal((await f.request(path+'?limit=101','',undefined,true)).status,400)
  row=await f.until(async()=>{const v=await f.row(row.ticketNo,ops);return v.status==='待结果确认' && v})
  row=await(await transition(user,'确认结果','已核对')).json()
  assert.equal(row.status,'已完成')
  await f.restart()
  assert.deepEqual(await(await f.request(path+'?limit=1','',undefined,true)).json(),first)
})

test('KB-04 自动不通过持久关联KB-05，重启补投且不能确认成通过',async t=>{
  const f=await fixture(t,{reject:true}),user=await f.login('chen.yu'),ops=await f.login('zhou.min')
  let row=await(await f.request('/internal/v1/dataset-changes','',{sourceEventId:'unsafe-change',resourceId:'kb'},true)).json()
  row=await f.until(async()=>{const v=await f.row(row.ticketNo,user,'mine');return v.linkError && v})
  assert.ok(row.pendingDisposition)
  row=await(await f.request('/api/applications/transition',user,{ticketNo:row.ticketNo,revision:row.revision,action:'提交变更审查',note:'已补充背景'})).json()
  const review={ticketNo:row.ticketNo,revision:row.revision,action:'确认审查',note:'正文自动审查失败',reviewVerdict:'通过',confirmations}
  assert.equal((await f.request('/api/applications/transition',ops,review)).status,400)
  const rejected=[confirmations[0],{...confirmations[1],verdict:'不通过'}]
  row=await(await f.request('/api/applications/transition',ops,{...review,reviewVerdict:'不通过',confirmations:rejected})).json()
  assert.equal(row.approvedFields['新目录状态'],'暂停分享')
  f.available();await f.restart()
  row=await f.until(async()=>{const v=await f.row(row.ticketNo,user,'mine');return v.linkedDispositionTicketNo && v})
  const linked=await f.until(async()=>{const v=await f.row(row.linkedDispositionTicketNo,ops);return v?.status==='待运维确认' && v})
  assert.deepEqual(linked.submission.fields.documentIds,['changed'])
  assert.ok(linked.relatedTicketNos.includes(row.ticketNo))
  assert.equal(f.commands.filter(c=>c.action==='pause_share').length,1)
  assert.equal(f.commands.filter(c=>c.action==='review_dataset_changes').length,1)
  const page=await(await f.request('/internal/v1/approved-inputs/'+row.command.executionId+'/documents','',undefined,true)).json()
  assert.equal(page.items.find(d=>d.documentId==='changed').verdict,'reject')
  await f.request('/internal/v1/dataset-changes','',{sourceEventId:'unsafe-change',resourceId:'kb'},true)
  assert.equal(f.commands.length,2)
})

test('KB-04 管理员本人也能提交，快照变化阻止沿用旧复核，纯删除不继承已删除文档结论',async t=>{
  const f=await fixture(t,{owner:'li.qiang'}),admin=await f.login('li.qiang'),ops=await f.login('zhou.min')
  let row=await(await f.request('/internal/v1/dataset-changes','',{sourceEventId:'admin-change',resourceId:'kb'},true)).json()
  row=await(await f.request('/api/applications/transition',admin,{ticketNo:row.ticketNo,revision:row.revision,action:'提交变更审查',note:'本人更新'})).json()
  f.revise()
  assert.equal((await f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'确认审查',note:'不能复用旧版本',reviewVerdict:'通过',confirmations})).status,409)
  f.changes.splice(0,2)
  row=await(await f.request('/internal/v1/dataset-changes','',{sourceEventId:'deletion-only',resourceId:'kb'},true)).json()
  row=await(await f.request('/api/applications/transition',admin,{ticketNo:row.ticketNo,revision:row.revision,action:'提交变更审查',note:'仅删除过期内容'})).json()
  const reviewed=await f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'确认审查',note:'核对删除明细',reviewVerdict:'通过',confirmations:[]})
  assert.equal(reviewed.status,200)
  assert.deepEqual((await reviewed.json()).approvedFields['文档确认记录'],[])
})

test('KB-04 复核通过不会恢复原暂停目录，上游错误状态不得进入结果确认',async t=>{
  const f=await fixture(t,{paused:true,mismatch:true}),user=await f.login('chen.yu'),ops=await f.login('zhou.min'),admin=await f.login('li.qiang')
  let row=await(await f.request('/internal/v1/dataset-changes','',{sourceEventId:'paused-change',resourceId:'kb'},true)).json()
  row=await(await f.request('/api/applications/transition',user,{ticketNo:row.ticketNo,revision:row.revision,action:'提交变更审查',note:'更新暂停中的知识库'})).json()
  row=await(await f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'确认审查',note:'通过仅覆盖这份快照',reviewVerdict:'通过',confirmations})).json()
  assert.equal(row.approvedFields['新目录状态'],'暂停分享')
  row=await f.until(async()=>{const v=await f.row(row.ticketNo,ops);return v.deliveryBlocked && v})
  assert.equal(row.lastError.code,'EXECUTION_RESULT_MISMATCH')
  assert.equal(row.status,'执行中')
  assert.equal((await f.request('/api/applications/transition',user,{ticketNo:row.ticketNo,revision:row.revision,action:'确认结果',note:'不能误确认'})).status,409)
  assert.equal(f.commands.length,1)
  const act=(cookie,revision=row.revision)=>f.request('/api/applications/transition',cookie,{ticketNo:row.ticketNo,revision,action:'查证原执行',note:'核对原审查结果'})
  assert.equal((await act(user)).status,403);assert.equal((await act(admin)).status,403)
  assert.ok(await f.row(row.ticketNo,ops,'todo'))
  await act(ops);row=await f.row(row.ticketNo,ops)
  assert.equal(row.deliveryBlocked,true);assert.equal(row.lastError.code,'EXECUTION_RESULT_MISMATCH')
  const executionId=row.command.executionId,frozen=row.approvedFields
  f.setExecution(executionId,null)
  await act(ops);row=await f.row(row.ticketNo,ops)
  assert.equal(row.lastError.code,'NOT_FOUND');assert.equal(row.deliveryBlocked,true)
  await f.restart();await new Promise(resolve=>setTimeout(resolve,2200))
  assert.equal(f.commands.length,1)
  for(const state of [{executionId:'other',status:'running',result:null},{status:'running',result:null},
    {executionId,ticketNo:'wrong',status:'succeeded',result:{}},{executionId,status:'bogus',result:null},
    {executionId,status:'running',result:{resultId:'premature'}}]) {
    f.setExecution(executionId,state);await act(ops);row=await f.row(row.ticketNo,ops)
    assert.equal(row.lastError.code,'EXECUTION_MISMATCH');assert.equal(row.deliveryBlocked,true)
  }
  const stale=row.revision
  f.setExecution(executionId,mockExecution(row.command,{status:'reconciling'}))
  assert.equal((await act(ops)).status,200);row=await f.row(row.ticketNo,ops)
  assert.equal(row.deliveryBlocked,false);assert.equal(row.execution.status,'reconciling')
  assert.equal((await act(ops,stale)).status,409)
  const success=mockExecution(row.command,{status:'succeeded',result:{resultId:'same-execution',details:{values:{'新目录状态':'暂停分享'}}}})
  f.setExecution(executionId,success)
  await act(ops);row=await f.row(row.ticketNo,ops)
  assert.equal(row.status,'待结果确认');assert.deepEqual(row.approvedFields,frozen)
  assert.equal(row.attempts.length,1);assert.deepEqual(row.attempts[0].execution,success)
  f.setExecution(executionId,{executionId,status:'failed',result:{retryable:true}})
  assert.equal((await act(ops)).status,409)
  assert.deepEqual((await f.row(row.ticketNo,ops)).execution,success)
  assert.equal(f.commands.length,1)
  assert.ok(row.history.some(h=>h.action==='查证原执行' && h.previousErrorCode==='EXECUTION_RESULT_MISMATCH'))
})

test('KB-04 原执行查证与并发办理互斥，证明等待期间不重复查询或下发',async t=>{
  const f=await fixture(t,{paused:true,mismatch:true}),user=await f.login('chen.yu'),ops=await f.login('zhou.min')
  let row=await(await f.request('/internal/v1/dataset-changes','',{sourceEventId:'query-concurrent',resourceId:'kb'},true)).json()
  const transition=(action)=>f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action,note:'并发核对'})
  row=await(await f.request('/api/applications/transition',user,{ticketNo:row.ticketNo,revision:row.revision,action:'提交变更审查',note:'内容变化'})).json()
  await f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'确认审查',note:'核对快照',reviewVerdict:'通过',confirmations})
  row=await f.until(async()=>{const r=await f.row(row.ticketNo,ops);return r.deliveryBlocked && r})
  let release,entered
  const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve})
  t.after(()=>release())
  f.setExecution(row.command.executionId,async()=>{entered();await gate;return mockExecution(row.command,{status:'reconciling'})})
  const pending=transition('查证原执行')
  await Promise.race([started,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('未开始查询')),5000);timer.unref()})])
  row=await f.row(row.ticketNo,ops)
  const blocked=await transition('查证原执行')
  assert.equal(blocked.status,409);assert.equal((await blocked.json()).error.code,'EXECUTION_BUSY')
  assert.equal((await transition('重试执行')).status,409)
  release();assert.equal((await pending).status,200)
  assert.equal(f.commands.length,1)
})

test('KB-04 关联暂停更新目录修订后，保持正文依据并冻结新前置条件复核',async t=>{
  const f=await fixture(t,{reject:true,pauseBumps:true}),user=await f.login('chen.yu'),ops=await f.login('zhou.min')
  let row=await(await f.request('/internal/v1/dataset-changes','',{sourceEventId:'pause-revision',resourceId:'kb'},true)).json()
  row=await(await f.request('/api/applications/transition',user,{ticketNo:row.ticketNo,revision:row.revision,action:'提交变更审查',note:'说明本次修改'})).json()
  f.available()
  row=await f.until(async()=>{const v=await f.row(row.ticketNo,user,'mine');if(!v.linkedDispositionTicketNo)return false;
    const target=await f.row(v.linkedDispositionTicketNo,ops);return target.status==='待运维确认' && v})
  const reviewed=await f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'确认审查',note:'复核仍不通过',
    reviewVerdict:'不通过',confirmations:[confirmations[0],{...confirmations[1],verdict:'不通过'}]})
  assert.equal(reviewed.status,200)
  const approved=await reviewed.json()
  assert.equal(approved.preconditions[0].revision,2)
  assert.equal(approved.snapshot.fields['原目录状态'],'暂停分享')
  assert.equal(approved.approvedFields['当前快照ID'],'new-1')
})

test('KB-04 人工新增否决文档另建处置，不改写自动处置的已冻结范围',async t=>{
  const f=await fixture(t,{reject:true}),user=await f.login('chen.yu'),ops=await f.login('zhou.min')
  let row=await(await f.request('/internal/v1/dataset-changes','',{sourceEventId:'extra-rejection',resourceId:'kb'},true)).json()
  row=await f.until(async()=>{const v=await f.row(row.ticketNo,user,'mine');return v.linkError && v})
  row=await(await f.request('/api/applications/transition',user,{ticketNo:row.ticketNo,revision:row.revision,action:'提交变更审查',note:'补充内容变化'})).json()
  const reviewed=await f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'确认审查',note:'人工发现另一个不通过文档',
    reviewVerdict:'不通过',confirmations:confirmations.map(c=>({...c,verdict:'不通过'}))})
  assert.equal(reviewed.status,200)
  row=await reviewed.json()
  assert.deepEqual(row.pendingDisposition.fields.documentIds,['changed'])
  assert.deepEqual(row.pendingReviewDisposition.fields.documentIds,['new'])
  f.available();await f.restart()
  row=await f.until(async()=>{const v=await f.row(row.ticketNo,user,'mine');return v.linkedReviewDispositionTicketNo && v})
  const automatic=await f.row(row.linkedDispositionTicketNo,ops),manual=await f.row(row.linkedReviewDispositionTicketNo,ops)
  assert.deepEqual(automatic.submission.fields.documentIds,['changed'])
  assert.deepEqual(manual.submission.fields.documentIds,['new'])
  assert.notEqual(automatic.sourceEventId,manual.sourceEventId)
  assert.equal(f.commands.filter(c=>c.action==='pause_share').length,2)
})
