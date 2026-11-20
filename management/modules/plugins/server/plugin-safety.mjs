import {check,id,digest,same} from '../../../../runtime/http.mjs'
import {executionState} from '../../../../runtime/execution-state.mjs'
const text=v=>typeof v==='string' && v.trim() && v.length<=4000
const date=v=>typeof v==='string' && Number.isFinite(Date.parse(v))
const system={account:'system_event',org:'系统服务'}

function trigger(f,now,resourceId) {
  const s=f['统计窗口']
  check(f['统计数据完整']===true && ['失败率','超时率'].includes(f['触发规则']) && s && date(s.start) && date(s.end) &&
    Date.parse(s.end)-Date.parse(s.start)===300000 && Date.parse(s.end)<=now+5000 && now-Date.parse(s.end)<=300000 &&
    Number.isInteger(s.calls) && s.calls>=20 && ['failures','timeouts'].every(key=>Number.isInteger(s[key]) && s[key]>=0 && s[key]<=s.calls),409,'INVALID_PLUGIN_ALERT_SAMPLE')
  const threshold=f['触发规则']==='失败率'?30:20
  const value=100*s[f['触发规则']==='失败率'?'failures':'timeouts']/s.calls
  check(value>=threshold,409,'PLUGIN_THRESHOLD_NOT_MET')
  check(Array.isArray(f['证据日志']) && f['证据日志'].length>0 && f['证据日志'].every(e=>date(e.at) &&
    ['INFO','WARN','ERROR','FATAL'].includes(e.level) && e.pluginId===resourceId && text(e.message)),409,'MISSING_PLUGIN_ALERT_EVIDENCE')
  return {rule:f['触发规则'],window:{start:s.start,end:s.end,calls:s.calls,failures:s.failures,timeouts:s.timeouts},threshold,value,
    logs:f['证据日志'].map(e=>({at:e.at,level:e.level,pluginId:e.pluginId,message:e.message}))}
}

export function pluginSafetyWorkflow({store,cap,types,headersFor,deliver,evidence,onEmergency,now=Date.now}) {
  const unsupported=(row,message)=>executionState({executionId:row.command.executionId,ticketNo:row.ticketNo,status:'failed',updatedAt:new Date(now()).toISOString(),delivery:null,
    result:{ok:false,retryable:false,failureCode:'UPSTREAM_UNSUPPORTED',failureReason:message,resultId:'',version:'',sha256:'',details:{}}},row.command)
  const observing=new Set()
  let closed=false
  async function context(action,resourceId,workspaceId,sourceEventId,observation) {
    const query=new URLSearchParams({action,resourceId,workspaceId})
    if(sourceEventId)query.set('sourceEventId',sourceEventId)
    if(observation)for(const [k,v] of Object.entries(observation))query.set(k,v)
    const raw=await(await cap('/execution-contexts/PLG-04?'+query,'GET',undefined,headersFor({command:system}))).json()
    const f=raw.fields
    check(raw.ticketType==='PLG-04' && raw.action===action && raw.resourceId===resourceId && text(raw.snapshotId) &&
      f && f['workspace ID']===workspaceId && text(f['插件名称']) && text(f['版本号']) && text(f['禁用周期ID']) &&
      ['verified','unsupported','unresolved'].includes(f['定向操作能力']) && ['已启用','已禁用','未知'].includes(f['实例状态']) &&
      Array.isArray(raw.preconditions),409,'INCOMPLETE_PLUGIN_SAFETY_CONTEXT')
    if(f['定向操作能力']==='verified')check(text(f['安装实例ID']) && raw.preconditions.some(p=>p.kind==='plugin_installation' &&
      p.id===f['安装实例ID'] && Number.isInteger(p.revision) && p.revision>=0),409,'MISSING_PLUGIN_INSTANCE')
    if(sourceEventId)check(f['告警ID']===sourceEventId,409,'PLUGIN_ALERT_MISMATCH')
    const keys=['workspace ID','插件名称','版本号','禁用周期ID','定向操作能力','实例状态','安装实例ID']
    const snapshot={snapshotId:raw.snapshotId,resourceId,preconditions:raw.preconditions,fields:Object.fromEntries(keys.map(k=>[k,f[k] ?? null]))}
    if(sourceEventId)snapshot.alert={sourceEventId,...trigger(f,now(),resourceId)}
    if(observation) {
      check(f['观察执行ID']===observation.observationExecutionId && date(f['观察区间开始']) && date(f['观察覆盖截止']) &&
        Date.parse(f['观察区间开始'])<=Date.parse(f['观察覆盖截止']) && Date.parse(f['观察覆盖截止'])<=now()+5000 &&
        ['通过','失败','数据不足'].includes(f['观察结论']) && typeof f['观察数据完整']==='boolean',409,'INVALID_PLUGIN_OBSERVATION')
      snapshot.observation={executionId:f['观察执行ID'],from:f['观察区间开始'],through:f['观察覆盖截止'],
        verdict:f['观察结论'],complete:f['观察数据完整']}
      if(f['观察结论']==='失败') {
        check(f['观察数据完整'] && text(f['观察违规事件ID']),409,'MISSING_OBSERVATION_ALERT')
        snapshot.observation.alert={sourceEventId:f['观察违规事件ID'],...trigger(f,now(),resourceId)}
      }
    }
    return snapshot
  }
  function sameInstance(row,snapshot) {
    check(snapshot.fields['workspace ID']===row.submission.workspaceId &&
      (snapshot.fields['安装实例ID']===row.snapshot.fields['安装实例ID'] || snapshot.fields['定向操作能力']!=='verified' && snapshot.fields['安装实例ID']===null) &&
      snapshot.fields['版本号']===row.snapshot.fields['版本号'],409,'PLUGIN_INSTANCE_CHANGED')
  }
  function node(row,snapshot,action,label,extra={}) {
    const executionId=id(),at=new Date(now()).toISOString()
    const command={executionId,ticketNo:row.ticketNo,ticketType:'PLG-04',ticketTypeVersion:row.ticketTypeVersion,
      action,resourceId:row.submission.resourceId,...system,payload:{decisionRef:'dec-'+executionId}}
    const approvedFields={'workspace ID':row.submission.workspaceId,'版本号':snapshot.fields['版本号'],'安装实例ID':snapshot.fields['安装实例ID'],
      '禁用周期ID':snapshot.fields['禁用周期ID'],'当前操作':label,
      ...(snapshot.alert?{'告警ID':snapshot.alert.sourceEventId,'触发规则':snapshot.alert.rule,'统计窗口':snapshot.alert.window,
        '阈值':snapshot.alert.threshold,'实测值':snapshot.alert.value,'证据日志':snapshot.alert.logs}:{}),...extra}
    return {...row,node:action,nodeIndex:(row.nodeIndex ?? 0)+1,cycleIds:[...new Set([...(row.cycleIds ?? []),snapshot.fields['禁用周期ID']])],snapshot,preconditions:snapshot.preconditions,command,approvedFields,
      execution:null,executionKnown:false,deliveryBlocked:false,lastError:null,observeFrom:null,observeUntil:null,observation:null,
      status:action==='restore_plugin'?'恢复执行中':label==='观察失败再次禁用'?'再次禁用中':'自动禁用中',revision:row.revision+1,
      attempts:[...(row.attempts ?? []),{command,approvedFields,preconditions:snapshot.preconditions,nodeIndex:(row.nodeIndex ?? 0)+1}],
      history:[...row.history,{at,actor:'system_event',action:label}]}
  }
  function urgent(row,code) {
    return {urgentNeeded:{executionId:row.command.executionId,code}}
  }
  function afterResult(row,execution) {
    if(execution.status==='cancelled')return {status:'已终止',...(row.command.action==='disable_plugin'?urgent(row,'EXECUTION_CANCELLED'):{})}
    if(execution.status==='succeeded') {
      const values=execution.result?.details?.values
      check(values?.['安装实例ID']===row.snapshot.fields['安装实例ID'] &&
        values['插件状态']===(row.command.action==='disable_plugin'?'已禁用':'已启用'),409,'PLUGIN_STATE_NOT_VERIFIED')
      if(row.command.action==='disable_plugin')return {status:'已禁用待确认',disabledAt:new Date(now()).toISOString()}
      const start=now()
      return {status:'观察中',observeFrom:new Date(start).toISOString(),observeUntil:new Date(start+row.restoreRequest.minutes*60000).toISOString(),observation:null}
    }
    if(execution.status==='failed')return {status:'执行失败',...(row.command.action==='disable_plugin'?urgent(row,execution.result?.failureCode ?? 'DISABLE_FAILED'):{})}
    return {status:row.command.action==='restore_plugin'?'恢复执行中':row.nodeIndex>1?'再次禁用中':'自动禁用中'}
  }
  function escalate(row) {
    if(!row.urgentNeeded)return row
    try {
      const eventNo=onEmergency(row,row.urgentNeeded)
      const latest=store.get(row.ticketNo)
      return store.put(row.ticketNo,{...latest,urgentNeeded:null,urgentEventNo:eventNo,revision:latest.revision+1})
    }catch{return row}
  }
  async function ingest(input) {
    check(text(input.sourceEventId) && input.sourceEventId.length<=200 && text(input.resourceId) && input.resourceId.length<=200 &&
      text(input.workspaceId) && input.workspaceId.length<=200,400,'INVALID_PLUGIN_ALERT')
    const duplicate=store.all().find(row=>row.ticketType==='PLG-04' && row.alertEvidence?.some(e=>e.sourceEventId===input.sourceEventId))
    if(duplicate) {
      check(duplicate.submission.resourceId===input.resourceId && duplicate.submission.workspaceId===input.workspaceId,409,'PLUGIN_ALERT_CONFLICT')
      return duplicate
    }
    const version=types.activeVersion('PLG-04',input.workspaceId)
    const snapshot=await context('disable_plugin',input.resourceId,input.workspaceId,input.sourceEventId)
    check(types.activeVersion('PLG-04',input.workspaceId)===version,409,'TYPE_VERSION_CHANGED')
    const concurrentDuplicate=store.all().find(row=>row.ticketType==='PLG-04' && row.alertEvidence?.some(e=>e.sourceEventId===input.sourceEventId))
    if(concurrentDuplicate){check(concurrentDuplicate.submission.resourceId===input.resourceId && concurrentDuplicate.submission.workspaceId===input.workspaceId,409,'PLUGIN_ALERT_CONFLICT');return concurrentDuplicate}
    const active=store.all().find(row=>row.ticketType==='PLG-04' && row.submission.resourceId===input.resourceId && row.submission.workspaceId===input.workspaceId &&
      (row.cycleIds?.includes(snapshot.fields['禁用周期ID']) || row.status==='观察中' && row.snapshot.fields['安装实例ID']===snapshot.fields['安装实例ID']))
    const ticketNo=active?.ticketNo ?? 'PLG-04-'+digest(input.workspaceId+'\0'+input.resourceId+'\0'+snapshot.fields['禁用周期ID']).slice(0,40)
    const previous=store.get(ticketNo)
    if(previous) {
      sameInstance(previous,snapshot)
      const alertEvidence=[...previous.alertEvidence.filter(e=>e.sourceEventId!==input.sourceEventId),snapshot.alert]
      const merged=store.put(ticketNo,{...previous,alertEvidence,revision:previous.revision+1,
        history:[...previous.history,{at:new Date(now()).toISOString(),actor:'system_event',action:'合并告警 '+input.sourceEventId}]})
      if(merged.status==='观察中' && Date.parse(snapshot.alert.window.start)>=Date.parse(merged.observeFrom))return redisable(merged,snapshot)
      return merged
    }
    const at=new Date(now()).toISOString()
    const initial={ticketNo,ticketType:'PLG-04',ticketTypeVersion:version,...system,creationMode:'系统告警',
      submission:{resourceId:input.resourceId,workspaceId:input.workspaceId,fields:{}},alertEvidence:[snapshot.alert],revision:0,history:[],attempts:[]}
    let row=node(initial,snapshot,'disable_plugin','自动禁用')
    if(snapshot.fields['定向操作能力']!=='verified') {
      const execution=unsupported(row,'无法定向禁用该插件实例')
      row={...row,execution,status:'执行失败',...urgent(row,'UPSTREAM_UNSUPPORTED'),attempts:row.attempts.map(a=>({...a,execution})),
        history:[...row.history,{at,actor:'system_event',action:'自动执行失败；禁止扩大为daemon操作'}]}
    }
    store.put(ticketNo,row)
    if(row.urgentNeeded)row=escalate(row)
    else void deliver(row)
    return row
  }
  async function redisable(row,snapshot) {
    sameInstance(row,snapshot)
    const latest=store.get(row.ticketNo)
    if(latest.revision!==row.revision || latest.status!=='观察中')return latest
    const next=node(row,snapshot,'disable_plugin','观察失败再次禁用')
    next.alertEvidence=[...row.alertEvidence.filter(e=>e.sourceEventId!==snapshot.alert.sourceEventId),snapshot.alert]
    if(snapshot.fields['定向操作能力']!=='verified') {
      const execution=unsupported(next,'无法再次定向禁用该插件')
      const failed={...next,status:'执行失败',execution,...urgent(next,'UPSTREAM_UNSUPPORTED'),attempts:next.attempts.map(a=>a.command.executionId===next.command.executionId?{...a,execution}:a)}
      store.put(row.ticketNo,failed);return escalate(failed)
    }
    store.put(row.ticketNo,next);void deliver(next);return next
  }
  async function observe(row) {
    if(closed || observing.has(row.ticketNo) || row.status!=='观察中')return row
    observing.add(row.ticketNo)
    try {
      const snapshot=await context('restore_plugin',row.submission.resourceId,row.submission.workspaceId,null,{
        phase:'observe',observationExecutionId:row.command.executionId,observeFrom:row.observeFrom,observeUntil:row.observeUntil})
      if(closed)return row
      sameInstance(row,snapshot)
      const o=snapshot.observation
      if(o.verdict==='失败') {
        check(Date.parse(o.alert.window.start)>=Date.parse(row.observeFrom),409,'OBSERVATION_PRECEDES_RESTORE')
        const disable=await context('disable_plugin',row.submission.resourceId,row.submission.workspaceId,o.alert.sourceEventId)
        if(closed)return row
        check(same(disable.alert,o.alert),409,'OBSERVATION_EVIDENCE_CHANGED')
        return await redisable(row,disable)
      }
      const latest=store.get(row.ticketNo)
      if(latest.revision!==row.revision || latest.status!=='观察中')return latest
      const passed=now()>=Date.parse(row.observeUntil) && o.verdict==='通过' && o.complete &&
        snapshot.fields['定向操作能力']==='verified' && snapshot.fields['实例状态']==='已启用' &&
        Date.parse(o.from)<=Date.parse(row.observeFrom) && Date.parse(o.through)>=Date.parse(row.observeUntil)
      return store.put(row.ticketNo,{...latest,observation:o,observationError:null,status:passed?'已恢复':'观察中',revision:latest.revision+1,
        history:passed?[...latest.history,{at:new Date(now()).toISOString(),actor:'system_event',action:'完整观察通过，已恢复'}]:latest.history})
    }catch(error){if(closed)return row;const latest=store.get(row.ticketNo);return store.put(row.ticketNo,{...latest,observationError:{code:error.code ?? 'NETWORK_ERROR'}})}
    finally{observing.delete(row.ticketNo)}
  }
  async function transition(row,input,identity) {
    const actor=identity.account
    check(identity.roles.includes('operator'),403,'ACCESS_DENIED')
    if(input.action==='核对观察') {check(row.status==='观察中',409,'INVALID_TRANSITION');return observe(row)}
    if(input.action==='申请恢复') {
      check(row.status==='已禁用待确认',409,'INVALID_TRANSITION')
      check(text(input.repairInfo) && Number.isInteger(input.observationMinutes) && input.observationMinutes>=5 && input.observationMinutes<=1440,400,'INVALID_RESTORE_REQUEST')
      const refs=evidence.references(input.evidenceIds ?? [],actor)
      return store.put(row.ticketNo,{...row,status:'待恢复审核',revision:row.revision+1,evidenceRefs:refs,restoreRequest:{reason:input.note,repairInfo:input.repairInfo,
        minutes:input.observationMinutes,evidenceRefs:refs,requestedBy:actor,requestedAt:new Date(now()).toISOString()},
        history:[...row.history,{at:new Date(now()).toISOString(),actor,action:'申请恢复',note:input.note}]})
    }
    if(input.action==='驳回恢复') {
      check(row.status==='待恢复审核',409,'INVALID_TRANSITION')
      return store.put(row.ticketNo,{...row,status:'已禁用待确认',revision:row.revision+1,
        history:[...row.history,{at:new Date(now()).toISOString(),actor,action:'驳回恢复',note:input.note}]})
    }
    check(input.action==='批准恢复' && row.status==='待恢复审核',409,'INVALID_TRANSITION')
    const snapshot=await context('restore_plugin',row.submission.resourceId,row.submission.workspaceId)
    sameInstance(row,snapshot)
    check(snapshot.fields['定向操作能力']==='verified' && snapshot.fields['实例状态']==='已禁用' &&
      snapshot.fields['禁用周期ID']===row.snapshot.fields['禁用周期ID'],409,'PLUGIN_RESTORE_NOT_READY')
    check(store.get(row.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
    const next=node(row,snapshot,'restore_plugin','申请恢复',{'恢复申请原因':row.restoreRequest.reason,'修复说明':row.restoreRequest.repairInfo,
      '恢复观察时长':row.restoreRequest.minutes,'修复附件':row.restoreRequest.evidenceRefs})
    next.history.push({at:new Date(now()).toISOString(),actor,action:'批准恢复',note:input.note})
    store.put(row.ticketNo,next);void deliver(next);return next
  }
  return {ingest,transition,observe,afterResult,escalate,urgent,close(){closed=true}}
}
