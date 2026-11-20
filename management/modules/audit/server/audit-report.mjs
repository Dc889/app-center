import {check,same} from '../../../../runtime/http.mjs'
import {isIP} from 'node:net'
import {isUtcTimestamp} from '../../../../runtime/execution-state.mjs'

const text=(v,max=200)=>typeof v==='string' && v.length>0 && v.length<=max?v:null
const noteText=(v,max=4000)=>typeof v==='string' && v.length<=max?v:null
const utc=v=>isUtcTimestamp(v)?Date.parse(v):null
const shanghaiDayStart=now=>Math.floor((now+28800000)/86400000)*86400000-28800000

export const auditSources=['申请草稿','事件办理','类型版本','执行工单','能力执行','Skill交付','广场Web','外部API']
const localSources=auditSources.slice(0,4)
const nativeSources=['execution','skill_delivery','dify_run','external_api']
const displaySources={execution:'能力执行',skill_delivery:'Skill交付',dify_run:'广场Web',external_api:'外部API'}
const categories=['创建','提交','审批','执行','补偿','下载','访问','其他']

// Management workflow history stays separate from capability execution/delivery/access observations.
const localCategory=action=>/^(创建|新建|人工报告|定向禁用失败升级|告警创建|系统起草|复制类型|保存类型草稿)/.test(action)?'创建'
  :/^(提交|保存申请草稿|草稿开始提交|草稿归档|草稿提交|恢复未受理草稿|同步本人|申请恢复)/.test(action)?'提交'
  :/^(批准|驳回|退回|确认结果|确认审查|确认关闭|审核|发布类型|停用类型|开始处置|重新处置|合并告警)/.test(action)?'审批'
  :/补偿|解锁|核验恢复|查证|重试执行|申请取消执行|终止工单|关闭交付检查|完整观察通过/.test(action)?'补偿'
  :'其他'

export function localAudit({drafts=[],events=[],types=[],tickets=[],applications=[],accounts=[]},identity) {
  const admin=identity.roles.includes('admin'),rows=new Map()
  function add(row,source,reference,idPrefix,ticketType,resourceId) {
    if(!admin && (typeof ticketType!=='string' || ticketType.startsWith('ACC-')))return
    for(const [i,h] of (row.history ?? []).entries()) {
      if(!admin && (!h.org || h.org!==identity.org))continue
      const id=idPrefix+'/'+i,key=source+'/'+id
      if(rows.has(key))continue
      rows.set(key,{
        id,at:text(h.at),actor:text(h.actor),action:text(h.action),reference,source,org:text(h.org),note:noteText(h.note),
        actorSubjectId:text(h.actorSubjectId),
        actorRole:['user','operator','admin','system'].includes(h.actorRole)?h.actorRole:null,
        actorRevision:Number.isSafeInteger(h.actorRevision)?h.actorRevision:null,
        actorSource:text(h.actorSource) ?? 'not_collected',
        sourceIp:isIP(h.sourceIp ?? '')?h.sourceIp:null,
        ticketNo:source==='类型版本'||source==='申请草稿'?null:reference,
        objectType:text(ticketType),resourceId:text(resourceId),
        beforeSummary:noteText(h.beforeSummary,1000),afterSummary:noteText(h.afterSummary,1000),
        result:text(h.result),errorCode:text(h.errorCode) ?? text(h.code),
        category:localCategory(h.action ?? ''),
      })
    }
  }
  for(const r of drafts)add(r,'申请草稿',r.draftId,'draft/'+r.draftId,r.ticketType,r.draftId)
  for(const r of events)add(r,'事件办理',r.ticketNo,r.ticketNo,'EVT-01',r.resourceId)
  for(const r of types)add(r,'类型版本',r.code+' v'+r.version,r.code+'/'+r.version,r.code,r.code)
  for(const r of [...tickets,...applications,...(admin?accounts:[])])add(r,'执行工单',r.ticketNo,r.ticketNo,r.command?.ticketType ?? r.ticketType,r.command?.resourceId ?? r.submission?.resourceId ?? r.subjectId)
  return [...rows.values()].sort((a,b)=>(b.at ?? '').localeCompare(a.at ?? '')||a.id.localeCompare(b.id))
}

function auditQuery(query,now) {
  const range=query.get('range') ?? '24h',durations={today:now-shanghaiDayStart(now),'1h':3600000,'24h':86400000,'7d':604800000}
  check(Object.hasOwn(durations,range),400,'INVALID_AUDIT_QUERY')
  const defaultFrom=range==='today'?new Date(shanghaiDayStart(now)).toISOString():new Date(now-durations[range]).toISOString()
  const from=query.get('from') || defaultFrom,to=query.get('to') || new Date(now+1).toISOString()
  const q=query.get('q') ?? '',source=query.get('source') ?? ''
  check(utc(from)!==null && utc(to)!==null && utc(from)<utc(to) && utc(to)-utc(from)<=31*86400000 && utc(to)<=now+5000 && q.length<=200 && (!source || auditSources.includes(source)),400,'INVALID_AUDIT_QUERY')
  const page=Number(query.get('page') ?? 1),accessPage=Number(query.get('accessPage') ?? 1),limit=Number(query.get('limit') ?? 50)
  check([page,accessPage,limit].every(v=>Number.isSafeInteger(v)&&v>=1) && limit<=100 && [page,accessPage].every(p=>Number.isSafeInteger((p-1)*limit)),400,'INVALID_PAGE')
  return {range,from,to,q,source,page,accessPage,limit}
}

async function readSource(cap,source,filter,headers,now) {
  let fetched=false
  try {
    let cursor=null,availability=null,asOf=null
    const seen=new Set(),items=new Map()
    for(let page=0;page<100;page++) {
      const query=new URLSearchParams({view:'audit',source,from:filter.from,to:filter.to,limit:'100'})
      if(cursor)query.set('cursor',cursor)
      const response=await cap('/observations?'+query,'GET',undefined,headers)
      fetched=true
      const raw=await response.json()
      check(['collected','not_collected','stale'].includes(raw?.availability) && Array.isArray(raw.items) && raw.items.length<=100 && (raw.nextCursor===null || typeof raw.nextCursor==='string' && raw.nextCursor.length>0 && raw.nextCursor.length<=2000),409,'INVALID_OBSERVATIONS')
      if(raw.availability==='not_collected'){
        check(!raw.items.length && raw.nextCursor===null,409,'INVALID_OBSERVATIONS')
        return {availability:'not_collected',asOf:null,reasonCode:'SOURCE_NOT_COLLECTED',items:[]}
      }
      check(utc(raw.asOf)!==null && utc(raw.asOf)<=now+5000 && (!availability || availability===raw.availability && asOf===raw.asOf),409,'INVALID_OBSERVATIONS')
      availability=raw.availability;asOf=raw.asOf
      for(const r of raw.items) {
        check(r?.source===source && text(r.eventId) && utc(r.occurredAt)!==null && utc(r.occurredAt)>=utc(filter.from) && utc(r.occurredAt)<utc(filter.to) && ['success','failure','pending','unknown'].includes(r.outcome) && r.data && typeof r.data==='object' && !Array.isArray(r.data),409,'INVALID_OBSERVATIONS')
        check(!items.has(r.eventId) || same(items.get(r.eventId),r),409,'CONFLICTING_EVENT')
        items.set(r.eventId,r)
      }
      if(raw.nextCursor===null) {
        const stale=availability==='stale' || now-utc(asOf)>300000
        return {availability:stale?'stale':'collected',asOf,reasonCode:stale?'SOURCE_STALE':null,items:[...items.values()]}
      }
      check(!seen.has(raw.nextCursor),409,'INVALID_CURSOR');seen.add(raw.nextCursor);cursor=raw.nextCursor
    }
    return {availability:'not_collected',asOf:null,reasonCode:'INCOMPLETE_OBSERVATIONS',items:[]}
  }catch{
    return {availability:'not_collected',asOf:null,reasonCode:fetched?'INVALID_SOURCE_DATA':'SOURCE_UNAVAILABLE',items:[]}
  }
}

const isNewer=(nextAt,nextId,prev)=>!prev || nextAt>prev.at || nextAt===prev.at && nextId>prev.id

function observedRows(groups,identity,commands) {
  const admin=identity.roles.includes('admin'),settled=new Map(),externalRuns=new Map(),webRuns=new Map(),accessDirect=[]
  for(const source of ['execution','skill_delivery'])for(const raw of groups[source].items) {
    const d=raw.data,command=commands.find(c=>c?.executionId===d.executionId && c.ticketNo===d.ticketNo)
    const ticketNo=text(d.ticketNo)
    const ticketType=text(d.ticketType) ?? command?.ticketType ?? (/^([A-Z]+-\d{2})(?:-|$)/.exec(ticketNo ?? '')?.[1] ?? null)
    const org=text(d.auditOrg) ?? text(d.org) ?? command?.org ?? null
    if(!admin && (!org || org!==identity.org || !ticketType || ticketType.startsWith('ACC-')))continue
    if(!['success','failure'].includes(raw.outcome) || !text(d.executionId))continue
    const key=source+'/'+d.executionId
    if(!isNewer(raw.occurredAt,raw.eventId,settled.get(key)))continue
    settled.set(key,{
      id:raw.eventId,at:raw.occurredAt,actor:text(d.account) ?? command?.account ?? null,
      action:text(d.action) ?? (source==='skill_delivery'?'下载结算':null),reference:ticketNo,source:displaySources[source],org,
      actorSubjectId:null,actorRole:null,actorRevision:null,actorSource:'not_collected',
      sourceIp:isIP(d.downloadIp ?? '')?d.downloadIp:isIP(d.sourceIp ?? '')?d.sourceIp:null,
      ticketNo,objectType:ticketType,resourceId:text(raw.resourceId),
      beforeSummary:null,afterSummary:null,result:raw.outcome,errorCode:text(d.failureCode) ?? text(d.errorCode),
      category:source==='skill_delivery'?'下载':'执行',executionId:d.executionId,note:null,
    })
  }
  const externalRunIds=new Set()
  for(const raw of groups.external_api.items) {
    const d=raw.data,auditOrg=text(d.auditOrg) ?? text(d.callerOrg) ?? null
    const ticketType=text(d.ticketType)
    if(!admin && (!auditOrg || auditOrg!==identity.org || ticketType?.startsWith('ACC-')))continue
    if(raw.outcome==='pending')continue
    const runId=text(d.runId)
    const row={
      id:raw.eventId,at:raw.occurredAt,source:displaySources.external_api,mode:'外部API',
      account:null,org:null,
      keyRegistrationId:text(d.keyRegistrationId) ?? text(d.registrationId),
      callerName:text(d.callerName),callerOrg:text(d.callerOrg),
      sourceIp:isIP(d.sourceIp ?? '')?d.sourceIp:null,
      path:typeof d.path==='string'?d.path.split('?')[0].slice(0,500):null,
      appId:text(d.appId) ?? text(raw.resourceId),runId,
      latencyMs:Number.isFinite(d.latencyMs)&&d.latencyMs>=0?d.latencyMs:null,
      httpStatus:Number.isInteger(d.httpStatus)&&d.httpStatus>=100&&d.httpStatus<=599?d.httpStatus:null,
      result:raw.outcome,errorCode:text(d.errorCode),
    }
    if(runId) {
      externalRunIds.add(runId)
      if(isNewer(row.at,row.id,externalRuns.get(runId)))externalRuns.set(runId,row)
    }else accessDirect.push(row)
  }
  for(const raw of groups.dify_run.items) {
    const d=raw.data,auditOrg=text(d.auditOrg) ?? text(d.org) ?? null
    const ticketType=text(d.ticketType)
    if(!admin && (!auditOrg || auditOrg!==identity.org || ticketType?.startsWith('ACC-')))continue
    if(d.callerKind!=='web' || raw.outcome==='pending')continue
    const runId=text(d.runId)
    if(runId && externalRunIds.has(runId))continue
    const row={
      id:raw.eventId,at:raw.occurredAt,source:displaySources.dify_run,mode:'广场Web',
      account:text(d.account),org:text(d.org),
      keyRegistrationId:null,callerName:null,callerOrg:null,
      sourceIp:isIP(d.sourceIp ?? '')?d.sourceIp:null,
      path:typeof d.path==='string'?d.path.split('?')[0].slice(0,500):null,
      appId:text(d.appId) ?? text(raw.resourceId),runId,
      latencyMs:Number.isFinite(d.latencyMs)&&d.latencyMs>=0?d.latencyMs:null,
      httpStatus:Number.isInteger(d.httpStatus)&&d.httpStatus>=100&&d.httpStatus<=599?d.httpStatus:null,
      result:raw.outcome,errorCode:text(d.errorCode),
    }
    if(runId) {
      if(isNewer(row.at,row.id,webRuns.get(runId)))webRuns.set(runId,row)
    }else accessDirect.push(row)
  }
  return {management:[...settled.values()],access:[...externalRuns.values(),...webRuns.values(),...accessDirect]}
}

function summarizeAvailability(sources,nativeKeys) {
  if(nativeKeys.some(s=>sources[s].availability==='not_collected'))return {availability:'not_collected',asOf:null}
  const stale=nativeKeys.some(s=>sources[s].availability==='stale')
  const asOf=nativeKeys.map(s=>sources[s].asOf).filter(Boolean).sort()[0] ?? null
  return {availability:stale?'stale':'collected',asOf}
}

export async function auditReport({query,now,cap,headers,identity,records}) {
  const filter=auditQuery(query,now)
  const sources=Object.fromEntries(await Promise.all(nativeSources.map(async source=>[source,await readSource(cap,source,filter,headers,now)])))
  const data=records(),local=localAudit(data,identity)
  const commands=[...data.tickets,...data.applications,...(identity.roles.includes('admin')?data.accounts:[])].flatMap(r=>[r.command,...(r.attempts ?? []).map(a=>a.command)]).filter(Boolean)
  const observed=observedRows(sources,identity,commands)
  const needle=filter.q.trim().toLowerCase()
  const searchable=row=>'mode' in row
    ?[row.id,row.source,row.mode,row.account,row.org,row.keyRegistrationId,row.callerName,row.callerOrg,row.sourceIp,row.path,row.appId,row.runId,row.result,row.errorCode]
    :[row.id,row.reference,row.ticketNo,row.actor,row.actorSubjectId,row.actorRole,row.org,row.source,row.objectType,row.objectType?.startsWith('ACC-')?null:row.resourceId,row.action,row.note,row.sourceIp,row.result,row.errorCode]
  const matchesFilter=(row,fromMs,toMs)=>(!filter.source || row.source===filter.source) && utc(row.at)!==null && utc(row.at)>=fromMs && utc(row.at)<toMs &&
    (!needle || searchable(row).some(v=>typeof v==='string' && v.toLowerCase().includes(needle)))
  const fromMs=utc(filter.from),toMs=utc(filter.to)
  const matches=row=>matchesFilter(row,fromMs,toMs)
  const management=[...local,...observed.management].filter(matches).sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id))
  const access=observed.access.filter(matches).sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id))
  const todayStart=shanghaiDayStart(now)
  const todayWorkflowCount=local.filter(r=>matchesFilter(r,todayStart,now+1)).length
  const metrics={
    workflow:{availability:'collected',count:management.filter(r=>localSources.includes(r.source)).length,todayCount:todayWorkflowCount,asOf:new Date(now).toISOString()},
    catalog:{availability:'not_collected',count:null,asOf:null},
  }
  for(const [key,native,rows] of [['api',['execution'],management],['download',['skill_delivery'],management],['access',['dify_run','external_api'],access]]) {
    const selected=native.filter(s=>!filter.source || filter.source===displaySources[s])
    const state=summarizeAvailability(sources,selected.length?selected:native)
    metrics[key]={...state,count:state.availability==='not_collected'?null:rows.filter(r=>selected.some(s=>displaySources[s]===r.source)).length}
  }
  const bucketMs=filter.range==='7d'||toMs-fromMs>86400000?3600000:300000
  const start=Math.floor(fromMs/bucketMs)*bucketMs
  const bucketCount=Math.max(1,Math.ceil((toMs-start)/bucketMs))
  const partialBoundaryBuckets=fromMs!==start || toMs!==start+bucketCount*bucketMs
  const trend=Array.from({length:bucketCount},(_,i)=>({
    at:new Date(start+i*bucketMs).toISOString(),
    workflow:0,
    api:metrics.api.availability==='not_collected'?null:0,
    catalog:null,
    download:metrics.download.availability==='not_collected'?null:0,
    access:metrics.access.availability==='not_collected'?null:0,
  }))
  for(const row of management) {
    const key=localSources.includes(row.source)?'workflow':row.source==='能力执行'?'api':'download'
    const point=trend[Math.floor((utc(row.at)-start)/bucketMs)]
    if(point && point[key]!==null)point[key]++
  }
  if(metrics.access.availability!=='not_collected')for(const row of access) {
    const point=trend[Math.floor((utc(row.at)-start)/bucketMs)]
    if(point && point.access!==null)point.access++
  }
  const actorCounts=new Map()
  for(const row of management)if(localSources.includes(row.source) && ['user','operator','admin'].includes(row.actorRole) && row.actor) {
    actorCounts.set(row.actor,(actorCounts.get(row.actor) ?? 0)+1)
  }
  const localFiltered=management.filter(r=>localSources.includes(r.source))
  const distribution=categories.map(cat=>{
    if(cat==='执行')return {category:cat,availability:metrics.api.availability,count:metrics.api.count}
    if(cat==='下载')return {category:cat,availability:metrics.download.availability,count:metrics.download.count}
    if(cat==='访问')return {category:cat,availability:metrics.access.availability,count:metrics.access.count}
    return {category:cat,availability:'collected',count:localFiltered.filter(r=>r.category===cat).length}
  })
  return {
    filter,source:'management_and_capability_audit',capturedAt:new Date(now).toISOString(),timezone:'Asia/Shanghai',
    scope:identity.roles.includes('admin')?'partition_all':'org_non_account',
    org:identity.org ?? null,
    partialBoundaryBuckets,
    metrics,trend,bucketMs,distribution,
    sources:Object.fromEntries(Object.entries(sources).map(([k,{availability,asOf,reasonCode}])=>[k,{availability,asOf,reasonCode}])),
    ranking:[...actorCounts].map(([actor,count])=>({actor,count})).sort((a,b)=>b.count-a.count||a.actor.localeCompare(b.actor)).slice(0,20),
    managementTotal:management.length,accessTotal:access.length,
    managementItems:management.slice((filter.page-1)*filter.limit,filter.page*filter.limit),
    accessItems:access.slice((filter.accessPage-1)*filter.limit,filter.accessPage*filter.limit),
    exportManagement:management,exportAccess:access,
  }
}
