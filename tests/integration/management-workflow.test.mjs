import {agentImpact} from '../support/agent-impact.mjs'
import {mockExecution,mockDownload,mockDelivered} from '../support/execution-state.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startManagement } from '../../management/app/server/service.mjs'
import { json, listen, body } from '../../runtime/http.mjs'

async function setup(t) {
  const dir=await mkdtemp(join(tmpdir(),'management-workflow-'))
  const calls=[]
  const branches=[]
  const capability=await listen((req,res,path)=>{
    calls.push(req.url)
    assert.equal(path,'/internal/v1/capabilities')
    json(res,{items:branches,asOf:new Date().toISOString()})
  })
  const options={dir,token:'test',executor:capability.url}
  let api=await startManagement(options)
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie='',data)=>fetch(api.url+path,{method:data?'POST':'GET',
    headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const response=await request('/api/demo-session','',{account})
    assert.equal(response.status,200)
    return response.headers.get('set-cookie').split(';')[0]
  }
  return {branches,calls,request,login,async restart(){await api.close();api=await startManagement(options)}}
}

test('类型发布按工作区核验所有分支，已发布版本持久化且不可覆盖',async t=>{
  const app=await setup(t)
  const admin=await app.login('li.qiang')
  const user=await app.login('chen.yu')
  const draft={code:'KB-03',version:'1',name:'知识库授权',workspaceId:'team-a',revision:0}
  assert.equal((await app.request('/api/types/draft',user,draft)).status,403)
  const saved=await (await app.request('/api/types/draft',admin,draft)).json()
  const publish=()=>app.request('/api/types/publish',admin,saved)
  for (const variant of ['RAGFlow外部知识库','Dify同workspace授权','Dify跨workspace复制']) {
    for(const action of saved.actions) {
      assert.equal((await publish()).status,409)
      app.branches.push({ticketType:'KB-03',ticketTypeVersion:'1',action,variant,state:'verified'})
    }
  }
  assert.equal((await publish()).status,200)
  assert.ok(app.calls.every(path=>path==='/internal/v1/capabilities?workspaceId=team-a'))
  await app.restart()
  const data=await (await app.request('/api/types',admin)).json()
  assert.equal(data.versions[0].status,'published')
  assert.equal((await app.request('/api/types/draft',admin,data.versions[0])).status,409)
})

test('类型复制保留配置但重新核验，组织范围仅限制新申请且重启后不回退旧版本',async t=>{
  const app=await setup(t),admin=await app.login('li.qiang'),user=await app.login('chen.yu'),operator=await app.login('zhou.min')
  const saved=await(await app.request('/api/types/draft',admin,{code:'EVT-01',version:'1',revision:0,name:'事件',workspaceId:'',enabledOrgs:[]})).json()
  const published=await(await app.request('/api/types/publish',admin,saved)).json()
  const event={ticketNo:'EVT-01-before-scope',resourceId:'plugin-42',objectType:'插件',facts:'健康检查失败'}
  assert.equal((await app.request('/api/events',user,event)).status,201)
  const copy={code:'EVT-01',version:'1',revision:published.revision,newVersion:'2'}
  assert.equal((await app.request('/api/types/copy',user,copy)).status,403)
  assert.equal((await app.request('/api/types/copy',admin,{...copy,revision:1})).status,409)
  const copiedResponse=await app.request('/api/types/copy',admin,copy)
  assert.equal(copiedResponse.status,201)
  const copied=await copiedResponse.json()
  assert.equal(copied.status,'draft');assert.equal(copied.revision,1)
  assert.equal(copied.publishedAt,undefined);assert.equal(copied.branches,undefined)
  assert.deepEqual(copied.copiedFrom,{version:'1',revision:published.revision})
  assert.equal((await app.request('/api/types/copy',admin,copy)).status,409)
  assert.equal((await app.request('/api/types/draft',admin,{...copied,enabledOrgs:['伪造组织']})).status,400)
  const scoped=await(await app.request('/api/types/draft',admin,{...copied,enabledOrgs:['平台运营组']})).json()
  assert.equal((await app.request('/api/types/publish',admin,scoped)).status,200)
  await app.restart()
  const registry=await(await app.request('/api/types',admin)).json()
  assert.deepEqual(registry.versions.find(v=>v.version==='1'),published)
  assert.ok(registry.organizations.includes('平台运营组'))
  assert.equal((await app.request('/api/events',user,{...event,ticketNo:'EVT-01-denied',org:'平台运营组'})).status,403)
  assert.equal((await app.request('/api/drafts',user,{draftId:'denied-draft',ticketType:'EVT-01',revision:0,fields:{resourceId:'plugin-42',objectType:'插件',facts:'草稿'}})).status,403)
  const replay=await app.request('/api/events',user,event)
  assert.equal(replay.status,200);assert.equal((await replay.json()).version,'1')
  const accepted=await app.request('/api/events',operator,{...event,ticketNo:'EVT-01-in-scope'})
  assert.equal(accepted.status,201);assert.equal((await accepted.json()).version,'2')
  assert.deepEqual(app.calls,[])
})

test('复制的新版本不能继承旧版本能力核验结果，停用源版本也可复制',async t=>{
  const app=await setup(t),admin=await app.login('li.qiang')
  const saved=await(await app.request('/api/types/draft',admin,{code:'SKL-03',version:'1',revision:0,name:'下载',workspaceId:'team-a',enabledOrgs:['业务一部']})).json()
  app.branches.push({ticketType:'SKL-03',ticketTypeVersion:'1',action:'download',variant:null,state:'verified'})
  const published=await(await app.request('/api/types/publish',admin,saved)).json()
  const disabled=await(await app.request('/api/types/disable',admin,published)).json()
  const copied=await(await app.request('/api/types/copy',admin,{...disabled,newVersion:'2'})).json()
  assert.deepEqual(copied.actions,['download']);assert.equal(copied.workspaceId,'team-a')
  assert.deepEqual(copied.enabledOrgs,['业务一部'])
  assert.equal((await app.request('/api/types/publish',admin,copied)).status,409)
  app.branches.push({ticketType:'SKL-03',ticketTypeVersion:'2',action:'download',variant:null,state:'verified'})
  assert.equal((await app.request('/api/types/publish',admin,copied)).status,200)
})

test('人工事件冻结版本、幂等受理、双人复核且不下发能力命令',async t=>{
  const app=await setup(t)
  const admin=await app.login('li.qiang')
  const user=await app.login('chen.yu')
  const first=await app.login('zhou.min')
  const second=await app.login('wang.ning')
  const draft={code:'EVT-01',version:'2',name:'事件',workspaceId:'',revision:0}
  const saved=await (await app.request('/api/types/draft',admin,draft)).json()
  assert.equal((await app.request('/api/types/publish',admin,saved)).status,200)
  const event={ticketNo:'EVT-01-test',resourceId:'plugin-42',objectType:'插件',facts:'健康检查连续失败'}
  assert.equal((await app.request('/api/events',user,event)).status,201)
  assert.equal((await (await app.request('/api/events',user,event)).json()).version,'2')
  assert.equal((await app.request('/api/events',user,{...event,objectType:'插件',facts:'不同的报告'})).status,409)
  const act=(cookie,revision,action)=>app.request('/api/events/transition',cookie,{ticketNo:event.ticketNo,revision,action,disposition:{actions:['观察'],result:'观察后稳定'},assessment:{severity:'一般',conclusion:'真实故障',cause:'未知',impact:'单个对象'},note:'已核对记录'})
  assert.equal((await act(admin,1,'开始处置')).status,403)
  const invalid=await app.request('/api/events/transition',first,{ticketNo:event.ticketNo,revision:1,action:'开始处置',note:'缺少研判字段'})
  assert.equal(invalid.status,400)
  assert.equal((await act(first,1,'开始处置')).status,200)
  assert.equal((await act(first,1,'提交复核')).status,409)
  const missingResult=await app.request('/api/events/transition',first,{ticketNo:event.ticketNo,revision:2,action:'提交复核',note:'待复核'})
  assert.equal(missingResult.status,400)
  const unexecuted=await app.request('/api/events/transition',first,{ticketNo:event.ticketNo,revision:2,action:'提交复核',note:'尝试禁用',
    disposition:{actions:['禁用插件'],result:'声称完成'}})
  assert.equal(unexecuted.status,409)
  assert.equal((await act(first,2,'提交复核')).status,200)
  assert.equal((await act(first,3,'确认关闭')).status,403)
  await app.restart()
  const closed=await (await act(second,3,'确认关闭')).json()
  assert.equal(closed.status,'已关闭')
  assert.equal(closed.history.length,4)
  assert.equal((await app.request('/api/events?view=query',user)).status,403)
  assert.deepEqual((await (await app.request('/api/events?view=todo',second)).json()).items,[])
  assert.deepEqual(app.calls,[])
})

test('运行中工单在重启后由管理端主动查询终态', async t => {
  const dir=await mkdtemp(join(tmpdir(),'management-running-'))
  let executionReads=0,command
  const capability=await listen(async(req,res,path)=>{
    if(path.endsWith('/catalog')) return json(res,{items:[{resourceId:'skill-1',status:'approved',actions:['download'],data:{version:'1',sha256:'a'.repeat(64)}}]})
    if(req.method==='POST')command=await body(req)
    if(!command)return json(res,{error:{code:'NOT_FOUND'}},404)
    executionReads++
    return json(res,mockExecution(command,{status:executionReads===1?'running':'failed'}))
  })
  const options={dir,token:'test',executor:capability.url}
  let api=await startManagement(options)
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const created=await fetch(api.url+'/api/tickets',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({ticketNo:'SKL-03-running',ticketType:'SKL-03',resourceId:'skill-1',account:'chen.yu',action:'download'})})
  assert.equal((await created.json()).status,'running')
  const cookie=created.headers.get('set-cookie').split(';')[0]
  await api.close()
  api=await startManagement(options)
  const deadline=Date.now()+10000
  let state
  do {
    const response=await fetch(api.url+'/api/tickets?account=chen.yu',{headers:{cookie}})
    state=(await response.json()).items[0].status
    if(state==='failed') break
    await new Promise(resolve=>setTimeout(resolve,150))
  } while(Date.now()<deadline)
  assert.equal(state,'failed')
  assert.equal(executionReads,2)
})

test('同一流水并发领取被拒绝，交付失败后可用原流水重试',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-transfer-'))
  const bytes=Buffer.from('verified skill')
  const {digest}=await import('../../runtime/http.mjs')
  const hash=digest(bytes)
  let release
  let started
  const entered=new Promise(resolve=>{started=resolve})
  const gate=new Promise(resolve=>{release=resolve})
  let attempts=0
  let receipts=0,command
  const capability=await listen(async(req,res,path)=>{
    if(path.endsWith('/catalog')) return json(res,{items:[{resourceId:'skill-1',status:'approved',actions:['download'],data:{version:'1',sha256:hash}}]})
    if(path.endsWith('/receipt')) {receipts++;return json(res,mockDelivered(command,'DL-test'))}
    if(path.includes('/downloads/')) {
      attempts++
      if(attempts===1) {started();await gate;return json(res,{error:{code:'TEMPORARY'}},503)}
      res.writeHead(200,{'content-length':bytes.length,'content-type':'text/plain','content-disposition':'attachment; filename="skill.txt"','x-content-sha256':hash})
      return res.end(bytes)
    }
    if(req.method==='POST')command=await body(req)
    return command?json(res,mockDownload(command,'DL-test',{sizeBytes:bytes.length,filename:'skill.txt'})):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{release();await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const response=await fetch(api.url+'/api/tickets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    ticketNo:'SKL-03-transfer',ticketType:'SKL-03',resourceId:'skill-1',account:'chen.yu',action:'download'})})
  const cookie=response.headers.get('set-cookie').split(';')[0]
  const file=()=>fetch(api.url+'/api/tickets/SKL-03-transfer/file',{headers:{cookie}})
  const first=file()
  await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('未进入模拟文件拉取')),5000).unref())])
  assert.equal((await file()).status,409)
  release()
  assert.equal((await first).status,503)
  const retry=await file()
  assert.equal(retry.status,200)
  assert.equal(digest(Buffer.from(await retry.arrayBuffer())),hash)
  const state=await fetch(api.url+'/api/tickets/SKL-03-transfer',{headers:{cookie}})
  assert.equal((await state.json()).status,'succeeded')
  assert.equal(receipts,1)
  assert.equal(attempts,2)
})

test('客户端断开后不登记成功，新连接使用原流水领取',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-disconnect-'))
  const {digest,ledger}=await import('../../runtime/http.mjs')
  const bytes=Buffer.from('retry after disconnect')
  const hash=digest(bytes)
  let release,entered
  const gate=new Promise(resolve=>{release=resolve})
  const started=new Promise(resolve=>{entered=resolve})
  let files=0,receipts=0,command
  const capability=await listen(async(req,res,path)=>{
    if(path.endsWith('/catalog')) return json(res,{items:[{resourceId:'skill-1',status:'approved',actions:['download'],data:{version:'1',sha256:hash}}]})
    if(path.endsWith('/receipt')) {receipts++;return json(res,mockDelivered(command,'DL-disconnect'))}
    if(path.includes('/downloads/')) {
      if(++files===1) {entered();await gate}
      res.writeHead(200,{'content-length':bytes.length,'content-type':'text/plain','content-disposition':'attachment; filename="skill.txt"','x-content-sha256':hash})
      return res.end(bytes)
    }
    if(req.method==='POST')command=await body(req)
    return command?json(res,mockDownload(command,'DL-disconnect',{sizeBytes:bytes.length,filename:'skill.txt'})):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  const records=ledger(dir,'tickets')
  t.after(async()=>{release();await api.close();await capability.close();records.close();await rm(dir,{recursive:true,force:true})})
  const created=await fetch(api.url+'/api/tickets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    ticketNo:'SKL-03-disconnect',ticketType:'SKL-03',resourceId:'skill-1',account:'chen.yu',action:'download'})})
  const cookie=created.headers.get('set-cookie').split(';')[0]
  const url=api.url+'/api/tickets/SKL-03-disconnect/file'
  const controller=new AbortController()
  const first=fetch(url,{headers:{cookie},signal:controller.signal}).catch(error=>error)
  await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('未进入模拟文件拉取')),5000).unref())])
  controller.abort()
  await first
  const deadline=Date.now()+3000
  while(records.get('SKL-03-disconnect').delivery.status!=='interrupted' && Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,20))
  }
  assert.equal(records.get('SKL-03-disconnect').delivery.status,'interrupted')
  assert.equal(receipts,0)
  const retry=await fetch(url,{headers:{cookie}})
  assert.equal(digest(Buffer.from(await retry.arrayBuffer())),hash)
  release()
  const final=await fetch(api.url+'/api/tickets/SKL-03-disconnect',{headers:{cookie}})
  assert.equal((await final.json()).status,'succeeded')
  assert.equal(receipts,1)
})

test('已发送文件的回执失败后在重启时补交，同流水不重复交付',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-receipt-'))
  const {digest,ledger}=await import('../../runtime/http.mjs')
  const bytes=Buffer.from('receipt survives restart')
  const hash=digest(bytes)
  let accept=false, receipts=0,command
  const capability=await listen(async(req,res,path)=>{
    if(path.endsWith('/catalog')) return json(res,{items:[{resourceId:'skill-1',status:'approved',actions:['download'],data:{version:'1',sha256:hash}}]})
    if(path.endsWith('/receipt')) {
      receipts++
      return accept ? json(res,mockDelivered(command,'DL-receipt')) : json(res,{error:{code:'TEMPORARY'}},503)
    }
    if(path.includes('/downloads/')) {
      res.writeHead(200,{'content-length':bytes.length,'content-type':'text/plain','content-disposition':'attachment; filename="skill.txt"','x-content-sha256':hash})
      return res.end(bytes)
    }
    if(req.method==='POST')command=await body(req)
    return command?json(res,mockDownload(command,'DL-receipt',{sizeBytes:bytes.length,filename:'skill.txt'})):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const options={dir,token:'test',executor:capability.url}
  let api=await startManagement(options)
  const records=ledger(dir,'tickets')
  t.after(async()=>{await api.close();await capability.close();records.close();await rm(dir,{recursive:true,force:true})})
  const created=await fetch(api.url+'/api/tickets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    ticketNo:'SKL-03-receipt',ticketType:'SKL-03',resourceId:'skill-1',account:'chen.yu',action:'download'})})
  const cookie=created.headers.get('set-cookie').split(';')[0]
  const download=await fetch(api.url+'/api/tickets/SKL-03-receipt/file',{headers:{cookie}})
  await download.arrayBuffer()
  assert.ok(records.get('SKL-03-receipt').receipt)
  await api.close()
  accept=true
  api=await startManagement(options)
  const deadline=Date.now()+10000
  while(records.get('SKL-03-receipt').delivery.status!=='confirmed' && Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  const row=records.get('SKL-03-receipt')
  assert.equal(row.state.status,'succeeded')
  assert.equal(row.receipt,null)
  assert.equal(row.delivery.status,'confirmed')
  assert.ok(receipts>=2)
})

test('管理审计保留办理人和类型版本历史，普通用户不可查询',async t=>{
  const app=await setup(t)
  const admin=await app.login('li.qiang')
  const user=await app.login('chen.yu')
  const operator=await app.login('zhou.min')
  const draft={code:'EVT-01',version:'1',name:'事件',workspaceId:'',revision:0}
  const saved=await(await app.request('/api/types/draft',admin,draft)).json()
  await app.request('/api/types/publish',admin,saved)
  const ticketNo='EVT-01-audit'
  await app.request('/api/events',user,{ticketNo,resourceId:'resource-a',objectType:'插件',facts:'报告事件'})
  await app.request('/api/events/transition',operator,{ticketNo,revision:1,action:'开始处置',disposition:{actions:['观察'],result:'观察后稳定'},assessment:{severity:'一般',conclusion:'真实故障',cause:'未知',impact:'单个对象'},note:'核对原始日志'})
  assert.equal((await app.request('/api/audit',user)).status,403)
  await app.restart()
  const entries=(await(await app.request('/api/audit',admin)).json()).items
  assert.equal(entries.length,4)
  assert.ok(entries.some(i=>i.actor==='li.qiang' && i.action==='发布类型版本'))
  assert.ok(entries.some(i=>i.actor==='zhou.min' && i.note==='核对原始日志'))
  assert.ok(entries.every(i=>i.at && i.reference && i.source))
  const scoped=(await(await app.request('/api/audit',operator)).json()).items
  assert.equal(scoped.length,1)
  assert.equal(scoped[0].actor,'zhou.min')
  assert.equal(scoped[0].org,'平台运营组')
})

test('申请草稿按本人隔离，支持重启恢复和版本冲突保护且不触发能力调用',async t=>{
  const app=await setup(t)
  const user=await app.login('chen.yu')
  const other=await app.login('zhou.min')
  const data={draftId:'draft-test',revision:0,ticketType:'EVT-01',fields:{resourceId:'service-1',objectType:'插件',facts:'未填写完的报告'}}
  const response=await app.request('/api/drafts',user,data)
  assert.equal(response.status,200)
  assert.equal((await app.request('/api/drafts',other,data)).status,404)
  assert.equal((await app.request('/api/drafts',user,data)).status,409)
  assert.equal((await app.request('/api/drafts',user,{...data,draftId:'account',ticketType:'ACC-01'})).status,403)
  await app.restart()
  const items=(await(await app.request('/api/drafts',user)).json()).items
  assert.equal(items[0].fields.facts,data.fields.facts)
  assert.equal(items[0].revision,1)
  assert.deepEqual((await(await app.request('/api/drafts',other)).json()).items,[])
  assert.deepEqual(app.calls,[])
})

test('停用类型阻止新事件，既有事件保留版本并可继续办理',async t=>{
  const app=await setup(t)
  const admin=await app.login('li.qiang')
  const user=await app.login('chen.yu')
  const operator=await app.login('zhou.min')
  const draft={code:'EVT-01',version:'1',name:'事件',workspaceId:'',revision:0}
  const saved=await(await app.request('/api/types/draft',admin,draft)).json()
  const published=await(await app.request('/api/types/publish',admin,saved)).json()
  const event={ticketNo:'EVT-01-existing',resourceId:'service-1',objectType:'插件',facts:'故障报告'}
  assert.equal((await app.request('/api/events',user,event)).status,201)
  assert.equal((await app.request('/api/types/disable',operator,published)).status,403)
  const disabled=await(await app.request('/api/types/disable',admin,published)).json()
  assert.equal(disabled.status,'disabled')
  assert.equal((await app.request('/api/types/draft',admin,disabled)).status,409)
  assert.equal((await app.request('/api/types/publish',admin,disabled)).status,409)
  await app.restart()
  assert.equal((await app.request('/api/events',user,{...event,ticketNo:'EVT-01-new'})).status,409)
  assert.equal((await app.request('/api/events',user,event)).status,200)
  const next=await app.request('/api/events/transition',operator,{ticketNo:event.ticketNo,revision:1,action:'开始处置',disposition:{actions:['观察'],result:'观察后稳定'},assessment:{severity:'一般',conclusion:'真实故障',cause:'未知',impact:'单个对象'},note:'继续处置既有事件'})
  assert.equal((await next.json()).version,'1')
})

test('审批资源与快照从服务端会话传递身份，浏览器伪造身份不生效',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-resources-'))
  const requests=[]
  const capability=await listen((req,res,path)=>{
    requests.push({url:req.url,account:req.headers['x-account'],org:req.headers['x-org'],role:req.headers['x-role']})
    return json(res,path.endsWith('/app-1') ? {snapshotId:'snap-1',resourceId:'app-1',data:{catalogRevision:2}} :
      {items:[{resourceId:'app-1',name:'本人应用',source:'dify',workspaceId:'ws-1'}]})
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  assert.equal((await fetch(api.url+'/api/resources?kind=dify_app')).status,403)
  const login=await fetch(api.url+'/api/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'chen.yu'})})
  const cookie=login.headers.get('set-cookie').split(';')[0]
  const headers={cookie,'x-account':'li.qiang','x-role':'admin'}
  const list=await fetch(api.url+'/api/resources?kind=dify_app&workspaceId=ws-1&account=li.qiang',{headers})
  assert.equal((await list.json()).items[0].resourceId,'app-1')
  const snapshot=await fetch(api.url+'/api/resources/dify_app/app-1?workspaceId=ws-1',{headers})
  assert.equal((await snapshot.json()).snapshotId,'snap-1')
  assert.ok(requests.every(r=>r.account==='chen.yu' && r.role==='user' && decodeURIComponent(r.org)==='业务一部'))
  assert.equal(requests[0].url,'/internal/v1/resources?kind=dify_app&workspaceId=ws-1')
  assert.equal((await fetch(api.url+'/api/resources?kind=secret',{headers})).status,400)
})

test('AG-02 受理冻结服务端快照，未批准和驳回均不下发执行',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-publish-'))
  const requests=[]
  const capability=await listen((req,res,path)=>{
    requests.push(path)
    assert.equal(path,'/internal/v1/resources/dify_app/app-1')
    return json(res,{snapshotId:'trusted-snapshot',resourceId:'app-1',workspaceId:'ws-1',data:{publicationVersionId:'pub-1',catalogRevision:7}})
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  async function login(account) {
    const r=await fetch(api.url+'/api/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account})})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),operator=await login('zhou.min'),admin=await login('li.qiang')
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  const input={ticketNo:'AG-02-publish',ticketType:'AG-02',resourceId:'app-1',workspaceId:'ws-1',snapshotId:'forged',
    fields:{scenario:'测试业务',instructions:'使用说明',businessLine:'业务',classification:'内部',scope:'all',boundaryOrgs:['业务一部'],usages:['run']}}
  const result=await request('/api/applications',user,input)
  assert.equal(result.status,201)
  const row=await result.json()
  assert.equal(row.snapshot.snapshotId,'trusted-snapshot')
  assert.equal((await request('/api/applications',user,input)).status,200)
  assert.equal((await(await request('/api/applications?view=todo',operator)).json()).items.length,1)
  assert.equal((await request('/api/applications?view=todo',user)).status,403)
  const reject={ticketNo:row.ticketNo,revision:1,action:'驳回',note:'需要补充业务依据'}
  assert.equal((await request('/api/applications/transition',admin,reject)).status,403)
  assert.equal((await(await request('/api/applications/transition',operator,reject)).json()).status,'已驳回')
  assert.equal((await request('/api/applications/transition',operator,reject)).status,409)
  assert.equal(requests.length,1)
})

test('AG-02 批准原子保存执行，重启沿用原ID补投并由申请人确认结果',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-approved-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  let succeed=false
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/resources/')) return json(res,{snapshotId:'snapshot',resourceId:'app-1',workspaceId:'ws-1',data:{publicationVersionId:'pub-1',catalogRevision:0,dependencies:[]}})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req))
    return succeed ? json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'published-app'}})) : json(res,{error:{code:'TEMPORARY'}},503)
  })
  const options={dir,token:'test',executor:capability.url}
  let api=await startManagement(options)
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const response=await request('/api/demo-session','',{account})
    return response.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),operator=await login('zhou.min')
  const input={ticketNo:'AG-02-approved',ticketType:'AG-02',resourceId:'app-1',workspaceId:'ws-1',
    fields:{scenario:'场景',instructions:'说明',businessLine:'业务',classification:'内部',scope:'all',boundaryOrgs:['业务一部'],usages:['run']}}
  await request('/api/applications',user,input)
  const decision={ticketNo:input.ticketNo,revision:1,action:'批准',note:'已核验'}
  assert.equal((await request('/api/applications/transition',user,decision)).status,403)
  const approved=await(await request('/api/applications/transition',operator,decision)).json()
  assert.equal(approved.command.account,'chen.yu')
  assert.equal((await request('/api/applications/transition',operator,decision)).status,409)
  let deadline=Date.now()+5000
  while(commands.length===0 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  const approvedInputs=await fetch(api.url+'/internal/v1/approved-inputs/'+approved.command.executionId,{headers:{authorization:'Bearer test'}})
  assert.equal((await approvedInputs.json()).fields.expectedRevision,0)
  await api.close()
  succeed=true
  api=await startManagement(options)
  deadline=Date.now()+10000
  let row
  do {
    row=(await(await request('/api/applications?view=mine',user)).json()).items[0]
    if(row.status==='待结果确认')break
    await new Promise(resolve=>setTimeout(resolve,100))
  } while(Date.now()<deadline)
  assert.equal(row.status,'待结果确认')
  assert.equal(commands.length,2)
  assert.deepEqual(commands[0],commands[1])
  const confirm={ticketNo:row.ticketNo,revision:row.revision,action:'确认结果',note:'确认可用'}
  assert.equal((await request('/api/applications/transition',operator,confirm)).status,403)
  assert.equal((await(await request('/api/applications/transition',user,confirm)).json()).status,'已完成')
})

test('失败重试保留原执行，终止不改写失败结果且与新尝试互斥',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-attempts-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/resources/'))return json(res,{snapshotId:'snap',resourceId:'app',workspaceId:'ws',data:{publicationVersionId:'pub',catalogRevision:0}})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req))
    return json(res,mockExecution(commands.at(-1),{status:'failed',result:{failureCode:'PRODUCT_ERROR',failureReason:'产品拒绝',retryable:commands.length===1}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const response=await request('/api/demo-session','',{account})
    return response.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),operator=await login('zhou.min')
  const ticketNo='AG-02-attempts'
  await request('/api/applications',user,{ticketNo,ticketType:'AG-02',resourceId:'app',workspaceId:'ws',
    fields:{scenario:'场景',instructions:'说明',businessLine:'业务',classification:'内部',scope:'all',boundaryOrgs:['业务一部'],usages:['run']}})
  await request('/api/applications/transition',operator,{ticketNo,revision:1,action:'批准',note:'核验通过'})
  async function failed() {
    const deadline=Date.now()+5000
    let row
    do {
      row=(await(await request('/api/applications?view=mine',user)).json()).items[0]
      if(row.status==='执行失败')return row
      await new Promise(resolve=>setTimeout(resolve,50))
    }while(Date.now()<deadline)
    assert.fail('未取得失败状态')
  }
  const first=await failed()
  const retry={ticketNo,revision:first.revision,action:'重试执行',note:'产品恢复后重试'}
  assert.equal((await request('/api/applications/transition',user,retry)).status,403)
  assert.equal((await request('/api/applications/transition',operator,retry)).status,200)
  assert.equal((await request('/api/applications/transition',operator,{...retry,action:'终止工单'})).status,409)
  const second=await failed()
  assert.notEqual(commands[0].executionId,commands[1].executionId)
  assert.equal(second.attempts.length,2)
  assert.equal(second.attempts[0].execution.result.failureCode,'PRODUCT_ERROR')
  assert.equal((await request('/api/applications/transition',operator,{...retry,revision:second.revision})).status,409)
  const terminate={ticketNo,revision:second.revision,action:'终止工单',note:'停止办理'}
  const terminated=await(await request('/api/applications/transition',operator,terminate)).json()
  assert.equal(terminated.status,'已终止')
  assert.equal(terminated.execution.status,'failed')
  assert.equal((await request('/api/applications/transition',operator,terminate)).status,200)
  const old=await fetch(api.url+'/internal/v1/approved-inputs/'+commands[0].executionId,{headers:{authorization:'Bearer test'}})
  assert.equal(old.status,200)
  assert.equal(commands.length,2)
})

test('AG-05 从目录解析源应用，冻结处置范围并在生效时间下发',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-withdraw-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/catalog/agent/agent-1')return json(res,{resourceId:'agent-1',status:'active',actions:['withdraw_app'],data:{appId:'source-app',workspaceId:'ws'}})
    if(path==='/internal/v1/resources/dify_app/source-app')return json(res,{snapshotId:'snap',resourceId:'source-app',workspaceId:'ws',data:{publicationVersionId:'pub',catalogRevision:9,agentImpact:agentImpact('agent-1','source-app','ws')}})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req))
    return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'withdrawn'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const response=await request('/api/demo-session','',{account})
    return response.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),operator=await login('zhou.min')
  const input={ticketNo:'AG-05-test',ticketType:'AG-05',resourceId:'agent-1',workspaceId:'ws',
    fields:{reason:'主动下架',explanation:'旧版停止使用',effectiveAt:new Date(Date.now()+3000).toISOString()}}
  assert.equal((await request('/api/applications',user,input)).status,201)
  const approval={ticketNo:input.ticketNo,revision:1,action:'批准',note:'核验处置范围'}
  assert.equal((await request('/api/applications/transition',operator,approval)).status,400)
  const approved=await(await request('/api/applications/transition',operator,{...approval,disposalScope:['仓库下架','撤销访问授权']})).json()
  assert.equal(commands.length,0)
  const deadline=Date.now()+8000
  while(commands.length===0 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100))
  assert.equal(commands[0].action,'withdraw_app')
  assert.equal(commands[0].resourceId,'agent-1')
  assert.deepEqual(commands[0].payload,{decisionRef:'dec-'+approved.command.executionId})
  const callback=await fetch(api.url+'/internal/v1/approved-inputs/'+approved.command.executionId,{headers:{authorization:'Bearer test'}})
  const frozen=await callback.json()
  assert.equal(frozen.fields.appId,'source-app')
  assert.equal(frozen.fields.expectedRevision,9)
  assert.deepEqual(frozen.fields.disposalScope,['仓库下架','撤销访问授权'])
})

test('历史 Skill 下载冻结所选版本，拒绝换版本重放及不可下载版本',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-versions-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/catalog')return json(res,{items:[{resourceId:'skill',name:'Skill',data:{version:'v2',sha256:'b'.repeat(64)}}]})
    if(path==='/internal/v1/catalog/skill/skill') {
      const version=new URL(req.url,'http://localhost').searchParams.get('version')
      return json(res,{resourceId:'skill',status:'approved',actions:version==='v0'?[]:['download'],data:{version,sha256:'a'.repeat(64)}})
    }
    if(path==='/internal/v1/executions') {
      commands.push(await body(req))
      return json(res,mockDownload(commands.at(-1),'DL-version',{sizeBytes:0}))
    }
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request={ticketNo:'SKL-03-version',ticketType:'SKL-03',action:'download',account:'chen.yu',resourceId:'skill',version:'v1',sha256:'forged'}
  const post=(data,cookie='')=>fetch(api.url+'/api/tickets',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data)})
  const created=await post(request)
  assert.equal(created.status,200)
  const cookie=created.headers.get('set-cookie').split(';')[0]
  assert.deepEqual(commands[0].payload,{version:'v1',sha256:'a'.repeat(64)})
  assert.equal((await post({...request,version:'v2'},cookie)).status,409)
  assert.equal((await post({...request,ticketNo:'SKL-03-denied',version:'v0'},cookie)).status,403)
  assert.equal(commands.length,1)
})

test('下载预检读取后续目录页，重复游标失败时不下发',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-pages-'))
  const {body}=await import('../../runtime/http.mjs')
  const calls=[],commands=[]
  let broken=false
  const capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/catalog') {
      const cursor=new URL(req.url,'http://localhost').searchParams.get('cursor')
      calls.push(cursor)
      return json(res,{items:cursor && !broken?[{resourceId:'second',name:'第二页',data:{version:'1',sha256:'a'.repeat(64)}}]:[],
        nextCursor:cursor && !broken?null:'page-2'})
    }
    if(req.method==='POST'){commands.push(await body(req));return json(res,mockDownload(commands.at(-1),'DL-pages',{sizeBytes:0}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const post=ticketNo=>fetch(api.url+'/api/tickets',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({ticketNo,ticketType:'SKL-03',action:'download',account:'chen.yu',resourceId:'second'})})
  assert.equal((await post('SKL-03-pages')).status,200)
  assert.deepEqual(calls,[null,'page-2'])
  broken=true
  const rejected=await post('SKL-03-broken')
  assert.equal(rejected.status,503)
  assert.equal((await rejected.json()).error.code,'INVALID_CATALOG_CURSOR')
  assert.equal(commands.length,1)
})

test('AG-01 只同步本人且站点关闭的应用，草稿发布版本可为空且即办不进待办',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-personal-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  let owner='someone-else',webSiteEnabled=false
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/resources/'))return json(res,{snapshotId:'personal-snap',resourceId:'app',workspaceId:'ws',
      data:{ownerAccount:owner,webSiteEnabled,publicationVersionId:null}})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req))
    return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'personal-index'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const response=await request('/api/demo-session','',{account})
    return response.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),operator=await login('zhou.min')
  const input={ticketNo:'AG-01-personal',ticketType:'AG-01',resourceId:'app',workspaceId:'ws',ownerAccount:'chen.yu'}
  assert.equal((await request('/api/applications',user,input)).status,403)
  owner='chen.yu';webSiteEnabled=true
  assert.equal((await request('/api/applications',user,input)).status,409)
  webSiteEnabled=false
  assert.equal((await request('/api/applications',user,input)).status,201)
  const deadline=Date.now()+5000
  let row
  do {
    row=(await(await request('/api/applications?view=mine',user)).json()).items[0]
    if(row.status==='已完成')break
    await new Promise(resolve=>setTimeout(resolve,50))
  }while(Date.now()<deadline)
  assert.equal(row.status,'已完成')
  assert.equal(commands.length,1)
  assert.equal(commands[0].action,'sync_app')
  assert.equal(commands[0].account,'chen.yu')
  assert.deepEqual((await(await request('/api/applications?view=todo',operator)).json()).items,[])
  const approved=await fetch(api.url+'/internal/v1/approved-inputs/'+commands[0].executionId,{headers:{authorization:'Bearer test'}})
  assert.equal((await approved.json()).fields.ownerAccount,'chen.yu')
})

test('AG-04 冻结原新版本与工作流，有依赖告警须明确风险决定',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-republish-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/catalog/'))return json(res,{resourceId:'agent',status:'active',actions:['republish'],data:{appId:'app',workspaceId:'ws',publicationVersionId:'old-version',snapshotId:'old-resource-snapshot',workflowSnapshotId:'old-workflow',policyRef:'original-policy'}})
    if(path.includes('/resources/'))return json(res,{snapshotId:'new-snapshot',resourceId:'app',workspaceId:'ws',
      data:{publicationVersionId:'new-version',workflowSnapshotId:'new-workflow',catalogRevision:4,agentImpact:agentImpact('agent','app','ws',[{kind:'plugin',id:'unsafe',name:'待批准插件',approved:false,externalAllowed:false}]),
        dependencies:[{kind:'plugin',id:'unsafe',name:'待批准插件',approved:false,externalAllowed:false}]}})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req))
    return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'new-publication'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const response=await request('/api/demo-session','',{account})
    return response.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),operator=await login('zhou.min')
  const ticketNo='AG-04-republish'
  assert.equal((await request('/api/applications',user,{ticketNo,ticketType:'AG-04',resourceId:'agent',workspaceId:'ws',fields:{changeDescription:'更新工具链'}})).status,201)
  const decision={ticketNo,revision:1,action:'批准',note:'已核验风险'}
  assert.equal((await request('/api/applications/transition',operator,decision)).status,400)
  assert.equal(commands.length,0)
  const row=await(await request('/api/applications/transition',operator,{...decision,warningDecision:'确认风险并继续审批'})).json()
  const deadline=Date.now()+5000
  while(commands.length===0 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands[0].action,'republish')
  const callback=await fetch(api.url+'/internal/v1/approved-inputs/'+row.command.executionId,{headers:{authorization:'Bearer test'}})
  const frozen=await callback.json()
  assert.equal(frozen.fields.oldPublicationVersionId,'old-version')
  assert.equal(frozen.fields.newPublicationVersionId,'new-version')
  assert.equal(frozen.fields.oldWorkflowSnapshotId,'old-workflow')
  assert.equal(frozen.fields.newWorkflowSnapshotId,'new-workflow')
  assert.equal(frozen.fields.expectedRevision,4)
  assert.equal(frozen.fields.warningDecision,'确认风险并继续审批')
})

test('AG-03 公开即办、受限审批，使用方式和授权账户从可信范围冻结',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-grant-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  let scope='all'
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/catalog/'))return json(res,{resourceId:'agent',status:'active',data:{
      appId:'app',workspaceId:'ws',scope,boundaryOrgs:['业务一部'],targetOrgs:['业务一部'],usages:['run'],policyRef:'published-policy'}})
    if(path.includes('/resources/'))return json(res,{snapshotId:'snap',resourceId:'app',workspaceId:'ws',data:{publicationVersionId:'pub',catalogRevision:2}})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req))
    return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'grant'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),operator=await login('zhou.min')
  const input={ticketNo:'AG-03-public',ticketType:'AG-03',resourceId:'agent',workspaceId:'ws',
    fields:{purpose:'使用测试',startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),usages:['run'],account:'li.qiang',policyRef:'forged'}}
  assert.equal((await request('/api/applications',user,{...input,fields:{...input.fields,usages:['api']}})).status,403)
  const publicRow=await(await request('/api/applications',user,input)).json()
  assert.equal(publicRow.status,'执行中')
  assert.equal(publicRow.approvedFields.account,'chen.yu')
  assert.equal(publicRow.approvedFields.policyRef,'published-policy')
  scope='orgs'
  const restricted=await(await request('/api/applications',user,{...input,ticketNo:'AG-03-restricted'})).json()
  assert.equal(restricted.status,'待受理')
  const approved=await(await request('/api/applications/transition',operator,{ticketNo:restricted.ticketNo,revision:1,action:'批准',note:'核验用途和期限'})).json()
  assert.equal(approved.command.action,'grant_app_access')
  assert.equal(approved.approvedFields.account,'chen.yu')
  assert.equal((await request('/api/applications',operator,{...input,ticketNo:'AG-03-outside'})).status,403)
})

test('规则复核依据实时账号资料，停用、降密级、越界及错误资源被拒绝',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-policy-'))
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/resources/'))return json(res,{snapshotId:'snap',resourceId:'app',workspaceId:'ws',data:{publicationVersionId:'pub',catalogRevision:0}})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    return json(res,mockExecution(await body(req),{status:'succeeded',result:{resultId:'published'}}))
  })
  let profile={account:'chen.yu',role:'user',active:true,org:'业务一部',clearance:'内部',businessLines:['业务']}
  const options={dir,token:'test',executor:capability.url,resolvePolicyAccount:async()=>profile}
  let api=await startManagement(options)
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const post=(path,data,headers={})=>fetch(api.url+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)})
  const login=await post('/api/demo-session',{account:'chen.yu'})
  const user=login.headers.get('set-cookie').split(';')[0]
  const admin=await post('/api/demo-session',{account:'zhou.min'})
  const ops=admin.headers.get('set-cookie').split(';')[0]
  const ticketNo='AG-02-policy'
  await post('/api/applications',{ticketNo,ticketType:'AG-02',resourceId:'app',workspaceId:'ws',
    fields:{scenario:'业务',instructions:'说明',businessLine:'业务',classification:'内部',scope:'all',boundaryOrgs:['业务一部'],usages:['run']}},{cookie:user})
  const approved=await(await post('/api/applications/transition',{ticketNo,revision:1,action:'批准',note:'范围已核验'},{cookie:ops})).json()
  const input={policyRef:approved.approvedFields.policyRef,account:'chen.yu',resourceId:'app',action:'run',workspaceId:'ws'}
  const evaluate=data=>post('/internal/v1/policy-decisions',data,{authorization:'Bearer test'})
  assert.equal((await post('/internal/v1/policy-decisions',input)).status,403)
  const deadline=Date.now()+5000
  let evaluated
  do {
    evaluated=await(await evaluate(input)).json()
    if(evaluated.allowed)break
    await new Promise(resolve=>setTimeout(resolve,50))
  }while(Date.now()<deadline)
  assert.equal(evaluated.allowed,true)
  profile={...profile,active:false}
  assert.equal((await(await evaluate(input)).json()).reasonCode,'ACCOUNT_INACTIVE')
  profile={...profile,active:true,clearance:'公开'}
  assert.equal((await(await evaluate(input)).json()).reasonCode,'CLASSIFICATION_DENIED')
  profile={...profile,clearance:'内部',org:'其他组织'}
  assert.equal((await(await evaluate(input)).json()).reasonCode,'ORG_BOUNDARY_DENIED')
  assert.equal((await(await evaluate({...input,resourceId:'other'})).json()).allowed,false)
  await api.close()
  api=await startManagement({...options,resolvePolicyAccount:undefined})
  assert.equal((await evaluate(input)).status,503)
})

test('新发布替换规则、下架撤权和账号查询期间撤权均拒绝旧规则',async t=>{
  const {policyDecision}=await import('../../management/platform/access/public.server.mjs')
  const policy={ref:'policy-old',revision:1,resourceId:'app',workspaceId:'ws',scope:'all',
    usages:['run'],classification:'内部',businessLine:'业务',boundaryOrgs:['业务一部']}
  const rows=[{policy,execution:{status:'succeeded'},effectOrder:1,command:{action:'publish'},
    snapshot:{resourceId:'app'},submission:{workspaceId:'ws'},approvedFields:{policyRef:'policy-old'}}]
  let resolveHook
  const api=await listen((req,res)=>policyDecision(req,res,{token:'test',records:()=>rows,resolveAccount:async()=>{
    if(resolveHook)await resolveHook()
    return {account:'chen.yu',active:true,role:'user',org:'业务一部',clearance:'内部',businessLines:['业务']}
  }}))
  t.after(()=>api.close())
  const request=()=>fetch(api.url+'/internal/v1/policy-decisions',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},
    body:JSON.stringify({policyRef:'policy-old',resourceId:'app',workspaceId:'ws',action:'run',account:'chen.yu'})}).then(r=>r.json())
  assert.equal((await request()).allowed,true)
  rows.push({...rows[0],policy:undefined,effectOrder:2,approvedFields:{policyRef:'policy-new'}})
  assert.equal((await request()).reasonCode,'POLICY_SUPERSEDED')
  rows.pop()
  let release,entered
  const started=new Promise(resolve=>{entered=resolve})
  const gate=new Promise(resolve=>{release=resolve})
  resolveHook=()=>{entered();return gate}
  const pending=request()
  await started
  rows.push({...rows[0],policy:undefined,effectOrder:3,command:{action:'withdraw_app'},approvedFields:{disposalScope:['撤销访问授权']}})
  release()
  assert.equal((await pending).reasonCode,'PUBLICATION_WITHDRAWN')
})

test('KB-01 按来源核对本人和tenant/workspace，冻结私有同步输入',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-kb-sync-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  let owner='other',tenant='tenant-a'
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/resources/')) {
      const rag=path.includes('ragflow_dataset')
      return json(res,{snapshotId:'dataset-snap',resourceId:'dataset',workspaceId:rag?null:'ws',
        data:{ownerAccount:owner,tenantId:rag?tenant:null,documentCount:2}})
    }
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req))
    return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'personal-dataset'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  const login=await request('/api/demo-session','',{account:'chen.yu'})
  const cookie=login.headers.get('set-cookie').split(';')[0]
  const input={ticketNo:'KB-01-private',ticketType:'KB-01',resourceId:'dataset',workspaceId:'tenant-a',fields:{sourceSystem:'RAGFlow'}}
  assert.equal((await request('/api/applications',cookie,input)).status,403)
  owner='chen.yu';tenant='other-tenant'
  assert.equal((await request('/api/applications',cookie,input)).status,409)
  tenant='tenant-a'
  const first=await(await request('/api/applications',cookie,input)).json()
  assert.equal(first.approvedFields['所有者账户名'],'chen.yu')
  assert.equal(first.approvedFields['来源系统'],'RAGFlow')
  const second=await request('/api/applications',cookie,{...input,ticketNo:'KB-01-dify',workspaceId:'ws',fields:{sourceSystem:'Dify'}})
  assert.equal(second.status,201)
  const deadline=Date.now()+5000
  let rows
  do {
    rows=(await(await request('/api/applications?view=mine',cookie)).json()).items
    if(rows.every(r=>r.status==='已完成'))break
    await new Promise(resolve=>setTimeout(resolve,50))
  }while(Date.now()<deadline)
  assert.ok(rows.every(r=>r.status==='已完成'))
  assert.equal(commands.length,2)
  assert.ok(commands.every(c=>c.action==='sync_dataset' && c.account==='chen.yu'))
})

test('统一执行依据按动作登记及会话鉴权，拒绝错配快照和账号类越权',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-context-'))
  let mismatch=false
  const calls=[]
  const capability=await listen((req,res,path)=>{
    calls.push({path,account:req.headers['x-account']})
    return json(res,{snapshotId:'context-1',ticketType:'KB-02',action:'publish_dataset',
      resourceId:mismatch?'other':'dataset',fields:{'文档清单快照ID':'manifest-1','安全审查结论':'全部通过'},
      preconditions:[{kind:'dataset_manifest',id:'manifest-1',sha256:'a'.repeat(64)}]})
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const login=await fetch(api.url+'/api/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'chen.yu'})})
  const cookie=login.headers.get('set-cookie').split(';')[0]
  const path='/api/execution-contexts?ticketType=KB-02&action=publish_dataset&resourceId=dataset'
  const read=url=>fetch(api.url+url,{headers:{cookie,'x-account':'li.qiang'}})
  assert.equal((await fetch(api.url+path)).status,403)
  assert.equal((await read(path.replace('publish_dataset','revoke_key'))).status,400)
  const valid=await read(path)
  assert.equal((await valid.json()).snapshotId,'context-1')
  assert.equal(calls[0].account,'chen.yu')
  mismatch=true
  assert.equal((await read(path)).status,503)
  assert.equal((await read('/api/execution-contexts?ticketType=ACC-01&action=apply_account_change&resourceId=account')).status,403)
  assert.equal(calls.length,2)
})

test('KB-02 逐文档指纹复核，审批期间清单变化与未确认不得发布',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-dataset-publish-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  let changed=false
  const hash='a'.repeat(64)
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'ctx',ticketType:'KB-02',action:'publish_dataset',resourceId:'dataset',
      fields:{'来源系统':'Dify','所有者账户名':'chen.yu','workspace/tenant ID':'ws','文档数':1,'文档清单快照ID':'manifest','模型目录核对结果':'一致',
        '文档审查明细':[{documentId:'doc',sha256:changed?'b'.repeat(64):hash,autoVerdict:'通过'}]},
      preconditions:[{kind:'dataset_manifest',id:'manifest',sha256:changed?'b'.repeat(64):hash}]})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req))
    return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'share'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const ticketNo='KB-02-share'
  const input={ticketNo,ticketType:'KB-02',resourceId:'dataset',workspaceId:'ws',fields:{sourceSystem:'Dify',
    shareMode:'共享目录',purpose:'共享测试',name:'共享库',description:'说明',tags:['测试'],boundaryOrgs:['业务一部'],classification:'内部',businessLine:'业务'}}
  assert.equal((await request('/api/applications',user,input)).status,201)
  const approval={ticketNo,revision:1,action:'批准',note:'逐项确认'}
  assert.equal((await request('/api/applications/transition',ops,approval)).status,400)
  const confirmed={...approval,confirmations:[{documentId:'doc',sha256:hash,verdict:'通过'}]}
  changed=true
  assert.equal((await request('/api/applications/transition',ops,confirmed)).status,409)
  assert.equal(commands.length,0)
  changed=false
  const approved=await(await request('/api/applications/transition',ops,confirmed)).json()
  const deadline=Date.now()+5000
  while(!commands.length && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands[0].action,'publish_dataset')
  const callback=await fetch(api.url+'/internal/v1/approved-inputs/'+approved.command.executionId,{headers:{authorization:'Bearer test'}})
  const frozen=await callback.json()
  assert.equal(frozen.fields['文档确认记录'][0].actor,'zhou.min')
  assert.equal(frozen.preconditions[0].sha256,hash)
  assert.equal(frozen.fields['分享方式'],'共享目录')
})

test('KB-03 三种实现方式分别冻结，本人即办与他人审批隔离',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-binding-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/application-targets/app')return json(res,{appId:'app',name:'绑定应用',workspaceId:'target',purpose:'dataset_binding',targetRef:'target-app-ref',revision:1,eligible:true})
    if(path.includes('/execution-contexts/')) {
      const resourceId=new URL(req.url,'http://localhost').searchParams.get('resourceId')
      const source=resourceId==='rag'?'RAGFlow':'Dify'
      const sourceWorkspace=resourceId==='same'?'target':'source'
      return json(res,{snapshotId:'binding-'+resourceId,ticketType:'KB-03',action:'bind_dataset',resourceId,eligible:true,
        fields:{'来源系统':source,'源知识库ID':'product-'+resourceId,'源所有者账户名':resourceId==='copy'?'other':'chen.yu',
          '源workspace/tenant ID':sourceWorkspace,'目标Dify workspace ID':'target','边界匹配结果':'符合',
          '实现方式':resourceId==='rag'?'RAGFlow外部知识库':resourceId==='same'?'Dify同workspace授权':'Dify跨workspace复制',
          '目录来源':resourceId==='copy'?'已发布共享':'本人纳管','知识库名称':'知识库','组织边界':['业务一部'],'密级':'内部','业务线':'业务','允许申请权限':['检索使用','编排绑定'],
          ...source==='RAGFlow'?{'外部知识库API地址':'https://knowledge.example/external'}:{},
          '源文档版本指纹':'a'.repeat(64),'文档清单快照ID':'manifest',policyRef:'policy-'+resourceId},
        preconditions:[{kind:'dataset_manifest',id:'manifest',sha256:'a'.repeat(64)},{kind:'dataset_catalog',id:resourceId,revision:1}]})
    }
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'binding'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),operator=await login('zhou.min')
  for(const resourceId of ['rag','same','copy']) {
    const ticketNo='KB-03-'+resourceId
    const row=await(await request('/api/applications',user,{ticketNo,ticketType:'KB-03',resourceId,workspaceId:'target',
      fields:{purpose:'绑定测试',permission:'编排绑定',targetAppId:'app',startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}})).json()
    assert.equal(row.status,resourceId==='copy'?'待受理':'执行中')
    if(resourceId==='copy') {
      const result=await request('/api/applications/transition',operator,{ticketNo,revision:1,action:'批准',note:'核对复制范围'})
      assert.equal(result.status,200)
    }
  }
  const deadline=Date.now()+5000
  while(commands.length<3 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,3)
  for(const command of commands) {
    assert.equal(command.action,'bind_dataset')
    const r=await fetch(api.url+'/internal/v1/approved-inputs/'+command.executionId,{headers:{authorization:'Bearer test'}})
    const frozen=await r.json()
    assert.equal(frozen.fields['获批使用者账户名'],'chen.yu')
    assert.equal(frozen.fields['目标Dify workspace ID'],'target')
    assert.equal(frozen.fields['实现方式'],command.resourceId==='rag'?'RAGFlow外部知识库':command.resourceId==='same'?'Dify同workspace授权':'Dify跨workspace复制')
  }
})

test('MCP-02 冻结可信URL指纹，审批前变更拒绝且普通页面隐藏指纹',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-mcp-bind-'))
  const {body}=await import('../../runtime/http.mjs')
  let fingerprint='a'.repeat(64),access='approval'
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/binding-contexts/'))return json(res,{resourceId:'mcp',workspaceId:'ws',expectedUrlFingerprint:fingerprint,bindingAccess:access})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'provider'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),operator=await login('zhou.min')
  const visible=await(await request('/api/mcp-binding-context?resourceId=mcp&workspaceId=ws',user)).json()
  assert.equal(visible.expectedUrlFingerprint,undefined)
  const input={ticketNo:'MCP-02-test',ticketType:'MCP-02',resourceId:'mcp',workspaceId:'ws',
    fields:{purpose:'使用测试',startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()},expectedUrlFingerprint:'forged'}
  assert.equal((await request('/api/applications',user,input)).status,201)
  const mine=await(await request('/api/applications?view=mine',user)).json()
  assert.ok(!JSON.stringify(mine).includes('expectedUrlFingerprint'))
  assert.ok(!JSON.stringify(mine).includes('a'.repeat(64)))
  const decision={ticketNo:input.ticketNo,revision:1,action:'批准',note:'核验指纹'}
  fingerprint='b'.repeat(64)
  assert.equal((await request('/api/applications/transition',operator,decision)).status,409)
  assert.equal(commands.length,0)
  fingerprint='a'.repeat(64)
  assert.equal((await request('/api/applications/transition',operator,decision)).status,200)
  access='instant'
  const instant=await(await request('/api/applications',user,{...input,ticketNo:'MCP-02-instant'})).json()
  assert.equal(instant.status,'执行中')
  const deadline=Date.now()+5000
  while(commands.length<2 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,2)
  assert.ok(commands.every(c=>c.action==='bind' && c.account==='chen.yu' && c.payload.expectedUrlFingerprint==='a'.repeat(64)))
})

test('SKL-04 下架保留审计副本，交付未核对前不下发',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-skill-withdraw-'))
  const {body,ledger}=await import('../../runtime/http.mjs')
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/catalog/skill/skill')return json(res,{resourceId:'skill',status:'available',actions:['withdraw_skill'],data:{version:'1'}})
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'withdraw-ctx',ticketType:'SKL-04',action:'withdraw_skill',resourceId:'skill',
      fields:{'Skill名称':'技能','当前版本号':'1','历史下载次数':2,'历史下载人数':1},preconditions:[{kind:'skill',id:'skill',revision:3}]})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'withdrawn'}}))
  })
  const transfers=ledger(dir,'tickets')
  transfers.put('download',{ticketNo:'download',command:{resourceId:'skill'},state:{status:'awaiting_delivery'},delivery:{status:'sending'}})
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();transfers.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const ticketNo='SKL-04-withdraw'
  const input={ticketNo,ticketType:'SKL-04',resourceId:'skill',fields:{reason:'主动下架',explanation:'停用旧技能',effectiveAt:new Date().toISOString()}}
  assert.equal((await request('/api/applications',user,input)).status,201)
  const approved=await(await request('/api/applications/transition',ops,{ticketNo,revision:1,action:'批准',note:'保留历史流水'})).json()
  let waiting
  const waitDeadline=Date.now()+5000
  while(Date.now()<waitDeadline) {
    waiting=(await(await request('/api/applications?view=mine',user)).json()).items[0]
    if(waiting.status==='等待交付核对')break
    await new Promise(resolve=>setTimeout(resolve,40))
  }
  assert.equal(waiting.status,'等待交付核对')
  assert.equal(commands.length,0)
  transfers.put('download',{...transfers.get('download'),delivery:{status:'confirmed'}})
  const deadline=Date.now()+7000
  while(!commands.length && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100))
  assert.equal(commands[0].action,'withdraw_skill')
  const callback=await fetch(api.url+'/internal/v1/approved-inputs/'+approved.command.executionId,{headers:{authorization:'Bearer test'}})
  const frozen=await callback.json()
  assert.equal(frozen.fields['文件处置'],'保留审计副本并禁止下载')
  assert.equal(frozen.preconditions[0].revision,3)
})

test('MCP-03 三动作冻结绑定范围，单用户解绑不扩大为目录处置',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-mcp-disposition-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/catalog/mcp/mcp')return json(res,{resourceId:'mcp',status:'active',actions:['unbind_mcp','isolate_mcp','withdraw_mcp']})
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'ctx',ticketType:'MCP-03',
      action:new URL(req.url,'http://localhost').searchParams.get('action'),resourceId:'mcp',
      fields:{'绑定清单快照ID':'bindings','绑定清单完整':true,'绑定清单':[
        {account:'chen.yu',workspaceId:'ws',providerId:'provider-a'},
        {account:'other',workspaceId:'ws-other',providerId:'provider-b'}]},
      preconditions:[{kind:'mcp',id:'mcp',revision:3}]})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'disposed'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const cases=[['单用户解绑','unbind_mcp'],['目录隔离','isolate_mcp'],['目录下架','withdraw_mcp']]
  for(const [index,[operation,action]] of cases.entries()) {
    const ticketNo='MCP-03-'+index
    const submitted=await request('/api/applications',user,{ticketNo,ticketType:'MCP-03',resourceId:'mcp',workspaceId:'ws',
      fields:{operation,targetAccount:'chen.yu',reason:'主动解绑',facts:'测试处置'}})
    assert.equal(submitted.status,201)
    const decision={ticketNo,revision:1,action:'批准',note:'已核对绑定范围'}
    assert.equal((await request('/api/applications/transition',user,decision)).status,403)
    const approved=await(await request('/api/applications/transition',ops,decision)).json()
    assert.equal(approved.command.action,action)
    assert.equal(approved.approvedFields['绑定清单'].length,index===0?1:2)
    assert.equal(approved.approvedFields['目标账户名'],index===0?'chen.yu':null)
  }
  const deadline=Date.now()+5000
  while(commands.length<3 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,3)
})

test('KEY-02 轮换撤销冻结登记修订，排除凭证明文并按原动作下发',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-key-lifecycle-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  const secret='DO-NOT-PERSIST-SECRET'
  const capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/key-registrations/key-reg')return json(res,{registrationId:'key-reg',appId:'app',workspaceId:'ws',keyId:'product-key',lastFour:'abcd',status:'active',revision:2,actions:['rotate_key','revoke_key'],secret})
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'key-snap',ticketType:'KEY-02',
      action:new URL(req.url,'http://localhost').searchParams.get('action'),resourceId:'key-reg',
      fields:{'Dify应用ID':'app','Dify密钥ID':'product-key','密钥后四位':'abcd',secret},
      preconditions:[{kind:'key_registration',id:'key-reg',revision:2}]})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'updated-key',secret,details:{secret,'旧密钥撤销结果':'成功'}}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  for(const [index,operation] of ['轮换','撤销'].entries()) {
    const ticketNo='KEY-02-'+index
    const input={ticketNo,ticketType:'KEY-02',resourceId:'key-reg',fields:{operation,reason:'授权调整',
      effectiveAt:new Date().toISOString(),newExpiresAt:new Date(Date.now()+60000).toISOString(),secret}}
    const submitted=await request('/api/applications',user,input)
    assert.equal(submitted.status,201)
    assert.ok(!JSON.stringify(await submitted.json()).includes(secret))
    assert.equal((await request('/api/applications/transition',ops,{ticketNo,revision:1,action:'批准',note:'核对登记'})).status,200)
  }
  const deadline=Date.now()+5000
  let rows
  do {
    rows=(await(await request('/api/applications?view=mine',user)).json()).items
    if(rows.every(r=>r.status==='待结果确认'))break
    await new Promise(resolve=>setTimeout(resolve,50))
  }while(Date.now()<deadline)
  assert.equal(commands.length,2)
  assert.deepEqual(commands.map(c=>c.action).sort(),['revoke_key','rotate_key'])
  assert.ok(!JSON.stringify(rows).includes(secret))
  assert.ok(rows.every(r=>r.preconditions[0].revision===2))
})

test('TOL-01 安全意见必填，配置指纹变化使旧审批失效',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-tool-approval-'))
  const {body}=await import('../../runtime/http.mjs')
  let fingerprint='a'.repeat(64)
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    const operation=new URL(req.url,'http://localhost').searchParams.get('operation')
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'tool-ctx',ticketType:'TOL-01',action:'set_tool_approval',resourceId:'tool',operation,eligible:true,
      fields:{'Dify workspace ID':'ws','Dify工具ID':'tool','Dify工具提供者ID':'provider','工具配置指纹':fingerprint,
        '工具名称':'工具','工具提供者名称':'提供者','配置来源':'产品现状','输出说明':'结果','工具版本':'1','输入参数schema':{type:'object'},
        ...operation!=='首次批准'?{'原批准工单号':'old','原工具版本':'0','原工具配置指纹':'b'.repeat(64),'配置差异':[{差异项:'版本',原值摘要:'0',新值摘要:'1'}]}:{}},
      preconditions:[{kind:'tool_configuration',id:'tool',sha256:fingerprint},{kind:'tool_approval',id:'tool',revision:operation==='首次批准'?0:1}]})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'approved-tool'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  for(const [i,operation] of ['首次批准','变更再审','撤销批准'].entries()) {
    const ticketNo='TOL-01-'+i
    const submitted=await request('/api/applications',user,{ticketNo,ticketType:'TOL-01',resourceId:'tool',workspaceId:'ws',
      fields:{operation,description:'功能',purpose:'业务用途',permissions:['读取'],targetOrgs:['业务一部'],classification:'内部',businessLine:'业务'}})
    assert.equal(submitted.status,201)
    const decision={ticketNo,revision:1,action:'批准',note:'审核通过'}
    assert.equal((await request('/api/applications/transition',ops,decision)).status,400)
    const secure={...decision,securityVerdict:'通过',securityNote:'核对工具配置',externalAllowed:operation==='撤销批准'?'禁止':'允许'}
    fingerprint='b'.repeat(64)
    assert.equal((await request('/api/applications/transition',ops,secure)).status,409)
    fingerprint='a'.repeat(64)
    const approved=await(await request('/api/applications/transition',ops,secure)).json()
    assert.equal(approved.command.action,'set_tool_approval')
    assert.equal(approved.approvedFields['工具配置指纹'],fingerprint)
    assert.equal(approved.approvedFields['确认人'],'zhou.min')
  }
  const deadline=Date.now()+5000
  while(commands.length<3 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,3)
})

test('KEY-01 本人调试即办，对外关联发布审批，CIDR与所有者校验',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-key-create-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  let owner='other'
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'create-ctx',ticketType:'KEY-01',action:'create_key',resourceId:'app',
      fields:{'Dify应用ID':'app','所有者账户名':owner,'Dify API地址':'https://dify.example/v1','关联发布工单号':'AG-02-live'},
      preconditions:[]})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'key-delivery',details:{'密钥后四位':'abcd',secret:'NEVER-SAVE'}}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const input={ticketNo:'KEY-01-debug',ticketType:'KEY-01',resourceId:'app',workspaceId:'ws',fields:{
    purpose:'本人调试',callerName:'本人',callerOrg:'业务一部',environment:'开发',allowedCidrs:['10.0.0.0/24','2001:db8::/64'],
    peakQps:1,expiresAt:new Date(Date.now()+60000).toISOString()}}
  assert.equal((await request('/api/applications',user,{...input,fields:{...input.fields,allowedCidrs:['10.0.0.0/99']}})).status,400)
  assert.equal((await request('/api/applications',user,input)).status,403)
  owner='chen.yu'
  assert.equal((await request('/api/applications',user,input)).status,201)
  const shared={...input,ticketNo:'KEY-01-shared',fields:{...input.fields,purpose:'系统集成',publicationTicketNo:'wrong'}}
  assert.equal((await request('/api/applications',user,shared)).status,409)
  shared.fields.publicationTicketNo='AG-02-live'
  assert.equal((await(await request('/api/applications',user,shared)).json()).status,'待受理')
  assert.equal((await request('/api/applications/transition',ops,{ticketNo:shared.ticketNo,revision:1,action:'批准',note:'核对调用方'})).status,200)
  const deadline=Date.now()+5000
  let rows
  do {
    rows=(await(await request('/api/applications?view=mine',user)).json()).items
    if(rows.every(r=>r.status==='待领取密钥'))break
    await new Promise(resolve=>setTimeout(resolve,50))
  }while(Date.now()<deadline)
  assert.ok(rows.every(r=>r.status==='待领取密钥'))
  assert.equal(commands.length,2)
  assert.ok(commands.every(c=>c.action==='create_key'))
  assert.ok(!JSON.stringify(rows).includes('NEVER-SAVE'))
})

test('密钥一次性领取仅申请人可用，正文不进入持久记录',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-reveal-'))
  const {ledger}=await import('../../runtime/http.mjs')
  const {readFile}=await import('node:fs/promises')
  const store=ledger(dir,'applications')
  const secret='ONE-TIME-TEST-SECRET'
  store.put('KEY-01-reveal',{ticketNo:'KEY-01-reveal',ticketType:'KEY-01',account:'chen.yu',status:'待领取密钥',revision:1,
    submission:{resourceId:'app',workspaceId:'ws',fields:{}},history:[],
    command:{executionId:'create-execution',account:'chen.yu',org:'业务一部',action:'create_key'},
    execution:{status:'succeeded',result:{details:{registrationId:'registration-1'}}}})
  let reveals=0
  const capability=await listen((req,res,path)=>{
    assert.equal(path,'/internal/v1/key-registrations/registration-1/reveal')
    assert.equal(req.headers['x-account'],'chen.yu')
    reveals++
    json(res,{secret})
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();store.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const input={ticketNo:'KEY-01-reveal'}
  assert.equal((await request('/api/applications/reveal',ops,input)).status,404)
  const response=await request('/api/applications/reveal',user,input)
  assert.equal(response.headers.get('cache-control'),'no-store')
  assert.equal((await response.json()).secret,secret)
  assert.equal((await request('/api/applications/reveal',user,input)).status,409)
  assert.equal(reveals,1)
  assert.equal(store.get(input.ticketNo).status,'已完成')
  assert.equal(store.get(input.ticketNo).revealState,'shown')
  assert.ok(!JSON.stringify(store.all()).includes(secret))
  assert.ok(!(await readFile(join(dir,'applications.sqlite'))).includes(Buffer.from(secret)))
})

test('MCP-01 固定技术注册与新目录ID，URL变化阻止审批且不保存手填地址',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-mcp-registration-'))
  const {body}=await import('../../runtime/http.mjs')
  let fingerprint='a'.repeat(64)
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/resources/'))return json(res,{snapshotId:'reg-snap',resourceId:'tech-reg',data:{
      registrationId:'tech-reg',status:'active',transport:'streamable_http',urlFingerprint:fingerprint,authType:'bearer',
      syncedAt:'2026-11-18T01:00:00Z',tools:[{name:'lookup',description:'查询',inputSchema:{type:'object'}}],
      rawUrl:'UNTRUSTED-ADDRESS',credentials:'UNTRUSTED-CREDENTIAL'}})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'mcp-catalog'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const input={ticketNo:'MCP-01-register',ticketType:'MCP-01',resourceId:'tech-reg',fields:{
    name:'查询服务',purpose:'业务查询',boundaryOrgs:['业务一部'],classification:'内部',businessLine:'业务',rawUrl:'FORGED-URL'}}
  const submitted=await request('/api/applications',user,input)
  assert.equal(submitted.status,201)
  const row=await submitted.json()
  assert.ok(!JSON.stringify(row).includes('FORGED-URL'))
  assert.ok(!JSON.stringify(row).includes('UNTRUSTED-'))
  assert.equal((await(await request('/api/applications',user,input)).json()).catalogId,row.catalogId)
  const approval={ticketNo:row.ticketNo,revision:1,action:'批准',note:'核对技术注册',securityVerdict:'通过',securityNote:'安全复核通过',externalAllowed:'允许'}
  fingerprint='b'.repeat(64)
  assert.equal((await request('/api/applications/transition',ops,approval)).status,409)
  fingerprint='a'.repeat(64)
  const approved=await(await request('/api/applications/transition',ops,approval)).json()
  assert.equal(approved.command.resourceId,row.catalogId)
  assert.equal(approved.command.action,'register_mcp')
  assert.equal(approved.approvedFields['技术注册ID'],'tech-reg')
  const deadline=Date.now()+5000
  while(!commands.length && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,1)
})

test('文件流式转发保持字节、上传键按账户隔离，扫描证据按权限裁剪',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-intake-'))
  const {Readable}=await import('node:stream')
  const {digest}=await import('../../runtime/http.mjs')
  const uploads=new Map()
  const capability=await listen(async(req,res,path)=>{
    if(req.method==='POST') {
      const form=await new Response(Readable.toWeb(req),{headers:{'content-type':req.headers['content-type']}}).formData()
      const file=form.get('file')
      const bytes=Buffer.from(await file.arrayBuffer())
      const key=req.headers['idempotency-key']
      const existing=uploads.get(key)
      if(existing && existing.sha256!==digest(bytes))return json(res,{error:{code:'UPLOAD_CONFLICT'}},409)
      const item=existing ?? {intakeId:'intake-'+uploads.size,status:'scanning',sha256:digest(bytes),bytes,
        account:req.headers['x-account']}
      uploads.set(key,item)
      return json(res,{intakeId:item.intakeId,status:item.status},202)
    }
    const item=[...uploads.values()].find(u=>path.endsWith('/'+u.intakeId))
    return json(res,{intakeId:item.intakeId,status:'ready',sha256:item.sha256,sizeBytes:item.bytes.length,
      filename:'test.bin',scan:{checkedAt:new Date().toISOString(),verdict:'passed',findings:[{message:'sensitive evidence'}]}})
  })
  const options={dir,token:'test',executor:capability.url}
  let api=await startManagement(options)
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  async function login(account) {
    const r=await fetch(api.url+'/api/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account})})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),other=await login('zhou.min')
  const bytes=Buffer.from([0,255,128,10,13,65])
  const send=(cookie,data=bytes)=>{
    const form=new FormData()
    form.set('file',new Blob([data]),'test.bin')
    return fetch(api.url+'/api/intake/skill',{method:'POST',headers:{cookie,'Idempotency-Key':'same-user-key','x-account':'li.qiang'},body:form})
  }
  const first=await send(user)
  assert.equal(first.status,202)
  const uploaded=await first.json()
  assert.equal((await(await send(user)).json()).intakeId,uploaded.intakeId)
  assert.equal((await send(user,Buffer.from('changed'))).status,409)
  assert.equal((await send(other)).status,202)
  assert.equal(uploads.size,2)
  assert.deepEqual([...uploads.values()][0].bytes,bytes)
  assert.equal([...uploads.values()][0].account,'chen.yu')
  await api.close()
  api=await startManagement(options)
  const read=cookie=>fetch(api.url+'/api/intake/skill/'+uploaded.intakeId,{headers:{cookie}})
  assert.equal((await read(other)).status,404)
  const info=await(await read(user)).json()
  assert.equal(info.sha256,digest(bytes))
  assert.equal(info.scan.findings,undefined)
})

test('SKL-01 上架绑定ready上传件，扫描未完成及审批摘要变化均拒绝',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-skill-publish-'))
  const {body}=await import('../../runtime/http.mjs')
  let status='scanning',hash='a'.repeat(64)
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/intake/')) {
      assert.equal(req.headers['x-account'],'chen.yu')
      return json(res,{intakeId:'upload-1',status,sha256:hash,sizeBytes:100,filename:'skill.zip',
        scan:{verdict:'passed',checkedAt:'2026-11-18T01:00:00Z'}})
    }
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'published-skill'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const input={ticketNo:'SKL-01-publish',ticketType:'SKL-01',resourceId:'skill-new',fields:{
    intakeId:'upload-1',name:'新技能',version:'1',description:'功能',instructions:'使用说明',license:'MIT',scope:'全网段公开',tags:['测试'],sha256:'forged'}}
  assert.equal((await request('/api/applications',user,input)).status,409)
  status='ready'
  assert.equal((await request('/api/applications',user,input)).status,201)
  const approval={ticketNo:input.ticketNo,revision:1,action:'批准',note:'核验文件'}
  hash='b'.repeat(64)
  assert.equal((await request('/api/applications/transition',ops,approval)).status,409)
  assert.equal(commands.length,0)
  hash='a'.repeat(64)
  const approved=await(await request('/api/applications/transition',ops,approval)).json()
  assert.equal(approved.command.action,'publish_skill')
  assert.equal(approved.approvedFields['作者账户名'],'chen.yu')
  assert.equal(approved.approvedFields['审批文件指纹'],hash)
  const deadline=Date.now()+5000
  while(!commands.length && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,1)
})

test('PLG-01 使用扫描包身份而非手填身份，上架不安装且目录ID稳定',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-plugin-publish-'))
  const {body}=await import('../../runtime/http.mjs')
  let version='1.0'
  const commands=[]
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/intake/'))return json(res,{intakeId:'plugin-upload',status:'ready',sha256:'a'.repeat(64),sizeBytes:42,
      filename:'plugin.difypkg',scan:{verdict:'passed',checkedAt:'2026-11-18T01:00:00Z'},
      packageMetadata:{uniqueIdentifier:'publisher/plugin',name:'已解析插件',version,dependencies:[{name:'dep',version:'1',license:'MIT'}]}})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'approved-package'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const input={ticketNo:'PLG-01-publish',ticketType:'PLG-01',resourceId:'plugin-upload',fields:{
    intakeId:'plugin-upload',description:'功能',instructions:'说明',permissions:['读取'],accessMode:'公开免审安装',
    networkAccess:[],installationMethod:'本地包',version:'FORGED',name:'FORGED'}}
  const row=await(await request('/api/applications',user,input)).json()
  assert.equal(row.status,'待受理')
  assert.equal((await(await request('/api/applications',user,input)).json()).catalogId,row.catalogId)
  const approval={ticketNo:row.ticketNo,revision:1,action:'批准',note:'扫描通过'}
  assert.equal((await request('/api/applications/transition',ops,approval)).status,400)
  version='2.0'
  assert.equal((await request('/api/applications/transition',ops,{...approval,externalAllowed:'允许'})).status,409)
  version='1.0'
  const approved=await(await request('/api/applications/transition',ops,{...approval,externalAllowed:'允许'})).json()
  assert.equal(approved.command.resourceId,row.catalogId)
  assert.equal(approved.approvedFields['插件唯一标识'],'publisher/plugin')
  assert.equal(approved.approvedFields['版本号'],'1.0')
  assert.equal(approved.approvedFields['发布者账户名'],'chen.yu')
  const deadline=Date.now()+5000
  while(!commands.length && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,1)
  assert.equal(commands[0].action,'publish_package')
})

test('Skill和插件变更再审冻结旧新摘要，历史策略和升级策略分别生效',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-package-revision-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  let oldHash='a'.repeat(64)
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/execution-contexts/')) {
      const skill=path.includes('SKL-02')
      return json(res,{snapshotId:'old-context',ticketType:skill?'SKL-02':'PLG-02',action:skill?'revise_skill':'revise_package',
        resourceId:skill?'skill':'plugin',fields:{'原版本号':'1','原文件SHA-256':oldHash,'原版本指纹':oldHash,'插件唯一标识':'publisher/plugin'},
        preconditions:[{kind:skill?'skill':'plugin',id:skill?'skill':'plugin',revision:3}]})
    }
    if(path.includes('/intake/'))return json(res,{intakeId:'new-upload',status:'ready',sha256:'b'.repeat(64),sizeBytes:30,
      filename:'new.zip',scan:{verdict:'passed',checkedAt:'2026-11-18T01:00:00Z'},
      packageMetadata:{uniqueIdentifier:'publisher/plugin',name:'插件',version:'2',dependencies:[]}})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'new-version'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  for(const type of ['SKL-02','PLG-02']) {
    const ticketNo=type+'-revision'
    const input={ticketNo,ticketType:type,resourceId:type==='SKL-02'?'skill':'plugin',fields:{
      intakeId:'new-upload',newVersion:'2',changeDescription:'更新文件',compatibility:'保持兼容',upgradePolicy:'逐个工单升级'}}
    assert.equal((await request('/api/applications',user,input)).status,201)
    const decision={ticketNo,revision:1,action:'批准',note:'核对版本'}
    assert.equal((await request('/api/applications/transition',ops,decision)).status,400)
    const valid={...decision,historyPolicy:'保留且不可新增下载',externalAllowed:'允许'}
    oldHash='c'.repeat(64)
    assert.equal((await request('/api/applications/transition',ops,valid)).status,409)
    oldHash='a'.repeat(64)
    const approved=await(await request('/api/applications/transition',ops,valid)).json()
    assert.equal(approved.approvedFields['新版本号'],'2')
    assert.equal(approved.approvedFields[type==='SKL-02'?'历史版本下载策略':'升级策略'],
      type==='SKL-02'?'保留且不可新增下载':'逐个工单升级')
    assert.equal(approved.preconditions[0].revision,3)
    assert.equal(approved.preconditions[1].sha256,'b'.repeat(64))
  }
  const deadline=Date.now()+5000
  while(commands.length<2 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.deepEqual(commands.map(c=>c.action).sort(),['revise_package','revise_skill'])
})

test('PLG-03 安装升级卸载按可信工作区与实例冻结，禁用升级策略拒绝',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'management-plugin-operation-'))
  const {body}=await import('../../runtime/http.mjs')
  const commands=[]
  let allowUpgrade=false
  let installationRevision=1
  const capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/capabilities')return json(res,{items:['install','upgrade','uninstall'].map(action=>({
      ticketType:'PLG-03',ticketTypeVersion:'1',action,variant:null,state:'verified'}))})
    if(path.includes('/catalog/')) {
      assert.equal(new URL(req.url,'http://localhost').searchParams.get('workspaceId'),'ws')
      return json(res,{resourceId:'plugin',name:'插件',status:'approved',data:{version:'2',sha256:'a'.repeat(64),installAccess:'instant'}})
    }
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'op-ctx',ticketType:'PLG-03',
      action:new URL(req.url,'http://localhost').searchParams.get('action'),resourceId:'plugin',eligible:true,
      fields:{'目标Dify workspace ID':'ws','插件名称':'插件','原安装版本号':'2','原安装指纹':'a'.repeat(64),'批准版本号':'2','版本指纹':'a'.repeat(64),'安装实例ID':'instance',
        '权限匹配结果':'免审','升级策略':allowUpgrade?'逐个工单升级':'仅新安装使用新版本'},
      preconditions:[{kind:'plugin_installation',id:'instance',revision:installationRevision},{kind:'plugin',id:'plugin',sha256:'a'.repeat(64)}]})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req));return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'installed'}}))
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data && JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const preview='/api/plugin-operation-context?resourceId=plugin&workspaceId=ws&operation='+encodeURIComponent('安装')
  assert.equal((await request(preview,'')).status,403)
  assert.equal((await request(preview,user)).status,200)
  assert.equal((await request('/api/plugin-operation-context?resourceId=plugin&workspaceId=ws&operation=invalid',user)).status,400)
  const upgradeInput={ticketNo:'PLG-03-no-flow',ticketType:'PLG-03',resourceId:'plugin',workspaceId:'ws',fields:{operation:'升级',purpose:'测试'}}
  assert.equal((await request('/api/applications',user,upgradeInput)).status,409)
  const admin=await login('li.qiang')
  const draft={code:'PLG-03',version:'1',name:'插件操作',workspaceId:'ws',revision:0}
  let saved=await(await request('/api/types/draft',admin,draft)).json()
  assert.equal((await request('/api/types/publish',admin,saved)).status,409)
  saved=await(await request('/api/types/draft',admin,{...saved,branchFlows:{upgrade:'approval',uninstall:'approval'}})).json()
  assert.equal((await request('/api/types/publish',admin,saved)).status,200)
  for(const [index,operation] of ['安装','升级','卸载'].entries()) {
    const input={ticketNo:'PLG-03-'+index,ticketType:'PLG-03',resourceId:'plugin',workspaceId:'ws',fields:{operation,purpose:'测试使用',installationId:operation==='安装'?'':'instance'}}
    if(operation==='升级') {
      assert.equal((await request('/api/applications',user,input)).status,409)
      allowUpgrade=true
    }
    const row=await(await request('/api/applications',user,input)).json()
    assert.equal(row.status,operation==='安装'?'执行中':'待受理')
    if(operation!=='安装') {
      const approval={ticketNo:row.ticketNo,revision:1,action:'批准',note:'核验实例'}
      installationRevision=2
      assert.equal((await request('/api/applications/transition',ops,approval)).status,409)
      installationRevision=1
      assert.equal((await request('/api/applications/transition',ops,approval)).status,200)
    }
  }
  const deadline=Date.now()+5000
  while(commands.length<3 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.deepEqual(commands.map(c=>c.action).sort(),['install','uninstall','upgrade'])
  assert.equal(commands.find(c=>c.action==='install').payload.workspaceId,'ws')
  assert.ok(commands.every(c=>c.account==='chen.yu'))
})
