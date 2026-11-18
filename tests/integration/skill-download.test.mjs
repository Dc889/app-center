import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { localStack } from '../../dev/services.mjs'

const hash='656085df494bea2c4bec3c08e164ff66927cd3373abbc3b6e1e5451ffcf0a1e1'
async function setup(t) {
  const dir=await mkdtemp(join(tmpdir(),'app-center-contract-'))
  let stack=await localStack(dir)
  t.after(async()=>{await stack.close(); await rm(dir,{recursive:true,force:true})})
  return {get stack(){return stack},async restart(){await stack.close();stack=await localStack(dir)}}
}
test('管理端下发、文件交付、回执与重启后的工单查询',async t=>{
  const app=await setup(t)
  const request={ticketNo:'SKL-03-1001',ticketType:'SKL-03',action:'download',account:'chen.yu',resourceId:'skl_doc'}
  const post=(data,cookie='')=>fetch(app.stack.management+'/api/tickets',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(data)})
  const created=await post(request)
  assert.equal(created.status,200)
  const cookie=created.headers.get('set-cookie').split(';')[0]
  const reservation=await created.json()
  assert.equal(reservation.status,'awaiting_delivery')
  const approvedUrl=app.stack.management+'/internal/v1/approved-inputs/'+reservation.resultId.slice(3)
  assert.equal((await fetch(approvedUrl)).status,403)
  const approved=await (await fetch(approvedUrl,{headers:{authorization:'Bearer '+app.stack.token}})).json()
  assert.equal(approved.ticketNo,request.ticketNo)
  assert.deepEqual(approved.fields,{version:'v2.1.0',sha256:hash})
  const path='/api/tickets/'+request.ticketNo
  const get=(suffix='')=>fetch(app.stack.management+path+suffix,{headers:{cookie}})
  assert.equal((await fetch(app.stack.management+path+'/file')).status,404)
  assert.equal((await (await post(request,cookie)).json()).resultId,reservation.resultId)
  const denied=await post({...request,ticketNo:'other',resourceId:'skl_sheet',account:'zhou.min',org:'业务一部'},cookie)
  assert.equal(denied.status,403)
  for (let n=0;n<2;n++) {
    const file=await get('/file')
    assert.equal(file.status,200)
    assert.equal(file.headers.get('x-content-sha256'),hash)
    const bytes=Buffer.from(await file.arrayBuffer())
    assert.equal(bytes.length,99)
    assert.equal(createHash('sha256').update(bytes).digest('hex'),hash)
    assert.equal((await (await get()).json()).status,'succeeded')
  }
  await app.restart()
  const final=await (await get()).json()
  assert.equal(final.resultId,reservation.resultId)
  assert.equal(final.status,'succeeded')
  const items=await (await fetch(app.stack.management+'/api/tickets?account=chen.yu',{headers:{cookie}})).json()
  assert.equal(items.items.length,1)
})
test('能力端校验动作、重复投递和交付边界',async t=>{
  const {stack}=await setup(t)
  const post=(cmd)=>fetch(stack.executor+'/internal/v1/executions',{method:'POST',headers:{authorization:'Bearer '+stack.token,'content-type':'application/json'},body:JSON.stringify(cmd)})
  const c={executionId:'x1',ticketNo:'t1',ticketType:'SKL-03',ticketTypeVersion:'1',action:'download',resourceId:'skl_doc',account:'chen.yu',org:'业务一部',payload:{version:'v2.1.0',sha256:hash}}
  assert.equal((await post({...c,action:'install'})).status,400)
  const responses=await Promise.all([post(c),post(c)])
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,202])
  assert.equal((await post({...c,resourceId:'skl_sheet'})).status,409)
  assert.equal((await post({...c,executionId:'second'})).status,409)
  const headers={authorization:'Bearer '+stack.token,'x-account':c.account,'x-org':encodeURIComponent(c.org)}
  const receipt=await fetch(stack.executor+'/internal/v1/downloads/DL-x1/receipt',{method:'PUT',headers,body:JSON.stringify({sha256:hash,bytesSent:98})})
  assert.equal(receipt.status,409)
  assert.equal((await fetch(stack.executor+'/internal/v1/executions/x1')).status,403)
  const missing=await post({...c,executionId:'x3',ticketType:'KEY-02',action:'revoke_key',payload:{decisionRef:'dec1'}})
  assert.equal((await missing.json()).result.failureCode,'UPSTREAM_UNSUPPORTED')
})
