import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {eventMonitor,eventEvidence} from '../../server/event-monitor.mjs'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,ledger} from '../../../../../runtime/http.mjs'
const now=Date.parse('2026-11-19T02:00:00Z'),at=minutes=>new Date(now-minutes*60000).toISOString()
function event(ticketNo='EVT-01-test',extra={}){return {ticketNo,alertId:'AL-test',resourceId:'p',objectType:'插件',creationMode:'人工报告',status:'未研判',revision:1,originalSeverity:'一般',firstOccurredAt:at(30),lastOccurredAt:at(1),history:[{at:at(30),actor:'chen.yu',action:'人工报告'}],...extra}}
test('事件统计按状态时间线计次、研判级别覆盖、处置均值P95与筛选分页同口径',()=>{
  const closed=event('EVT-01-closed',{status:'已关闭',assessment:{severity:'紧急'},history:[{at:at(30),actor:'chen.yu',action:'人工报告'},
    {at:at(25),actor:'zhou.min',action:'开始处置'},{at:at(20),actor:'zhou.min',action:'提交复核'},{at:at(15),actor:'wang.ning',action:'重新处置'},
    {at:at(14),actor:'zhou.min',action:'开始处置'},{at:at(12),actor:'zhou.min',action:'提交复核'},{at:at(10),actor:'wang.ning',action:'确认关闭'}]})
  const handling=event('EVT-01-working',{status:'处理中'}),missing=event('EVT-01-missing',{status:'已关闭',firstOccurredAt:null,history:[]})
  const rows=[closed,handling,missing],result=eventMonitor(rows,new URLSearchParams('range=1h&limit=1'),now)
  assert.equal(result.cards.handling,1);assert.equal(result.cards.closedToday,1);assert.equal(result.cards.urgent,0)
  assert.equal(result.trend.reduce((n,p)=>n+p.added,0),2);assert.equal(result.trend.reduce((n,p)=>n+p.closed,0),1);assert.equal(result.trend.reduce((n,p)=>n+p.reopened,0),1)
  const duration=result.durations.find(r=>r.objectType==='插件');assert.equal(duration.meanMinutes,20);assert.equal(duration.p95Minutes,20);assert.equal(duration.count,1);assert.equal(duration.excluded,1)
  assert.equal(result.distribution.find(r=>r.severity==='紧急')['插件'],1);assert.equal(result.items.length,1);assert.equal(result.total,3)
  const filtered=eventMonitor(rows,new URLSearchParams('status=处理中'),now);assert.equal(filtered.total,1);assert.equal(filtered.cards.closedToday,0)
  assert.equal(eventMonitor(rows,new URLSearchParams('q=working'),now).items[0].ticketNo,'EVT-01-working')
  for(const query of ['page=0','page=1.5','limit=101','status=bogus','range=forever'])assert.throws(()=>eventMonitor(rows,new URLSearchParams(query),now))
  const midnight=Date.parse('2026-11-18T16:00:00Z')
  const yesterday=event('EVT-01-yesterday',{status:'已关闭',history:[{at:'2026-11-18T15:59:59Z',action:'确认关闭'}]})
  assert.equal(eventMonitor([yesterday],new URLSearchParams(),midnight).cards.closedToday,0)
})
test('证据白名单、错事件/倒序指标拒绝，关联执行按当前结果去重且排除异对象/账号泄漏',()=>{
  const sample=event('EVT-01-test',{sourceTicketNo:'PLG-04-one',relatedTicketNos:['ACC-private','PLG-04-other'],evidence:{password:'SECRET',
    metrics:{resourceId:'p',alertId:'AL-test',unit:'%',points:[{at:at(3),value:40,threshold:30,credential:'SECRET'},{at:at(2),value:45,threshold:30}]},
    logs:[{at:at(2),source:'plugin',resourceId:'p',level:'ERROR',redacted:true,message:'token=SECRET Bearer SECRET',credential:'SECRET'},{at:at(2),source:'raw',resourceId:'p',level:'ERROR',message:'SECRET'}]}})
  const command={executionId:'execution',resourceId:'p',ticketType:'PLG-04',action:'disable_plugin',payload:{secret:'SECRET'}}
  const execution={updatedAt:at(1),status:'failed',result:{failureCode:'UPSTREAM_UNSUPPORTED',details:{secret:'SECRET'}}}
  const related=[{ticketNo:'PLG-04-one',command,execution,attempts:[{command,execution:{...execution,status:'running'}}]},
    {ticketNo:'PLG-04-other',command:{...command,executionId:'other',resourceId:'different'},execution}]
  const result=eventEvidence(sample,related,now)
  assert.equal(result.actions.length,1);assert.equal(result.actions[0].result,'failed');assert.equal(result.actions[0].adapter,null)
  assert.equal(result.metrics.points.length,2);assert.equal(result.logs.length,1);assert.ok(!JSON.stringify(result).includes('SECRET'));assert.ok(!JSON.stringify(result).includes('ACC-private'))
  sample.evidence.metrics.alertId='different';assert.equal(eventEvidence(sample,related,now).metrics,null)
  sample.evidence.metrics.alertId='AL-test';sample.evidence.metrics.points.reverse();assert.equal(eventEvidence(sample,related,now).metrics,null)
  const manual=eventEvidence(event(),[],now);assert.equal(manual.metrics,null);assert.deepEqual(manual.actions,[]);assert.equal(manual.timeline[0].fromStatus,null);assert.equal(manual.timeline[0].toStatus,'未研判')
  assert.ok(eventEvidence(sample,[],now,true).basic.relatedTicketNos.includes('ACC-private'))
})
test('监控只读权限、真实报告/研判/独立关闭后刷新，显式状态历史持久化，零能力调用',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'event-monitor-'));let calls=0,api
  const cap=await listen((req,res)=>{calls++;return json(res,{error:{code:'NOT_FOUND'}},404)})
  api=await startManagement({dir,executor:cap.url,token:'test'})
  t.after(async()=>{await api.close();await cap.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min'),reviewer=await login('wang.ning'),admin=await login('li.qiang'),path='/api/event-monitor'
  assert.equal((await request(path,'')).status,403);assert.equal((await request(path,user)).status,403)
  const input={ticketNo:'EVT-01-new',resourceId:'p',objectType:'插件',facts:'真实报告'}
  assert.equal((await request('/api/events',user,input)).status,201)
  assert.equal((await(await request(path,ops)).json()).cards.unassessed,1)
  let row=await(await request(path+'/'+input.ticketNo,admin)).json();assert.equal(row.timeline[0].toStatus,'未研判')
  async function transition(cookie,action,extra={}){const result=await request('/api/events/transition',cookie,{ticketNo:input.ticketNo,revision:row.basic.revision,action,note:'按证据核验',...extra});row=await(await request(path+'/'+input.ticketNo,ops)).json();return result}
  assert.equal((await transition(admin,'开始处置')).status,403)
  assert.equal((await transition(ops,'开始处置',{assessment:{severity:'紧急',conclusion:'真实故障',cause:'未知',impact:'单插件'}})).status,200)
  assert.equal((await(await request(path,ops)).json()).cards.urgent,1)
  assert.equal((await transition(ops,'提交复核',{disposition:{actions:['观察'],result:'已核对'}})).status,200)
  assert.equal((await transition(ops,'确认关闭')).status,403)
  assert.equal((await transition(reviewer,'确认关闭')).status,200)
  assert.equal((await(await request(path,admin)).json()).cards.closedToday,1);assert.equal(row.timeline.at(-1).fromStatus,'待复核');assert.equal(row.timeline.at(-1).toStatus,'已关闭');assert.equal(calls,0)
  await api.close();api=await startManagement({dir,executor:cap.url,token:'test'})
  assert.equal((await(await request(path,await login('zhou.min'))).json()).cards.closedToday,1)
  const store=ledger(dir,'reported-events');assert.equal(store.get(input.ticketNo).history.at(-1).toStatus,'已关闭');store.close()
})
