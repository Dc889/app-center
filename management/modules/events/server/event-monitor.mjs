import {check} from '../../../../runtime/http.mjs'
export const eventObjects=['知识库','智能体','插件','MCP','智能体仓库','账号与集成']
export const eventLevels=['提示','一般','严重','紧急']
export const eventStates=['未研判','处理中','待复核','观察中','已重开','已关闭']
const time=value=>typeof value==='string' && value.endsWith('Z') && Number.isFinite(Date.parse(value))?Date.parse(value):null
const str=(value,max=200)=>typeof value==='string' && value.length<=max?value:null
const states={'人工报告':'未研判','定向禁用失败升级紧急告警':'未研判','开始处置':'处理中','提交误报复核':'待复核','提交复核':'待复核','确认关闭':'已关闭','重新处置':'已重开','继续观察':'观察中','观察到期':'待复核'}
export function eventTimeline(row) {
  let previous=null
  return (row.history ?? []).map((h,index)=>{
    const to=eventStates.includes(h.toStatus)?h.toStatus:states[h.action] ?? null
    const from=h.fromStatus===null?null:eventStates.includes(h.fromStatus)?h.fromStatus:previous
    previous=to
    return {id:row.ticketNo+'/'+index,at:time(h.at)===null?null:h.at,actor:str(h.actor),action:str(h.action),fromStatus:from,toStatus:to,note:str(h.note,4000)}
  })
}
export function eventFacts(row,now=Date.now(),admin=false) {
  const history=eventTimeline(row),first=time(row.firstOccurredAt) ?? time(history.find(h=>h.fromStatus===null && h.toStatus==='未研判')?.at)
  const closed=history.filter(h=>h.toStatus==='已关闭').at(-1),end=row.status==='已关闭'?time(closed?.at):now
  const duration=first!==null && end!==null && end>=first && end<=now?((end-first)/60000):null
  return {ticketNo:row.ticketNo,eventId:str(row.alertId) ?? row.ticketNo,creationMode:str(row.creationMode),objectType:str(row.objectType),resourceId:str(row.resourceId),
    name:str(row.resourceName) ?? str(row.resourceId),ruleCode:str(row.ruleCode),originalSeverity:eventLevels.includes(row.originalSeverity)?row.originalSeverity:null,
    assessedSeverity:eventLevels.includes(row.assessment?.severity)?row.assessment.severity:null,
    severity:eventLevels.includes(row.assessment?.severity)?row.assessment.severity:eventLevels.includes(row.originalSeverity)?row.originalSeverity:'未采集',
    conclusion:str(row.assessment?.conclusion),status:str(row.status),handler:str(row.handler),firstOccurredAt:first===null?null:new Date(first).toISOString(),
    lastOccurredAt:time(row.lastOccurredAt)===null?null:row.lastOccurredAt,closedAt:time(closed?.at)===null?null:closed.at,
    durationMinutes:duration,durationKind:row.status==='已关闭'?'closed':'elapsed',revision:row.revision,
    relatedTicketNos:[...new Set([row.sourceTicketNo,...row.relatedTicketNos ?? [],...row.disposition?.linkedTicketNos ?? []].filter(n=>typeof n==='string' && (admin || !n.startsWith('ACC-')) && n.length<=200))],history}
}
export function eventMonitor(rows,query,now=Date.now(),admin=false) {
  const range=query.get('range') ?? '24h',duration={'1h':3600000,'24h':86400000,'7d':604800000}[range]
  check(duration,400,'INVALID_RANGE')
  const q=query.get('q') ?? '',status=query.get('status'),objectType=query.get('objectType'),severity=query.get('severity')
  check(q.length<=200 && (!status || eventStates.includes(status)) && (!objectType || eventObjects.includes(objectType)) && (!severity || [...eventLevels,'未采集'].includes(severity)),400,'INVALID_FILTER')
  const page=Number(query.get('page') ?? 1),limit=Number(query.get('limit') ?? 50)
  check(Number.isSafeInteger(page) && page>=1 && Number.isSafeInteger(limit) && limit>=1 && limit<=100 && Number.isSafeInteger((page-1)*limit),400,'INVALID_PAGE')
  const facts=rows.map(row=>eventFacts(row,now,admin)).filter(row=>(!q || [row.eventId,row.ticketNo,row.resourceId,row.name].some(s=>s?.toLowerCase().includes(q.toLowerCase()))) && (!status || row.status===status) && (!objectType || row.objectType===objectType) && (!severity || row.severity===severity))
  const from=now-duration,to=now+1,bucketMs=range==='7d'?3600000:300000,start=Math.floor(from/bucketMs)*bucketMs
  const trend=Array.from({length:Math.ceil((to-start)/bucketMs)},(_,i)=>({at:new Date(start+i*bucketMs).toISOString(),added:0,closed:0,reopened:0}))
  const add=(at,key)=>{const ms=time(at);if(ms!==null && ms>=from && ms<to)trend[Math.floor((ms-start)/bucketMs)][key]++}
  for(const row of facts){add(row.firstOccurredAt,'added');for(const h of row.history){if(h.toStatus==='已关闭')add(h.at,'closed');if(h.toStatus==='已重开')add(h.at,'reopened')}}
  // The deployment's business day is Asia/Shanghai (UTC+08:00).
  const today=Math.floor((now+28800000)/86400000)*86400000-28800000
  const cards={unassessed:facts.filter(r=>r.status==='未研判').length,handling:facts.filter(r=>r.status==='处理中').length,review:facts.filter(r=>r.status==='待复核').length,
    urgent:facts.filter(r=>r.severity==='紧急' && r.status!=='已关闭').length,closedToday:facts.filter(r=>r.status==='已关闭' && time(r.closedAt)>=today && time(r.closedAt)<=now && r.closedAt!==null).length}
  const distribution=[...eventLevels,'未采集'].map(level=>({severity:level,...Object.fromEntries(eventObjects.map(kind=>[kind,facts.filter(r=>r.severity===level && r.objectType===kind).length]))}))
  const durations=eventObjects.map(objectType=>{
    const closed=facts.filter(r=>r.objectType===objectType && r.status==='已关闭'),values=closed.map(r=>r.durationMinutes).filter(v=>v!==null).sort((a,b)=>a-b)
    return {objectType,count:values.length,excluded:closed.length-values.length,meanMinutes:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,p95Minutes:values.length?values[Math.ceil(values.length*.95)-1]:null}
  })
  facts.sort((a,b)=>(time(b.firstOccurredAt) ?? -Infinity)-(time(a.firstOccurredAt) ?? -Infinity)||a.ticketNo.localeCompare(b.ticketNo))
  return {source:'management_reported_events',capturedAt:new Date(now).toISOString(),timezone:'Asia/Shanghai',window:{range,from:new Date(from).toISOString(),to:new Date(to).toISOString(),bucketMs,partialBoundaryBuckets:true},
    cards,trend,distribution,durations,unknownTrendTimes:facts.filter(r=>!r.firstOccurredAt).length,total:facts.length,page,limit,items:facts.slice((page-1)*limit,page*limit).map(({history:_history,...row})=>row)}
}
const redact=s=>s.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi,'Bearer [REDACTED]').replace(/\b(password|secret|api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi,'$1=[REDACTED]')
export function eventEvidence(row,related=[],now=Date.now(),admin=false) {
  const facts=eventFacts(row,now,admin),e=row.evidence,raw=e?.metrics
  const valid=raw?.resourceId===row.resourceId && raw?.alertId===row.alertId && str(raw.unit) && Array.isArray(raw.points) && raw.points.length>0 && raw.points.length<=2000 && raw.points.every((p,i)=>time(p.at)!==null && time(p.at)<=now && Number.isFinite(p.value) && Number.isFinite(p.threshold) && (!i || time(p.at)>time(raw.points[i-1].at)))
  const metrics=valid?{unit:raw.unit,points:raw.points.map(({at,value,threshold})=>({at,value,threshold}))}:null
  const logs=Array.isArray(e?.logs)?e.logs.filter(l=>l.redacted===true && l.resourceId===row.resourceId && time(l.at)!==null && time(l.at)<=now && str(l.source) && ['INFO','WARN','ERROR','FATAL'].includes(l.level) && str(l.message,4000)).slice(0,200).map(({at,source,level,message})=>({at,source,level,message:redact(message)})):[]
  const actions=[]
  for(const linked of related.filter(r=>facts.relatedTicketNos.includes(r.ticketNo))){
    for(const a of [{command:linked.command,execution:linked.execution ?? linked.state},...[...linked.attempts ?? []].reverse()]){
      if(!a.command || !a.execution || a.command.resourceId!==row.resourceId || (!admin && a.command.ticketType?.startsWith('ACC-')) || actions.some(r=>r.executionId===a.command.executionId))continue
      actions.push({executionId:a.command.executionId,ticketNo:linked.ticketNo,at:time(a.execution.updatedAt)===null?null:a.execution.updatedAt,adapter:null,
        resourceId:a.command.resourceId,action:str(a.command.action),result:str(a.execution.status),errorCode:str(a.execution.result?.failureCode)})
    }
  }
  return {source:'management_reported_events',capturedAt:new Date(now).toISOString(),basic:facts,facts:str(row.facts,4000),metrics,metricState:metrics?'collected':'not_collected',logs,
    logsState:logs.length?'collected':'not_collected',actions,actionSource:'linked_execution_snapshots',timeline:facts.history}
}
