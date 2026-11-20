import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ledger,json,listen} from '../../runtime/http.mjs'
import {startManagement} from '../../management/app/server/service.mjs'
import {seedSubjects} from '../../management/platform/identity/public.server.mjs'
import {mockExecution} from '../support/execution-state.mjs'

async function fixture(t,{type='AG-02',known=true,blocked=false}={}) {
  const dir=await mkdtemp(join(tmpdir(),'application-reconciliation-'))
  const ticketNo=type+'-historical',executionId='historical-execution'
  const command={executionId,ticketNo,ticketType:type,ticketTypeVersion:'1',account:'chen.yu',org:'业务一部',resourceId:'resource',action:type==='KEY-01'?'create_key':'publish',payload:{}}
  const store=ledger(dir,'applications')
  store.put(ticketNo,{ticketNo,ticketType:type,account:'chen.yu',org:'业务一部',status:'执行中',revision:1,command,
    approvedBy:'zhou.min',approvedFields:{},preconditions:[],snapshot:{snapshotId:'frozen',data:{}},submission:{resourceId:'resource',fields:{}},
    executionKnown:known,deliveryBlocked:blocked,attempts:[{command}],history:[]})
  store.close()
  let state=known?mockExecution(command,{status:'running'}):null,posts=0,reads=0
  const capability=await listen(async(req,res)=>{
    if(req.method==='POST'){posts++;return json(res,{error:{code:'UNEXPECTED_WRITE'}},409)}
    reads++;return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url,
    initialSubjects:seedSubjects.map(p=>p.account==='chen.yu'?{...p,account:'chen.current',aliases:['chen.yu']}:p)})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie='',data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined})
  async function login(account){return (await request('/api/demo-session','',{account})).headers.get('set-cookie').split(';')[0]}
  async function row(cookie){return (await(await request('/api/applications?view=query',cookie)).json()).items.find(r=>r.ticketNo===ticketNo)}
  async function until(fn){const end=Date.now()+6000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(resolve=>setTimeout(resolve,50))}assert.fail('原执行结果没有回写')}
  return {dir,ticketNo,executionId,command,request,login,row,until,setState(value){state=value},posts:()=>posts,reads:()=>reads}
}

test('业务申请人改名后继续读取已接单原执行，不能用旧名重建未知执行',async t=>{
  const f=await fixture(t),ops=await f.login('zhou.min')
  await f.until(async()=>{const r=await f.row(ops);return r.execution?.status==='running' && r})
  f.setState(mockExecution(f.command,{status:'succeeded',result:{resultId:'published'}}))
  const row=await f.until(async()=>{const r=await f.row(ops);return r.status==='待结果确认' && r})
  assert.equal(f.posts(),0);assert.ok(f.reads()>=2)
  assert.equal(row.command.account,'chen.yu');assert.equal(row.attempts[0].execution.result.resultId,'published')
  const missing=await fixture(t,{known:false}),operator=await missing.login('zhou.min')
  const blocked=await missing.until(async()=>{const r=await missing.row(operator);return r.deliveryBlocked && r})
  assert.equal(blocked.lastError.code,'APPLICANT_IDENTITY_UNAVAILABLE');assert.equal(missing.posts(),0)
})

test('KEY原执行查证沿用密钥结果脱敏，客户端提交结果不能替代可信服务',async t=>{
  const f=await fixture(t,{type:'KEY-01',blocked:true}),ops=await f.login('zhou.min'),admin=await f.login('li.qiang')
  let row=await f.row(ops)
  const data={ticketNo:f.ticketNo,revision:row.revision,action:'查证原执行',note:'核对密钥登记',execution:{status:'succeeded',result:{secret:'CLIENT-SECRET'}}}
  assert.equal((await f.request('/api/applications/transition',admin,data)).status,403)
  f.setState(mockExecution(f.command,{status:'succeeded',result:{resultId:'key-ref',secret:'UPSTREAM-SECRET',
    details:{secret:'UPSTREAM-SECRET',values:{secret:'UPSTREAM-SECRET'},registrationId:'registration','密钥后四位':'1234'}}}))
  const response=await f.request('/api/applications/transition',ops,data)
  assert.equal(response.status,200);row=await response.json()
  assert.equal(row.status,'待领取密钥');assert.equal(row.execution.result.details.registrationId,'registration')
  assert.equal(JSON.stringify(row).includes('SECRET'),false)
  const persisted=ledger(f.dir,'applications');const raw=persisted.get(f.ticketNo);persisted.close()
  assert.equal(JSON.stringify(raw).includes('SECRET'),false)
  assert.equal(f.posts(),0)
})

test('业务自动查询与人工查证均严格拒绝缺失协议字段，错误结果不落入执行历史',async t=>{
  const f=await fixture(t,{blocked:true}),ops=await f.login('zhou.min')
  const valid=mockExecution(f.command,{status:'succeeded',result:{resultId:'verified'}})
  for(const key of ['executionId','ticketNo','updatedAt','delivery','result']) {
    const raw={...valid};delete raw[key];f.setState(raw)
    const row=await f.row(ops)
    const response=await f.request('/api/applications/transition',ops,{ticketNo:f.ticketNo,revision:row.revision,action:'查证原执行',note:'严格核对响应'})
    assert.equal(response.status,200)
    const blocked=await response.json()
    assert.equal(blocked.deliveryBlocked,true);assert.equal(blocked.execution,undefined)
    assert.equal(blocked.attempts[0].execution,undefined)
  }
  f.setState(valid)
  const row=await f.row(ops)
  await f.request('/api/applications/transition',ops,{ticketNo:f.ticketNo,revision:row.revision,action:'查证原执行',note:'原协议已修复'})
  assert.equal((await f.row(ops)).status,'待结果确认')
  assert.equal(f.posts(),0)
})
