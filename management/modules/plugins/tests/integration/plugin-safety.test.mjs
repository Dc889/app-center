import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {body,json,listen} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'

async function fixture(t,{control='verified',failDisable=false,badResult=false}={}) {
  const dir=await mkdtemp(join(tmpdir(),'plugin-safety-'))
  const commands=[],executions=new Map()
  let clock=Date.now(),revision=1,pluginState='已启用',instance='installation',cycle='cycle-1'
  let observation={verdict:'数据不足',complete:false,coverageOffset:0}
  const capability=await listen(async(req,res,path)=>{
    const query=new URL(req.url,'http://localhost').searchParams
    if(path.includes('/execution-contexts/PLG-04')) {
      const event=query.get('sourceEventId') ?? 'obs-failure'
      const end=new Date(clock).toISOString(),start=new Date(clock-300000).toISOString()
      const f={'workspace ID':'ws','插件名称':'测试插件','版本号':'1','安装实例ID':control==='verified'?instance:null,
        '禁用周期ID':cycle,'定向操作能力':control,'实例状态':pluginState,'告警ID':event,
        '触发规则':event==='memory'?'内存':event.startsWith('timeout')?'超时率':'失败率',
        '统计数据完整':event!=='incomplete','统计窗口':{start,end,calls:event==='low'?19:20,
          failures:event==='below'?5:6,timeouts:event==='timeout-low'?3:4},
        '证据日志':[{at:end,level:'ERROR',pluginId:'plugin',message:'定向插件调用失败'}]}
      if(query.get('phase')==='observe')Object.assign(f,{'观察执行ID':query.get('observationExecutionId'),
        '观察区间开始':query.get('observeFrom'),'观察覆盖截止':new Date(clock+observation.coverageOffset).toISOString(),
        '观察结论':observation.verdict,'观察数据完整':observation.complete,'观察违规事件ID':'obs-failure'})
      return json(res,{snapshotId:'snapshot-'+revision,ticketType:'PLG-04',action:query.get('action'),resourceId:'plugin',fields:f,
        preconditions:control==='verified'?[{kind:'plugin_installation',id:instance,revision}]:[]})
    }
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req);commands.push(command)
      assert.ok(['disable_plugin','restore_plugin'].includes(command.action))
      const approved=await(await fetch(api.url+'/internal/v1/approved-inputs/'+command.executionId,{headers:{authorization:'Bearer test'}})).json()
      assert.equal(approved.fields['workspace ID'],'ws')
      assert.equal(approved.fields['安装实例ID'],'installation')
      const failed=command.action==='disable_plugin' && failDisable
      failDisable=false
      if(!failed){pluginState=command.action==='disable_plugin'?'已禁用':'已启用';revision++}
      const state=mockExecution(command,{status:failed?'failed':'succeeded',result:{resultId:failed?'':'result-'+command.executionId,
        retryable:failed,...failed?{failureCode:'DIFY_API_FAILED'}:{},details:{values:{'安装实例ID':instance,'插件状态':badResult?'已启用':pluginState}}}})
      executions.set(command.executionId,state);return json(res,state)
    }
    const state=executions.get(path.split('/').at(-1))
    return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const options={dir,token:'test',executor:capability.url,now:()=>clock}
  let api=await startManagement(options)
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie='',data,internal=false)=>fetch(api.url+path,{method:data===undefined?'GET':'POST',headers:{
    cookie,'content-type':'application/json',...(internal?{authorization:'Bearer test'}:{})},body:data===undefined?undefined:JSON.stringify(data)})
  async function login(account){return (await request('/api/demo-session','',{account})).headers.get('set-cookie').split(';')[0]}
  async function row(ticketNo,cookie,view='query') {
    const r=await request('/api/applications?view='+view,cookie);assert.equal(r.status,200)
    return (await r.json()).items.find(v=>v.ticketNo===ticketNo)
  }
  async function until(fn) {
    const end=Date.now()+6000
    while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,40))}
    assert.fail('插件流程未到达预期状态')
  }
  async function wait(ticketNo,status,cookie) {return until(async()=>{const value=await row(ticketNo,cookie);return value?.status===status && value})}
  const alert=sourceEventId=>request('/internal/v1/plugin-alerts','',{sourceEventId,resourceId:'plugin',workspaceId:'ws'},true)
  async function act(ticketNo,cookie,action,fields={}) {
    const current=await row(ticketNo,cookie)
    return request('/api/applications/transition',cookie,{ticketNo,revision:current.revision,action,note:'已核对处置依据',...fields})
  }
  async function restore(ticketNo,ops) {
    assert.equal((await act(ticketNo,ops,'申请恢复',{repairInfo:'修复插件调用错误',observationMinutes:5})).status,200)
    assert.equal((await act(ticketNo,ops,'批准恢复')).status,200)
    return wait(ticketNo,'观察中',ops)
  }
  return {request,login,row,until,wait,alert,act,restore,commands,setExecution(id,value){if(value)executions.set(id,value);else executions.delete(id)},
    advance(ms){clock+=ms},setObservation(value){observation={...observation,...value}},setCycle(value){cycle=value},
    setInstance(value){instance=value},async restart(){await api.close();api=await startManagement(options)}}
}

test('PLG-04 只按可信失败率或超时率触发，同周期多规则合单且禁止人工创建',async t=>{
  const f=await fixture(t),ops=await f.login('zhou.min'),user=await f.login('chen.yu'),admin=await f.login('li.qiang')
  const input={sourceEventId:'failure-1',resourceId:'plugin',workspaceId:'ws'}
  assert.equal((await f.request('/internal/v1/plugin-alerts',user,input)).status,403)
  assert.equal((await f.alert('memory')).status,409)
  assert.equal((await f.alert('low')).status,409)
  assert.equal((await f.alert('below')).status,409)
  assert.equal((await f.alert('timeout-low')).status,409)
  assert.equal((await f.alert('incomplete')).status,409)
  assert.equal((await f.request('/api/applications',user,{ticketNo:'PLG-04-manual',ticketType:'PLG-04',resourceId:'plugin',workspaceId:'ws',fields:{}})).status,400)
  const both=await Promise.all([f.alert('failure-1'),f.alert('failure-1')])
  assert.ok(both.every(r=>r.status===201))
  const first=await both[0].json()
  let row=await f.wait(first.ticketNo,'已禁用待确认',ops)
  assert.equal(f.commands.length,1)
  assert.equal((await f.alert('timeout-1')).status,201)
  row=await f.row(row.ticketNo,ops)
  assert.equal(row.alertEvidence.length,2)
  assert.equal(row.approvedFields['阈值'],30)
  assert.equal(f.commands.length,1)
  assert.equal((await f.row(row.ticketNo,user,'mine')),undefined)
  assert.equal((await f.row(row.ticketNo,admin,'mine')),undefined)
  assert.equal((await f.act(row.ticketNo,admin,'申请恢复',{repairInfo:'不能办理',observationMinutes:5})).status,403)
})

test('PLG-04 恢复审核后进入观察，缺失覆盖或期限未到不能算已恢复，重启保留观察',async t=>{
  const f=await fixture(t),ops=await f.login('zhou.min'),admin=await f.login('li.qiang')
  const first=await(await f.alert('restore-test')).json()
  let row=await f.wait(first.ticketNo,'已禁用待确认',ops)
  const disableId=row.command.executionId
  assert.equal((await f.act(row.ticketNo,ops,'申请恢复',{repairInfo:'修复说明',observationMinutes:1})).status,400)
  assert.equal((await f.act(row.ticketNo,ops,'申请恢复',{repairInfo:'修复说明',observationMinutes:5})).status,200)
  assert.equal(f.commands.length,1)
  assert.equal((await f.act(row.ticketNo,admin,'批准恢复')).status,403)
  f.setInstance('another-instance')
  assert.equal((await f.act(row.ticketNo,ops,'批准恢复')).status,409)
  f.setInstance('installation')
  assert.equal((await f.act(row.ticketNo,ops,'批准恢复')).status,200)
  row=await f.wait(row.ticketNo,'观察中',ops)
  const until=row.observeUntil
  assert.equal(row.nodeIndex,2)
  f.setObservation({verdict:'通过',complete:true,coverageOffset:300000})
  assert.equal((await f.act(row.ticketNo,ops,'核对观察')).status,200)
  assert.equal((await f.row(row.ticketNo,ops)).status,'观察中')
  await f.restart()
  assert.equal((await f.row(row.ticketNo,ops)).observeUntil,until)
  f.advance(300001)
  f.setObservation({verdict:'数据不足',complete:false,coverageOffset:0})
  await f.act(row.ticketNo,ops,'核对观察')
  assert.equal((await f.row(row.ticketNo,ops)).status,'观察中')
  f.setObservation({verdict:'通过',complete:true,coverageOffset:-2000})
  await f.act(row.ticketNo,ops,'核对观察')
  assert.equal((await f.row(row.ticketNo,ops)).status,'观察中')
  f.setObservation({coverageOffset:0})
  await f.act(row.ticketNo,ops,'核对观察')
  row=await f.wait(row.ticketNo,'已恢复',ops)
  assert.equal(f.commands.length,2)
  const old=await(await f.request('/internal/v1/approved-inputs/'+disableId,'',undefined,true)).json()
  assert.equal(old.action,'disable_plugin');assert.equal(old.preconditions[0].revision,1)
  assert.equal(row.preconditions[0].revision,2)
})

test('PLG-04 观察失败同单新节点再次禁用，迟到重复告警不再执行',async t=>{
  const f=await fixture(t),ops=await f.login('zhou.min')
  const first=await(await f.alert('observe-failure')).json()
  let row=await f.wait(first.ticketNo,'已禁用待确认',ops)
  const firstDisable=row.command.executionId
  row=await f.restore(row.ticketNo,ops)
  f.setObservation({verdict:'失败',complete:true})
  await f.act(row.ticketNo,ops,'核对观察')
  row=await f.row(row.ticketNo,ops)
  assert.equal(row.status,'观察中')
  assert.equal(row.observationError.code,'OBSERVATION_PRECEDES_RESTORE')
  f.advance(300001);f.setCycle('cycle-2')
  await f.act(row.ticketNo,ops,'核对观察')
  row=await f.wait(row.ticketNo,'已禁用待确认',ops)
  assert.equal(row.nodeIndex,3)
  assert.notEqual(row.command.executionId,firstDisable)
  assert.equal(row.attempts.length,3)
  const duplicate=await(await f.alert('obs-failure')).json()
  assert.equal(duplicate.ticketNo,row.ticketNo)
  assert.equal(f.commands.filter(c=>c.action==='disable_plugin').length,2)
  assert.equal(f.commands.filter(c=>c.action==='restore_plugin').length,1)
  await f.restart()
  assert.equal((await f.row(row.ticketNo,ops)).nodeIndex,3)
})

test('PLG-04 缺少定向能力不发请求并升级紧急事件，API失败重试保留旧执行',async t=>{
  const unsupported=await fixture(t,{control:'unsupported'}),ops=await unsupported.login('zhou.min')
  const row=await(await unsupported.alert('unsupported')).json()
  assert.equal(row.status,'执行失败');assert.equal(unsupported.commands.length,0)
  assert.ok(row.urgentEventNo)
  const events=await(await unsupported.request('/api/events?view=query',ops)).json()
  const event=events.items.find(v=>v.ticketNo===row.urgentEventNo)
  assert.equal(event.originalSeverity,'紧急');assert.equal(event.sourceTicketNo,row.ticketNo)
  assert.equal((await unsupported.act(row.ticketNo,ops,'重试执行')).status,409)
  const failed=await fixture(t,{failDisable:true}),ops2=await failed.login('zhou.min')
  const created=await(await failed.alert('api-failure')).json()
  let failure=await failed.wait(created.ticketNo,'执行失败',ops2)
  const oldId=failure.command.executionId
  assert.ok(failure.urgentEventNo)
  assert.equal((await failed.act(failure.ticketNo,ops2,'重试执行')).status,200)
  failure=await failed.wait(failure.ticketNo,'已禁用待确认',ops2)
  assert.notEqual(failure.command.executionId,oldId)
  assert.equal(failure.attempts.length,2)
  assert.equal(failure.attempts[1].nodeIndex,1)
  assert.equal(failure.attempts[0].execution.status,'failed')
  assert.equal(failed.commands.length,2)
})

test('PLG-04 紧急事件只接受当前成功禁用节点，恢复后不能沿用历史禁用关闭事件',async t=>{
  const f=await fixture(t,{failDisable:true}),ops=await f.login('zhou.min'),reviewer=await f.login('wang.ning')
  const created=await(await f.alert('event-linkage')).json()
  let row=await f.wait(created.ticketNo,'执行失败',ops)
  const list=await(await f.request('/api/events?view=query',ops)).json()
  let event=list.items.find(v=>v.ticketNo===row.urgentEventNo)
  const begun=await f.request('/api/events/transition',ops,{ticketNo:event.ticketNo,revision:event.revision,action:'开始处置',note:'核查定向API失败',
    assessment:{severity:'紧急',conclusion:'真实故障',cause:'插件代码',impact:'目标workspace插件'}})
  assert.equal(begun.status,200);event=await begun.json()
  const submit=()=>f.request('/api/events/transition',ops,{ticketNo:event.ticketNo,revision:event.revision,action:'提交复核',note:'核对当前禁用结果',
    disposition:{actions:['禁用插件'],result:'目标实例禁用已查证',linkedTicketNos:[row.ticketNo],recovered:false}})
  assert.equal((await submit()).status,409)
  await f.act(row.ticketNo,ops,'重试执行');row=await f.wait(row.ticketNo,'已禁用待确认',ops)
  await f.restore(row.ticketNo,ops)
  assert.equal((await submit()).status,409)
  f.advance(300001);f.setObservation({verdict:'失败',complete:true})
  await f.act(row.ticketNo,ops,'核对观察');row=await f.wait(row.ticketNo,'已禁用待确认',ops)
  const submitted=await submit();assert.equal(submitted.status,200);event=await submitted.json()
  assert.equal((await f.request('/api/events/transition',ops,{ticketNo:event.ticketNo,revision:event.revision,action:'确认关闭',note:'同人不能复核'})).status,403)
  assert.equal((await f.request('/api/events/transition',reviewer,{ticketNo:event.ticketNo,revision:event.revision,action:'确认关闭',note:'独立核对成功禁用节点'})).status,200)
})

test('PLG-04 返回成功但未查证为禁用时阻止恢复，升级紧急事件且不自动新开执行',async t=>{
  const f=await fixture(t,{badResult:true}),ops=await f.login('zhou.min')
  const first=await(await f.alert('wrong-result')).json()
  const row=await f.until(async()=>{const value=await f.row(first.ticketNo,ops);return value.deliveryBlocked && value.urgentEventNo && value})
  assert.equal(row.lastError.code,'PLUGIN_STATE_NOT_VERIFIED')
  assert.equal(row.status,'自动禁用中')
  assert.equal((await f.act(row.ticketNo,ops,'申请恢复',{repairInfo:'不可误认为已禁用',observationMinutes:5})).status,409)
  assert.equal((await f.act(row.ticketNo,ops,'重试执行')).status,409)
  assert.equal(f.commands.length,1)
  const executionId=row.command.executionId
  await f.act(row.ticketNo,ops,'查证原执行')
  assert.equal((await f.row(row.ticketNo,ops)).deliveryBlocked,true)
  f.setExecution(executionId,mockExecution(row.command,{status:'succeeded',result:{resultId:'verified',details:{values:{'安装实例ID':'wrong','插件状态':'已禁用'}}}}))
  await f.act(row.ticketNo,ops,'查证原执行')
  assert.equal((await f.row(row.ticketNo,ops)).lastError.code,'PLUGIN_STATE_NOT_VERIFIED')
  f.setExecution(executionId,mockExecution(row.command,{status:'succeeded',result:{resultId:'verified',details:{values:{'安装实例ID':'installation','插件状态':'已禁用'}}}}))
  assert.equal((await f.act(row.ticketNo,ops,'查证原执行')).status,200)
  const checked=await f.row(row.ticketNo,ops)
  assert.equal(checked.status,'已禁用待确认');assert.equal(checked.deliveryBlocked,false)
  assert.equal(checked.urgentEventNo,row.urgentEventNo);assert.equal(checked.attempts.length,1)
  assert.equal(f.commands.length,1)
})
