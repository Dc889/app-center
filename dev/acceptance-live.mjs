import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {localStack} from './services.mjs'
import {ledger} from '../runtime/http.mjs'
const output=resolve(process.argv[2]),dir=await mkdtemp(join(tmpdir(),'work-order-acceptance-')),checks=[],snapshots=[]
let stack
await mkdir(output,{recursive:true})
const persist=()=>writeFile(join(output,'live-evidence.json'),JSON.stringify({scope:'isolated_local_real_services',checks,snapshots},null,2)+'\n')
async function verify(id,fn){try{const evidence=await fn();checks.push({id,status:'passed',at:new Date().toISOString(),evidence});await persist();return evidence}catch(e){checks.push({id,status:'failed',at:new Date().toISOString(),message:e.message});await persist();throw e}}
try {
  stack=await localStack(dir)
  const internal=path=>fetch(stack.executor+'/internal/v1'+path,{headers:{authorization:'Bearer '+stack.token}})
  for(const workspaceId of [null,'ws-default','ws-ops','ws-dev']){const r=await internal('/capabilities'+(workspaceId?'?workspaceId='+workspaceId:''));assert.equal(r.status,200);snapshots.push({workspaceId,environment:'isolated local demo scope, not a verified deployment',...await r.json()})}
  await persist()
  const request=(path,cookie='',data)=>fetch(stack.management+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),operator=await login('zhou.min'),reviewer=await login('wang.ning'),admin=await login('li.qiang')
  const ticketNo='SKL-03-accept-'+randomUUID(),input={ticketNo,ticketType:'SKL-03',action:'download',account:'chen.yu',resourceId:'skl_doc'}
  const original=await verify('LIVE-SKL-03-ACCEPT',async()=>{const r=await request('/api/tickets',user,input);assert.equal(r.status,200);const row=await r.json();assert.equal(row.status,'awaiting_delivery');return {ticketNo,resultId:row.resultId,status:row.status}})
  await verify('LIVE-SKL-03-ACCESS',async()=>{const path='/api/tickets/'+ticketNo+'/file';const anonymous=await request(path),foreign=await request(path,operator);assert.equal(anonymous.status,404);assert.equal(foreign.status,404);return {ticketNo,anonymous:anonymous.status,foreign:foreign.status}})
  await verify('LIVE-SKL-03-DELIVERY-IDEMPOTENCY',async()=>{
    const repeated=await(await request('/api/tickets',user,input)).json();assert.equal(repeated.resultId,original.resultId)
    const hashes=[]
    for(let i=0;i<2;i++){const r=await request('/api/tickets/'+ticketNo+'/file',user);assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer()),sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,r.headers.get('x-content-sha256'));assert.equal(bytes.length,99);hashes.push(sha256);const row=await(await request('/api/tickets/'+ticketNo,user)).json();assert.equal(row.status,'succeeded');assert.equal(row.resultId,original.resultId)}
    assert.equal(hashes[0],hashes[1]);return {ticketNo,resultId:original.resultId,bytesPerTransfer:99,sha256:hashes[0],sameResultOnRepeatedRequest:true,finalStatus:'succeeded'}
  })
  const count=()=>{const store=ledger(dir,'executions');try{return store.all().length}finally{store.close()}}
  const countBefore=count(),eventNo='EVT-01-accept-'+randomUUID()
  await verify('LIVE-EVT-01-MANUAL-CLOSE',async()=>{
    const r=await request('/api/events',user,{ticketNo:eventNo,resourceId:'acceptance-manual-object',objectType:'插件',facts:'本地验收人工报告，不表示真实产品故障'});assert.equal(r.status,201);let row=await r.json()
    async function transition(cookie,action,extra={}){const response=await request('/api/events/transition',cookie,{ticketNo:eventNo,revision:row.revision,action,note:'本地验收依据',...extra});if(response.ok)row=await response.json();return response.status}
    assert.equal(await transition(admin,'开始处置'),403)
    assert.equal(await transition(operator,'开始处置',{assessment:{severity:'一般',conclusion:'真实故障',cause:'未知',impact:'人工验收对象'}}),200)
    assert.equal(await transition(operator,'提交复核',{disposition:{actions:['观察'],result:'仅验收本地流转，不声称产品已恢复'}}),200)
    assert.equal(await transition(operator,'确认关闭'),403)
    assert.equal(await transition(reviewer,'确认关闭'),200)
    assert.equal(row.status,'已关闭');assert.equal(count(),countBefore)
    return {ticketNo:eventNo,status:row.status,revision:row.revision,adminDenied:403,selfReviewDenied:403,executionCountBefore:countBefore,executionCountAfter:count(),newResourceExecutions:0,timeline:row.history.map(h=>({at:h.at,actor:h.actor,action:h.action,fromStatus:h.fromStatus??null,toStatus:h.toStatus??null}))}
  })
  await verify('LIVE-RESTART-PERSISTENCE',async()=>{await stack.close();stack=await localStack(dir);const file=await(await request('/api/tickets/'+ticketNo,user)).json(),events=await(await request('/api/events?view=mine',user)).json();assert.equal(file.status,'succeeded');assert.equal(file.resultId,original.resultId);assert.equal(events.items.find(r=>r.ticketNo===eventNo).status,'已关闭');return {skillTicketNo:ticketNo,eventTicketNo:eventNo,skillStatus:file.status,eventStatus:'已关闭',sameResultId:true}})
  console.log('PASS live local acceptance:',ticketNo,eventNo,'; evidence live-evidence.json')
}catch(e){console.error(e);process.exitCode=1}finally{await stack?.close();await rm(dir,{recursive:true,force:true});await persist()}
