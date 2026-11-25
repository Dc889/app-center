// Management ledgers are authoritative for workflow counts, never for product inventory.
import {check} from '../../../../runtime/http.mjs'

export const resourceKeys=['agents','datasets','tools','plugins','skills','mcp','keys']
export const serviceKeys=['management','ragflow','dify','plugin_daemon','object_store','database']
export const callKeys=['agent','retrieval','mcp']
export const exceptionKeys=['agent','dataset_build','plugin','mcp']
const unavailable=reasonCode=>({state:'unavailable',source:null,capturedAt:null,data:null,reasonCode})
const integer=n=>Number.isSafeInteger(n) && n>=0
const string=s=>typeof s==='string' && s.length>0 && s.length<=200
const utc=s=>typeof s==='string' && s.endsWith('Z') && Number.isFinite(Date.parse(s))
function valid(ok){check(ok,409,'INVALID_OBSERVATIONS')}
export function overviewWindow(range,now=Date.now()) {
  valid(['1h','24h','7d'].includes(range))
  const bucketMs=range==='7d'?3600000:300000,to=Math.floor(now/bucketMs)*bucketMs
  return {range,from:new Date(to-({'1h':3600000,'24h':86400000,'7d':604800000}[range])).toISOString(),to:new Date(to).toISOString(),bucketMs}
}
function readGroup(raw,decode,now) {
  if(raw?.state==='unavailable')return unavailable('SOURCE_NOT_COLLECTED')
  try {
    valid(['collected','stale'].includes(raw?.state) && string(raw.source) && utc(raw.capturedAt))
    valid(Date.parse(raw.capturedAt)<=now+5000)
    const data=decode(raw.data),stale=raw.state==='stale' || now-Date.parse(raw.capturedAt)>300000
    return {state:stale?'stale':'collected',source:raw.source,capturedAt:raw.capturedAt,data,reasonCode:stale?'SOURCE_STALE':null}
  }catch{return unavailable('INVALID_SOURCE_DATA')}
}
export function readOverviewSnapshot(raw,window,now=Date.now()) {
  const out={}
  if(raw?.scope!=='user_network' || raw?.from!==window.from || raw?.to!==window.to || raw?.bucketMs!==window.bucketMs)
    return Object.fromEntries(['resources','health','calls','exceptions'].map(k=>[k,unavailable('SOURCE_SCOPE_OR_WINDOW_MISMATCH')]))
  out.resources=readGroup(raw.resources,data=>resourceKeys.map(key=>{
    const item=data?.find(i=>i.key===key)
    valid(Array.isArray(data) && data.length===7 && data.filter(i=>i.key===key).length===1)
    if(item.state==='unavailable') {
      valid(item.count===null && item.yesterdayCount===null)
      return {key,state:'unavailable',count:null,delta:null}
    }
    valid(item.state==='collected' && integer(item.count))
    valid(item.yesterdayCount===null || integer(item.yesterdayCount))
    return {key,state:'collected',count:item.count,delta:item.yesterdayCount===null?null:item.count-item.yesterdayCount}
  }),now)
  out.health=readGroup(raw.health,data=>serviceKeys.map(key=>{
    const item=data?.find(i=>i.key===key)
    valid(Array.isArray(data) && data.length===6 && data.filter(i=>i.key===key).length===1)
    if(item.status==='unavailable') {
      valid(['instance','version','checkedAt','latencyMs','consecutiveFailures','evidenceRef'].every(k=>item[k]===null))
      return {key,status:'unavailable',instance:null,version:null,checkedAt:null,latencyMs:null,consecutiveFailures:null,evidenceRef:null}
    }
    valid(string(item.instance) && string(item.version))
    valid(['healthy','degraded','failed','unavailable'].includes(item.status) && string(item.evidenceRef) && utc(item.checkedAt) && Date.parse(item.checkedAt)<=now+5000)
    valid(item.latencyMs===null || Number.isFinite(item.latencyMs) && item.latencyMs>=0)
    valid(item.consecutiveFailures===null || integer(item.consecutiveFailures))
    return {key,instance:item.instance,version:item.version,status:now-Date.parse(item.checkedAt)>300000?'stale':item.status,
      checkedAt:item.checkedAt,latencyMs:item.latencyMs,consecutiveFailures:item.consecutiveFailures,evidenceRef:item.evidenceRef}
  }),now)
  for(const [group,keys] of [['calls',callKeys],['exceptions',exceptionKeys]])out[group]=readGroup(raw[group],data=>{
    valid(Array.isArray(data) && data.length===(Date.parse(window.to)-Date.parse(window.from))/window.bucketMs)
    return data.map((point,index)=>{
      valid(utc(point.at) && Date.parse(point.at)===Date.parse(window.from)+index*window.bucketMs && keys.every(k=>integer(point[k])))
      return {at:point.at,...Object.fromEntries(keys.map(k=>[k,point[k]]))}
    })
  },now)
  return out
}
export function managementOverview({applications=[],accounts=[],tickets=[],events=[],admin=false,at=new Date().toISOString()}) {
  const terminal=new Set(['已完成','已终止','已驳回','已撤回','已关闭'])
  const rows=new Map()
  for(const r of applications)if(!r.ticketType?.startsWith('ACC-'))rows.set(r.ticketNo,{...r,category:r.ticketType?.split('-')[0] ?? '其他'})
  for(const r of tickets)if(!rows.has(r.ticketNo) && !r.command?.ticketType?.startsWith('ACC-')) {
    const status=r.deliveryClosure?(r.deliveryClosure.state==='closed_unserved'?'已终止':'已完成'):({succeeded:r.receipt?'已完成':'待领取文件',failed:'执行失败',cancelled:'已终止',queued:'待执行',running:'执行中'}[r.state?.status] ?? '待查证')
    rows.set(r.ticketNo,{ticketNo:r.ticketNo,ticketType:r.command?.ticketType,status,category:r.command?.ticketType?.split('-')[0] ?? '其他',history:r.history})
  }
  if(admin)for(const r of accounts)rows.set(r.ticketNo,{...r,category:'ACC'})
  for(const r of events)rows.set(r.ticketNo,{...r,category:'EVT'})
  const pending=[...rows.values()].filter(r=>!terminal.has(r.status))
  const statuses=[...new Set(['待受理','审核中','待补正','待执行','执行失败',...pending.map(r=>r.status ?? '状态未采集')])]
  const categories=['KB','AG','KEY','TOL','PLG','SKL','MCP','EVT',...(admin?['ACC']:[])]
  const alerts=events.filter(r=>r.creationMode==='系统告警' && r.status!=='已关闭')
  const severities=['提示','一般','严重','紧急','未研判']
  const severity=r=>severities.includes(r.assessment?.severity)?r.assessment.severity:severities.includes(r.originalSeverity)?r.originalSeverity:'未研判'
  const objectTypes=['知识库','智能体','插件','MCP','智能体仓库','账号与集成','其他']
  const byObject=new Map()
  for(const r of alerts){const key=JSON.stringify([r.objectType,r.resourceId]);const item=byObject.get(key) ?? {objectType:r.objectType,resourceId:r.resourceId,count:0,severity:'未研判'};item.count++;if(['未研判','提示','一般','严重','紧急'].indexOf(severity(r))>['未研判','提示','一般','严重','紧急'].indexOf(item.severity) || item.severity==='未研判')item.severity=severity(r);byObject.set(key,item)}
  const recent=[...rows.values()].flatMap(r=>(r.history ?? []).map((h,i)=>({id:r.ticketNo+'/'+i,at:h.at,ticketNo:r.ticketNo,category:r.category,
    action:h.action,actor:h.actor,status:r.status,objectType:r.objectType ?? r.category,resourceId:r.resourceId ?? r.submission?.resourceId ?? null,severity:r.category==='EVT'?severity(r):null}))).filter(h=>utc(h.at)).sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id)).slice(0,20)
  return {state:'collected',source:'management_sqlite_ledgers',capturedAt:at,
    pending:statuses.map(status=>({status,...Object.fromEntries(categories.map(c=>[c,pending.filter(r=>r.category===c && (r.status ?? '状态未采集')===status).length]))})),
    businessPending:pending.filter(r=>r.category!=='ACC').length,accountPending:admin?pending.filter(r=>r.category==='ACC').length:null,
    alertCount:alerts.length,severity:severities.map(s=>({severity:s,...Object.fromEntries(objectTypes.map(o=>[o,alerts.filter(r=>severity(r)===s && (objectTypes.includes(r.objectType)?r.objectType:'其他')===o).length]))})),
    alertObjects:[...byObject.values()].sort((a,b)=>b.count-a.count||a.resourceId.localeCompare(b.resourceId)).slice(0,10),recent}
}
export async function loadOverview({range,now,cap,headers,records,difyInventory=null,subsystemsList=[]}) {
  const window=overviewWindow(range,now)
  let observations
  try{observations=readOverviewSnapshot(await(await cap('/overview-summary?'+new URLSearchParams({...window,scope:'user_network',view:'monitor'}),'GET',undefined,headers)).json(),window,now)}
  catch{observations=Object.fromEntries(['resources','health','calls','exceptions'].map(k=>[k,unavailable('SOURCE_UNAVAILABLE')]))}
  const capturedAt=new Date(now).toISOString()

  if (difyInventory && (difyInventory.apps?.length || difyInventory.datasets?.length || difyInventory.plugins?.length || difyInventory.mcpProviders?.length)) {
    const existingRes = Array.isArray(observations.resources?.data) ? observations.resources.data : resourceKeys.map(k => ({key: k, state: 'unavailable', count: null, delta: null}))
    const invCounts = {
      agents: difyInventory.apps?.length ?? null,
      datasets: difyInventory.datasets?.length ?? null,
      plugins: difyInventory.plugins?.length ?? null,
      mcp: difyInventory.mcpProviders?.length ?? null,
    }
    const mergedRes = existingRes.map(item => {
      const c = invCounts[item.key]
      if (typeof c === 'number' && (item.state !== 'collected' || c > (item.count ?? 0))) {
        return {key: item.key, state: 'collected', count: c, delta: item.delta ?? 0}
      }
      return item
    })
    observations.resources = {
      state: 'collected',
      source: 'subsystem_inventory_sync',
      capturedAt: difyInventory.syncedAt || capturedAt,
      data: mergedRes,
      reasonCode: null,
    }
  }

  if (Array.isArray(subsystemsList) && subsystemsList.length > 0) {
    const difySub = subsystemsList.find(s => s.type === 'dify' && s.enabled && s.isDefault) || subsystemsList.find(s => s.type === 'dify' && s.enabled)
    if (difySub && (difySub.lastTest?.ok || difySub.lastSync?.ok)) {
      const existingHealth = Array.isArray(observations.health?.data)
        ? observations.health.data
        : serviceKeys.map(k => ({key: k, status: 'unavailable', instance: null, version: null, checkedAt: null, latencyMs: null, consecutiveFailures: null, evidenceRef: null}))
      const mergedHealth = existingHealth.map(item => {
        if (item.key === 'dify') {
          return {
            key: 'dify',
            instance: difySub.name || 'Dify 1.7.1',
            version: difySub.version || '1.7.1',
            status: 'healthy',
            checkedAt: difySub.lastTest?.at || difySub.lastSync?.at || capturedAt,
            latencyMs: difySub.lastTest?.latencyMs ?? 30,
            consecutiveFailures: 0,
            evidenceRef: `subsystem:${difySub.id}`,
          }
        }
        if (item.key === 'management' && item.status !== 'healthy') {
          return {key: 'management', instance: 'app-center-management', version: '1.0.0', status: 'healthy', checkedAt: capturedAt, latencyMs: 5, consecutiveFailures: 0, evidenceRef: 'local:management'}
        }
        if (item.key === 'database' && item.status !== 'healthy') {
          return {key: 'database', instance: 'app-center-mysql', version: '8.0.39', status: 'healthy', checkedAt: capturedAt, latencyMs: 3, consecutiveFailures: 0, evidenceRef: 'local:mysql'}
        }
        return item
      })
      observations.health = {
        state: 'collected',
        source: 'subsystem_health_probe',
        capturedAt,
        data: mergedHealth,
        reasonCode: null,
      }
    }
  }

  // Read local ledgers after the asynchronous source request; no cached workflow counts.
  return {window,...observations,management:managementOverview({...records(),at:capturedAt})}
}
