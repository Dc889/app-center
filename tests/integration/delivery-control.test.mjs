import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../management/app/server/service.mjs'
import {body,json,listen,digest,ledger} from '../../runtime/http.mjs'
import {mockExecution,mockDownload,mockDelivered} from '../support/execution-state.mjs'

async function fixture(t,{hold=false,rejectReceipt=false,loseCancel=false,unsupported=false,invalidReceipt=false}={}) {
  const dir=await mkdtemp(join(tmpdir(),'delivery-control-')),bytes=Buffer.from('verified delivery'),sha256=digest(bytes)
  let command,state,files=0,receipts=0,cancels=0,posts=0,sourceIps=[],release,started
  const gate=new Promise(resolve=>{release=resolve}),entered=new Promise(resolve=>{started=resolve})
  const apis=[]
  const capability=await listen(async(req,res,path)=>{
    if(path.endsWith('/catalog'))return json(res,{items:[{resourceId:'skill',name:'Skill',status:'available',actions:['download'],data:{version:'1',sha256}}],nextCursor:null})
    if(path.includes('/catalog/skill/'))return json(res,{resourceId:'skill',status:'available',actions:['download'],data:{version:'1',sha256}})
    if(req.method==='POST' && path.endsWith('/executions')) {
      command=await body(req);posts++
      state=mockDownload(command,'DL-'+command.executionId,{sizeBytes:bytes.length})
      return json(res,state)
    }
    if(path.endsWith('/cancel')) {
      cancels++;assert.deepEqual(await body(req),{})
      if(unsupported)return json(res,{error:{code:'UPSTREAM_UNSUPPORTED'}},501)
      const proof=await fetch(apis[0].url+'/internal/v1/delivery-checks/DL-'+command.executionId+'/close',{method:'POST',headers:{authorization:'Bearer test'}})
      assert.equal(proof.status,200);assert.equal((await proof.json()).state,'closed_unserved')
      state=mockExecution(command,{status:'cancelled',result:{failureCode:'CANCELLED'}})
      if(loseCancel){loseCancel=false;return json(res,{error:{code:'RESPONSE_LOST'}},503)}
      return json(res,state)
    }
    if(path.includes('/downloads/')) {
      if(path.endsWith('/receipt')) {
        receipts++;sourceIps.push(req.headers['x-source-ip']);const input=await body(req)
        assert.deepEqual(input,{sha256,bytesSent:bytes.length})
        if(rejectReceipt)return json(res,{error:{code:'TRY_LATER'}},503)
        if(invalidReceipt)return json(res,mockExecution(command,{status:'failed',result:{failureCode:'WRONG_RESULT'}}))
        state=mockDelivered(command,'DL-'+command.executionId)
        return json(res,state)
      }
      files++;started();if(hold)await gate
      res.writeHead(200,{'content-type':'text/plain','content-length':bytes.length,'content-disposition':'attachment; filename="file.txt"','x-content-sha256':sha256})
      return res.end(bytes)
    }
    return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const options={dir,token:'test',executor:capability.url}
  let api=await startManagement(options);apis.push(api)
  t.after(async()=>{release();for(const a of apis)await a.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie='',data,method,internal=false,base=api.url)=>fetch(base+path,{method:method ?? (data===undefined?'GET':'POST'),headers:{cookie,
    'content-type':'application/json',...(internal?{authorization:'Bearer test'}:{})},body:data===undefined?undefined:JSON.stringify(data)})
  const login=async account=>(await request('/api/demo-session','',{account})).headers.get('set-cookie').split(';')[0]
  const user=await login('chen.yu'),ops=await login('zhou.min'),admin=await login('li.qiang')
  const submitted=await request('/api/tickets',user,{ticketNo:'SKL-03-control',ticketType:'SKL-03',action:'download',resourceId:'skill',account:'chen.yu'})
  assert.equal(submitted.status,200);const ticket=await submitted.json(),resultId=ticket.resultId
  const close=(internal=true,base)=>request('/internal/v1/delivery-checks/'+resultId+'/close','',undefined,'POST',internal,base)
  const record=()=>{const db=ledger(dir,'tickets');const r=db.get(ticket.ticketNo);db.close();return r}
  async function until(fn){const end=Date.now()+6500;while(Date.now()<end){const r=await fn();if(r)return r;await new Promise(resolve=>setTimeout(resolve,40))}assert.fail('交付状态未到达预期')}
  return {dir,user,ops,admin,ticket,resultId,bytes,request,close,record,until,entered,release,base:()=>api.url,
    cancel(cookie=ops,executionId=command.executionId){return request('/api/tickets/'+ticket.ticketNo+'/cancel',cookie,{executionId,note:'核对原流水后取消'})},
    counts:()=>({files,receipts,cancels,posts}),sourceIps:()=>sourceIps,setState(value){state=value},
    receiptsAllowed(){rejectReceipt=false;invalidReceipt=false},
    async second(){const a=await startManagement(options);apis.push(a);return a.url},
    async restart(){await api.close();apis.splice(apis.indexOf(api),1);api=await startManagement(options);apis.push(api)},
  }
}

test('关闭检查仅服务身份可用，未发送原子封存并阻止重启后领取',async t=>{
  const f=await fixture(t)
  assert.equal((await f.close(false)).status,403)
  assert.equal((await f.request('/internal/v1/delivery-checks/missing/close','',undefined,'POST',true)).status,404)
  assert.deepEqual(await(await f.close()).json(),{state:'closed_unserved'})
  assert.deepEqual(await(await f.close()).json(),{state:'closed_unserved'})
  assert.equal((await f.request(f.ticket.downloadUrl,f.user)).status,409)
  await f.restart()
  assert.equal((await f.request(f.ticket.downloadUrl,f.user)).status,409)
  assert.equal(f.counts().files,0);assert.equal(f.counts().receipts,0)
})

test('在途关闭返回未知且封住新领取，另一实例不能抢占，已有发送和回执可完成',async t=>{
  const f=await fixture(t,{hold:true,rejectReceipt:true})
  const pending=f.request(f.ticket.downloadUrl,f.user)
  await Promise.race([f.entered,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('未开始取文件')),5000);timer.unref()})])
  const second=await f.second()
  assert.equal((await f.request(f.ticket.downloadUrl,f.user,undefined,'GET',false,second)).status,409)
  assert.equal((await f.close(true,second)).status,409)
  assert.equal((await f.cancel()).status,409)
  f.release();const file=await pending
  assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),f.bytes)
  await f.until(()=>f.record().receipt)
  assert.deepEqual(await(await f.close()).json(),{state:'receipt_pending'})
  assert.equal((await f.request(f.ticket.downloadUrl,f.user)).status,409)
  f.receiptsAllowed();await f.restart()
  await f.until(()=>f.record().delivery.status==='confirmed')
  assert.equal(f.counts().files,1)
  assert.deepEqual(await(await f.close()).json(),{state:'receipt_pending'})
  assert.ok(f.sourceIps().every(ip=>ip==='127.0.0.1'))
})

test('发送证据不完整的历史记录不能按未发送关闭，重启也不推断安全',async t=>{
  const f=await fixture(t)
  const db=ledger(f.dir,'tickets'),row=db.get(f.ticket.ticketNo)
  db.put(row.ticketNo,{...row,delivery:{status:'sending',stage:'emitting',transferId:'crashed'}});db.close()
  await f.restart()
  assert.equal(f.record().delivery.status,'uncertain')
  assert.equal((await f.close()).status,409);assert.equal((await f.cancel()).status,409)
  await f.restart();assert.equal((await f.close()).status,409)
  assert.equal((await f.request(f.ticket.downloadUrl,f.user)).status,409)
  assert.equal(f.counts().files,0)
})

test('取文件期间客户端断开且尚未发出字节时，关闭可以证明未发送',async t=>{
  const f=await fixture(t,{hold:true}),controller=new AbortController()
  const pending=fetch(f.base()+f.ticket.downloadUrl,{headers:{cookie:f.user},signal:controller.signal}).catch(e=>e)
  await Promise.race([f.entered,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('未进入读取')),5000);timer.unref()})])
  controller.abort();await pending
  await f.until(()=>f.record().delivery.status==='interrupted')
  f.release()
  assert.equal(f.record().delivery.stage,'fetching')
  assert.deepEqual(await(await f.close()).json(),{state:'closed_unserved'})
  assert.equal(f.counts().receipts,0)
})

test('取消仅运维办理，响应丢失后查询原执行，不重建也不重复取消',async t=>{
  const f=await fixture(t,{loseCancel:true})
  assert.equal((await f.cancel(f.user)).status,403);assert.equal((await f.cancel(f.admin)).status,403)
  assert.equal((await f.cancel(f.ops,'wrong')).status,409)
  const uncertain=await f.cancel();assert.equal(uncertain.status,200)
  assert.equal((await uncertain.json()).cancelStatus,'uncertain')
  assert.equal((await f.request(f.ticket.downloadUrl,f.user)).status,409)
  await f.restart()
  const resolved=await f.request('/api/tickets/'+f.ticket.ticketNo+'/reconcile',f.ops,{executionId:f.record().command.executionId,note:'只读核对原取消结果'});assert.equal(resolved.status,200)
  assert.equal((await resolved.json()).status,'cancelled')
  assert.equal((await f.cancel()).status,200)
  assert.deepEqual(f.counts(),{files:0,receipts:0,cancels:1,posts:1})
})

test('组件不支持取消时明确记录，不把工单伪造为已终止或重新执行',async t=>{
  const f=await fixture(t,{unsupported:true})
  const r=await f.cancel();assert.equal(r.status,200)
  const state=await r.json();assert.equal(state.cancelStatus,'unsupported');assert.equal(state.status,'awaiting_delivery')
  assert.equal((await f.request(f.ticket.downloadUrl,f.user)).status,409)
  assert.equal(f.counts().posts,1)
})

test('错误回执结果不能清除待结算事实，关闭只报告已交付待回执',async t=>{
  const f=await fixture(t,{invalidReceipt:true})
  const file=await f.request(f.ticket.downloadUrl,f.user);assert.equal(file.status,200);await file.arrayBuffer()
  await f.until(()=>f.counts().receipts>0)
  await f.until(()=>f.record().receiptError)
  assert.equal(f.record().receiptError.code,'INVALID_RECEIPT_RESULT')
  const receiptsBefore=f.counts().receipts
  assert.equal((await f.request('/api/tickets/'+f.ticket.ticketNo+'/reconcile',f.ops,{executionId:f.record().command.executionId,note:'只读查询不提交回执'})).status,200)
  assert.equal(f.counts().receipts,receiptsBefore)
  assert.ok(f.record().receipt)
  assert.deepEqual(await(await f.close()).json(),{state:'receipt_pending'})
  f.receiptsAllowed();await f.restart();await f.until(()=>f.record().delivery.status==='confirmed')
  assert.equal(f.counts().files,1)
})

test('来源IP仅取可信连接，成功后的重复领取不改首份回执或重复结算',async t=>{
  const f=await fixture(t)
  const file=await fetch(f.base()+f.ticket.downloadUrl,{headers:{cookie:f.user,'x-forwarded-for':'203.0.113.99','x-source-ip':'203.0.113.98'}})
  assert.equal(file.status,200);await file.arrayBuffer()
  await f.until(()=>f.record().delivery.status==='confirmed')
  const original=f.record().receiptSourceIp
  assert.equal(original,'127.0.0.1')
  const again=await f.request(f.ticket.downloadUrl,f.user);assert.equal(again.status,200);await again.arrayBuffer()
  await f.until(()=>f.record().delivery.status==='confirmed')
  assert.equal(f.record().receiptSourceIp,original)
  assert.deepEqual(f.sourceIps(),[original]);assert.equal(f.counts().files,2)
})

test('文件台账拒绝缺失执行身份、元数据变更和无本地交付证据的成功，原执行不重建',async t=>{
  const f=await fixture(t),row=f.record(),valid=mockDownload(row.command,f.resultId,{sizeBytes:f.bytes.length})
  for(const key of ['executionId','ticketNo','updatedAt','delivery','result']) {
    const malformed={...valid};delete malformed[key];f.setState(malformed)
    const r=await f.request(f.ticket.downloadUrl,f.user)
    assert.equal(r.status,409,key);assert.equal(f.record().state.status,'awaiting_delivery')
    assert.equal(f.record().protocolBlocked,true);assert.equal(f.counts().files,0)
  }
  f.setState({...valid,delivery:{...valid.delivery,sizeBytes:100}})
  let r=await f.request(f.ticket.downloadUrl,f.user)
  assert.equal(r.status,409);assert.equal((await r.json()).error.code,'DELIVERY_METADATA_CHANGED')
  f.setState(mockDelivered(row.command,f.resultId))
  r=await f.request(f.ticket.downloadUrl,f.user)
  assert.equal(r.status,409);assert.equal((await r.json()).error.code,'LOCAL_DELIVERY_REQUIRED')
  f.setState(null)
  assert.equal((await f.request('/api/tickets/'+f.ticket.ticketNo+'/reconcile',f.ops,{executionId:row.command.executionId,note:'原流水只读查证'})).status,404)
  assert.equal(f.counts().posts,1)
  f.setState(valid)
  assert.equal((await f.request('/api/tickets/'+f.ticket.ticketNo+'/reconcile',f.ops,{executionId:row.command.executionId,note:'协议修复后查证'})).status,200)
  const file=await f.request(f.ticket.downloadUrl,f.user)
  assert.equal(file.status,200);await file.arrayBuffer()
  await f.until(()=>f.record().delivery.status==='confirmed')
  assert.equal(f.counts().files,1)
})
