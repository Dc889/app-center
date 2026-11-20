import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../management/app/server/service.mjs'
import {json,listen,body,ledger} from '../../runtime/http.mjs'
import {mockDownload} from '../support/execution-state.mjs'

async function fixture(t,{hold=false,loseResponse=false}={}) {
  const dir=await mkdtemp(join(tmpdir(),'application-drafts-')),states=new Map(),commands=[]
  let reads=0,release,entered
  const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve})
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/resources/')) {
      reads++;entered();if(hold)await gate
      return json(res,{snapshotId:'trusted',resourceId:'app',workspaceId:'ws',data:{publicationVersionId:'pub',catalogRevision:0,dependencies:[]}})
    }
    if(path.endsWith('/catalog'))return json(res,{items:[{resourceId:'skill',status:'available',actions:['download'],data:{version:'1',sha256:'a'.repeat(64)}}],nextCursor:null})
    if(path.endsWith('/executions') && req.method==='POST') {
      const command=await body(req);commands.push(command)
      const state=mockDownload(command,'DL-'+command.executionId,{sizeBytes:0});states.set(command.executionId,state)
      if(loseResponse){loseResponse=false;return json(res,{error:{code:'RESPONSE_LOST'}},503)}
      return json(res,state)
    }
    return states.has(path.split('/').at(-1))?json(res,states.get(path.split('/').at(-1))):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const options={dir,token:'test',executor:capability.url},apis=[]
  let api=await startManagement(options);apis.push(api)
  t.after(async()=>{release();for(const a of apis)await a.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie='',data,base=api.url)=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{cookie,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)})
  async function login(account){return (await request('/api/demo-session','',{account})).headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min'),admin=await login('li.qiang')
  const list=async(cookie=user)=>(await(await request('/api/drafts',cookie)).json()).items
  const save=(type='EVT-01',fields={},draftId='draft-main',revision=0,cookie=user)=>request('/api/drafts',cookie,{draftId,revision,ticketType:type,fields})
  const event=(draft,extra={})=>({ticketNo:'EVT-01-from-draft',resourceId:'plugin',objectType:'插件',facts:'真实故障待研判',draft:{draftId:draft.draftId,revision:draft.revision},...extra})
  return {dir,request,user,ops,admin,list,save,event,release,started,commands,reads:()=>reads,
    async second(){const a=await startManagement(options);apis.push(a);return a.url},
    async restart(){await api.close();apis.splice(apis.indexOf(api),1);api=await startManagement(options);apis.push(api)},
  }
}

test('草稿只存人工编辑白名单，系统转单/凭证/快照/无时区时间被拒绝且零能力调用',async t=>{
  const f=await fixture(t)
  for(const type of ['KB-04','PLG-04','UNKNOWN'])assert.equal((await f.save(type)).status,400)
  assert.equal((await f.save('ACC-01',{},'admin-only')).status,403)
  for(const fields of [{secret:'DO-NOT-SAVE'},{snapshot:'DO-NOT-SAVE'},{token:'DO-NOT-SAVE'},{reason:'wrong'}])
    assert.equal((await f.save('EVT-01',fields)).status,400)
  assert.equal((await f.save('PLG-01',{network:[{domain:'example',password:'DO-NOT-SAVE'}]})).status,400)
  assert.equal((await f.save('KEY-02',{effectiveAt:'2026-11-18T12:00'})).status,400)
  assert.equal((await f.save('KEY-02',{effectiveAt:'2026-11-18T12:00:00Z'})).status,200)
  assert.equal(f.reads(),0);assert.equal(f.commands.length,0)
  const db=ledger(f.dir,'application-drafts');assert.equal(JSON.stringify(db.all()).includes('DO-NOT-SAVE'),false);db.close()
})

test('事件草稿提交持久绑定来源，归档不可编辑，精确重放只对应原工单',async t=>{
  const f=await fixture(t),draft=await(await f.save('EVT-01',{resourceId:'plugin',facts:'未完成'})).json(),input=f.event(draft)
  const r=await f.request('/api/events',f.user,input);assert.equal(r.status,201)
  const event=await r.json();assert.equal(event.originDraft.draftId,draft.draftId)
  const archived=(await f.list())[0]
  assert.equal(archived.status,'submitted');assert.equal(archived.canRestore,false)
  assert.equal(archived.ownerSubjectId,'person-chen-yu');assert.equal(archived.submission.ticketNo,input.ticketNo)
  assert.equal((await f.save('EVT-01',{},draft.draftId,archived.revision)).status,409)
  assert.equal((await f.request('/api/drafts/restore',f.user,{draftId:draft.draftId,revision:archived.revision})).status,409)
  assert.equal((await f.request('/api/events',f.user,input)).status,200)
  assert.equal((await f.request('/api/events',f.user,{...input,facts:'更改正文'})).status,409)
  assert.equal((await f.request('/api/events',f.ops,input)).status,404)
  assert.equal((await(await f.request('/api/events?view=mine',f.user)).json()).items.length,1)
  await f.restart();assert.equal((await f.list())[0].status,'submitted')
  const audit=(await(await f.request('/api/audit',f.admin)).json()).items
  assert.ok(audit.some(e=>e.source==='申请草稿' && e.action==='草稿归档关联工单'))
})

test('未受理校验失败恢复为可编辑草稿，旧修订不能继续覆盖',async t=>{
  const f=await fixture(t),draft=await(await f.save()).json()
  const invalid=f.event(draft,{facts:''})
  assert.equal((await f.request('/api/events',f.user,invalid)).status,400)
  const restored=(await f.list())[0]
  assert.equal(restored.status,'draft');assert.equal(restored.submission,null)
  assert.ok(restored.revision>draft.revision)
  assert.equal((await f.save('EVT-01',{},draft.draftId,draft.revision)).status,409)
  assert.equal((await f.request('/api/drafts/restore',f.user,{draftId:draft.draftId,revision:restored.revision})).status,200)
  const saved=await(await f.save('EVT-01',{facts:'补充事实'},draft.draftId,restored.revision)).json()
  assert.equal((await f.request('/api/events',f.user,f.event(saved))).status,201)
})

test('工单已落库但执行接单响应丢失时仍归档，重试不新增执行',async t=>{
  const f=await fixture(t,{loseResponse:true}),draft=await(await f.save('SKL-03',{resourceId:'skill'})).json()
  const input={ticketNo:'SKL-03-draft-lost',ticketType:'SKL-03',action:'download',resourceId:'skill',account:'chen.yu',draft:{draftId:draft.draftId,revision:draft.revision}}
  assert.equal((await f.request('/api/tickets',f.user,input)).status,503)
  const archived=(await f.list())[0]
  assert.equal(archived.status,'submitted');assert.equal(archived.submission.ticketNo,input.ticketNo)
  await f.restart()
  assert.equal((await f.request('/api/tickets',f.user,input)).status,200)
  assert.equal(f.commands.length,1)
})

test('跨服务实例并发提交同草稿只允许一条预检链路，崩溃窗口可按来源证据归档',async t=>{
  const f=await fixture(t,{hold:true}),draft=await(await f.save('AG-02',{resourceId:'app',workspaceId:'ws',scenario:'业务发布'})).json()
  const input={ticketNo:'AG-02-draft-concurrent',ticketType:'AG-02',resourceId:'app',workspaceId:'ws',fields:{scenario:'业务',instructions:'说明',
    businessLine:'业务',classification:'内部',scope:'all',boundaryOrgs:['业务一部'],targetOrgs:[],targetAccounts:[],usages:['run']},draft:{draftId:draft.draftId,revision:draft.revision}}
  const pending=f.request('/api/applications',f.user,input)
  await Promise.race([f.started,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('未进入资源预检')),5000);timer.unref()})])
  const inFlight=(await f.list())[0]
  assert.equal(inFlight.status,'submitting')
  assert.equal(inFlight.canRecover,false)
  assert.equal((await f.request('/api/drafts/recover',f.user,{draftId:draft.draftId,revision:inFlight.revision})).status,409)
  const second=await f.second()
  const duplicate=await f.request('/api/applications',f.user,input,second)
  assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).error.code,'DRAFT_SUBMISSION_BUSY')
  assert.equal((await f.save('AG-02',{},draft.draftId,inFlight.revision)).status,409)
  f.release();assert.equal((await pending).status,201)
  assert.equal(f.reads(),1);assert.equal((await f.list())[0].status,'submitted')
  // Restore the exact pre-archive draft snapshot while retaining the accepted ticket,
  // modelling a process crash between the two durable database writes.
  const db=ledger(f.dir,'application-drafts');db.put(draft.draftId,inFlight);db.close()
  await f.restart()
  assert.equal((await f.list())[0].status,'submitted')
})

test('类型停用或版本变化阻止恢复旧草稿，其他人的草稿不可读取或提交',async t=>{
  const f=await fixture(t),draft=await(await f.save()).json()
  assert.equal((await f.request('/api/drafts/restore',f.ops,{draftId:draft.draftId,revision:draft.revision})).status,404)
  const type=await(await f.request('/api/types/draft',f.admin,{code:'EVT-01',version:'1',name:'事件',workspaceId:'',revision:0})).json()
  const published=await(await f.request('/api/types/publish',f.admin,type)).json()
  assert.equal((await f.request('/api/types/disable',f.admin,published)).status,200)
  const items=await f.list()
  assert.equal(items[0].canRestore,false);assert.equal(items[0].restoreBlockedCode,'TYPE_DISABLED')
  assert.equal((await f.request('/api/drafts/restore',f.user,{draftId:draft.draftId,revision:draft.revision})).status,409)
  assert.equal((await f.request('/api/events',f.user,f.event(draft))).status,409)
  const next=await(await f.request('/api/types/draft',f.admin,{code:'EVT-01',version:'2',name:'新版事件',workspaceId:'',revision:0})).json()
  assert.equal((await f.request('/api/types/publish',f.admin,next)).status,200)
  assert.equal((await f.list())[0].restoreBlockedCode,'DRAFT_TYPE_VERSION_CHANGED')
  assert.equal((await f.save('EVT-01',{},draft.draftId,draft.revision)).status,409)
})

test('已无活动处理且没有受理工单的提交草稿可恢复，已受理草稿不能借恢复重复创建',async t=>{
  const f=await fixture(t),saved=await(await f.save()).json()
  const db=ledger(f.dir,'application-drafts')
  db.put(saved.draftId,{...saved,status:'submitting',revision:2,submission:{ticketNo:'EVT-01-not-accepted',path:'/api/events',hash:'a'.repeat(64),
    sourceRevision:1,claimId:'terminated-request',processId:process.pid}});db.close()
  await f.restart()
  assert.equal((await f.list())[0].canRecover,true)
  const r=await f.request('/api/drafts/recover',f.user,{draftId:saved.draftId,revision:2})
  assert.equal(r.status,200);const recovered=await r.json();assert.equal(recovered.status,'draft')
  assert.equal((await f.request('/api/events',f.user,f.event(recovered))).status,201)
  const archived=(await f.list())[0]
  assert.equal((await f.request('/api/drafts/recover',f.user,{draftId:saved.draftId,revision:archived.revision})).status,409)
})
