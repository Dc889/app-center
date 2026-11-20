import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {overviewWindow,readOverviewSnapshot,managementOverview} from '../../server/overview.mjs'
import {overviewFixture} from '../../../../../tests/support/overview.mjs'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,ledger} from '../../../../../runtime/http.mjs'

test('观测汇总拒绝错范围、不完整时间桶及伪零，未知字段裁剪，过期保留时间',()=>{
  const now=Date.parse('2026-11-19T06:00:00Z'),window=overviewWindow('1h',now)
  const raw=overviewFixture(window,now);raw.resources.data[0].credential='SECRET';raw.health.data[0].password='SECRET'
  const valid=readOverviewSnapshot(raw,window,now)
  assert.equal(valid.resources.data[0].count,0);assert.equal(valid.resources.data[0].delta,null);assert.ok(!JSON.stringify(valid).includes('SECRET'))
  raw.calls.data.pop();assert.equal(readOverviewSnapshot(raw,window,now).calls.state,'unavailable')
  raw.resources.data[0].count=-1;assert.equal(readOverviewSnapshot(raw,window,now).resources.data,null)
  raw.health.data[0].checkedAt='2020-01-01T00:00:00Z';assert.equal(readOverviewSnapshot(raw,window,now).health.data[0].status,'stale')
  raw.scope='other';assert.equal(readOverviewSnapshot(raw,window,now).health.data,null)
  const old=overviewFixture(window,now-360000);assert.equal(readOverviewSnapshot(old,window,now).calls.state,'stale')
  const duplicate=overviewFixture(window,now);duplicate.calls.data[1].at=duplicate.calls.data[0].at;assert.equal(readOverviewSnapshot(duplicate,window,now).calls.state,'unavailable')
  duplicate.health.data[0].latencyMs=-1;assert.equal(readOverviewSnapshot(duplicate,window,now).health.state,'unavailable')
  assert.equal(overviewWindow('7d',now).bucketMs,3600000)
  const partial=overviewFixture(window,now)
  partial.resources.data[0]={key:'agents',state:'unavailable',count:null,yesterdayCount:null}
  partial.health.data[0]={key:'management',status:'unavailable',instance:null,version:null,checkedAt:null,latencyMs:null,consecutiveFailures:null,evidenceRef:null}
  assert.equal(readOverviewSnapshot(partial,window,now).resources.data[0].count,null)
  assert.equal(readOverviewSnapshot(partial,window,now).health.data[1].status,'healthy')
  partial.resources.data[0].count=0;assert.equal(readOverviewSnapshot(partial,window,now).resources.state,'unavailable')
})
test('待办按工单去重、包含非标准进行态，运维不接触账号台账，告警按最高级别排序',()=>{
  const args={applications:[{ticketNo:'AG-02-a',ticketType:'AG-02',status:'待受理'},{ticketNo:'KB-02-b',ticketType:'KB-02',status:'待结果确认'},{ticketNo:'AG-01-c',ticketType:'AG-01',status:'已完成'}],
    tickets:[{ticketNo:'AG-02-a',command:{ticketType:'AG-02'},state:{status:'running'}}],accounts:[{ticketNo:'ACC-private',ticketType:'ACC-01',status:'待受理',history:[{at:'2026-11-19T00:00:00Z',actor:'PRIVATE',action:'PRIVATE'}]}],
    events:[{ticketNo:'e1',resourceId:'p',objectType:'插件',creationMode:'系统告警',status:'未研判',originalSeverity:'紧急'},{ticketNo:'e2',resourceId:'p',objectType:'插件',creationMode:'系统告警',status:'未研判'},
      {ticketNo:'e3',resourceId:'p',objectType:'插件',creationMode:'系统告警',status:'已关闭',originalSeverity:'严重'},{ticketNo:'e4',resourceId:'p',objectType:'插件',creationMode:'人工上报',status:'未研判'}]}
  const ops=managementOverview(args);assert.equal(ops.businessPending,5);assert.equal(ops.alertCount,2);assert.equal(ops.alertObjects[0].severity,'紧急')
  assert.equal(ops.pending.find(r=>r.status==='待结果确认').KB,1);assert.ok(!JSON.stringify(ops).includes('PRIVATE'));assert.equal(ops.accountPending,null)
  const admin=managementOverview({...args,admin:true});assert.equal(admin.accountPending,1);assert.equal(admin.recent[0].ticketNo,'ACC-private')
})
test('总览接口可信身份/角色、缺下游仍返回真实台账、变更后刷新及重启保留',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'overview-'));let mode='missing',api
  const events=ledger(dir,'reported-events'),history=[{at:'2026-11-19T00:00:00Z',actor:'chen.yu',action:'上报事件'}]
  events.put('EVT-01-one',{ticketNo:'EVT-01-one',objectType:'插件',resourceId:'p',creationMode:'系统告警',status:'未研判',originalSeverity:'一般',history})
  events.close()
  const cap=await listen((req,res,path)=>{
    if(path!=='/internal/v1/overview-summary' || mode==='missing')return json(res,{error:{code:'NOT_FOUND'}},404)
    assert.ok(['operator','admin'].includes(req.headers['x-role']));assert.ok(['zhou.min','li.qiang'].includes(req.headers['x-account']))
    const q=new URL(req.url,'http://localhost').searchParams;assert.equal(q.get('view'),'monitor')
    return json(res,overviewFixture({from:q.get('from'),to:q.get('to'),bucketMs:Number(q.get('bucketMs'))}))
  })
  api=await startManagement({dir,executor:cap.url,token:'test'})
  t.after(async()=>{await api.close();await cap.close();await rm(dir,{recursive:true,force:true})})
  async function login(account){const r=await fetch(api.url+'/api/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account})});return r.headers.get('set-cookie').split(';')[0]}
  const get=(cookie,range='24h')=>fetch(api.url+'/api/overview?range='+range,{headers:{cookie,'x-role':'admin'}})
  assert.equal((await get('')).status,403);assert.equal((await get(await login('chen.yu'))).status,403)
  let ops=await login('zhou.min');assert.equal((await get(ops,'forever')).status,400)
  const missing=await(await get(ops)).json();assert.equal(missing.health.state,'unavailable');assert.equal(missing.management.alertCount,1)
  const identities=ledger(dir,'identity-workflows');identities.put('ticket:ACC-private',{kind:'account-ticket',ticketNo:'ACC-private',ticketType:'ACC-01',status:'待受理',history:[{at:'2026-11-19T00:00:00Z',actor:'li.qiang',action:'PRIVATE-ACCOUNT-EVENT'}]});identities.close()
  const admin=await login('li.qiang'),opsOnly=await(await get(ops)).json(),adminView=await(await get(admin)).json()
  assert.ok(!JSON.stringify(opsOnly).includes('PRIVATE-ACCOUNT-EVENT'));assert.equal(opsOnly.management.accountPending,null)
  assert.equal(adminView.management.accountPending,1);assert.equal(adminView.management.recent[0].action,'PRIVATE-ACCOUNT-EVENT')
  const store=ledger(dir,'reported-events');store.put('EVT-01-one',{...store.get('EVT-01-one'),status:'已关闭'});store.close()
  assert.equal((await(await get(ops)).json()).management.alertCount,0)
  mode='ok';assert.equal((await(await get(ops,'1h')).json()).resources.data[0].count,0)
  await api.close();api=await startManagement({dir,executor:cap.url,token:'test'});ops=await login('zhou.min')
  assert.equal((await(await get(ops)).json()).management.alertCount,0)
})
