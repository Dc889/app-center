import {check,same} from '../../../../runtime/http.mjs'
import {agentManagementContext} from './agent-management.mjs'
const text=value=>typeof value==='string' && !!value.trim() && value.length<=200
const integer=value=>Number.isSafeInteger(value) && value>=0
const time=value=>typeof value==='string' && value.endsWith('Z') && Number.isFinite(Date.parse(value))
export function readAgentImpact(raw,{resourceId,appId,workspaceId}){
  check(raw && raw.resourceId===resourceId && raw.appId===appId && raw.workspaceId===workspaceId && text(raw.snapshotId) && time(raw.capturedAt),409,'INCOMPLETE_AGENT_IMPACT')
  check(Date.now()-Date.parse(raw.capturedAt)<=300000 && Date.parse(raw.capturedAt)-Date.now()<=5000,409,'STALE_AGENT_IMPACT_CAPTURE')
  const result={resourceId,appId,workspaceId,snapshotId:raw.snapshotId,capturedAt:raw.capturedAt}
  for(const kind of ['grants','keys','dependencies']){
    const group=raw[kind]
    check(group && ['collected','unavailable'].includes(group.state),409,'INCOMPLETE_AGENT_IMPACT')
    if(group.state==='unavailable'){
      check(group.count===null && group.items===null && group.revision===null && text(group.reasonCode),409,'INVALID_UNCOLLECTED_IMPACT')
      result[kind]={state:'unavailable',count:null,items:null,revision:null,reasonCode:group.reasonCode};continue
    }
    check(Array.isArray(group.items) && integer(group.revision) && integer(group.count) && group.count===group.items.length,409,'INVALID_IMPACT_INVENTORY')
    let items
    if(kind==='dependencies'){
      check(group.items.every(row=>row && ['tool','plugin','mcp','dataset','skill'].includes(row.kind) && text(row.id) && text(row.name) &&
        ['added','removed','changed','unchanged'].includes(row.change) && typeof row.approved==='boolean' && typeof row.externalAllowed==='boolean' && /^[a-f0-9]{64}$/.test(row.fingerprint)),409,'INVALID_IMPACT_DEPENDENCIES')
      check(new Set(group.items.map(row=>JSON.stringify([row.kind,row.id]))).size===group.items.length,409,'DUPLICATE_IMPACT_RESOURCE')
      items=group.items.map(({kind,id,name,change,approved,externalAllowed,fingerprint})=>({kind,id,name,change,approved,externalAllowed,fingerprint})).sort((a,b)=>JSON.stringify([a.kind,a.id]).localeCompare(JSON.stringify([b.kind,b.id])))
    }else{
      check(group.items.every(text) && new Set(group.items).size===group.items.length,409,'INVALID_IMPACT_INVENTORY')
      items=[...group.items].sort()
    }
    result[kind]={state:'collected',count:items.length,revision:group.revision,items}
  }
  const calls=raw.calls30d
  check(calls && ['collected','unavailable'].includes(calls.state),409,'INCOMPLETE_AGENT_IMPACT')
  if(calls.state==='unavailable'){
    check(calls.count===null && calls.from===null && calls.to===null && text(calls.reasonCode),409,'INVALID_UNCOLLECTED_IMPACT')
    result.calls30d={state:'unavailable',count:null,from:null,to:null,reasonCode:calls.reasonCode}
  }else{
    check(integer(calls.count) && time(calls.from) && time(calls.to) && Date.parse(calls.to)-Date.parse(calls.from)===30*86400000 && Date.parse(calls.to)<=Date.parse(raw.capturedAt) && Date.parse(raw.capturedAt)-Date.parse(calls.to)<=300000 && text(calls.source),409,'INVALID_CALL_STATISTICS')
    result.calls30d={state:'collected',count:calls.count,from:calls.from,to:calls.to,source:calls.source}
  }
  return result
}
export function requireAgentImpact(impact,action){
  check((action==='withdraw_app'?['grants','keys','dependencies']:['dependencies']).every(kind=>impact[kind].state==='collected'),409,'AGENT_IMPACT_NOT_COLLECTED','关键影响清单尚未采集，不能提交或批准')
}
export function impactPreconditions(impact){
  return ['grants','keys','dependencies'].filter(kind=>impact[kind].state==='collected').map(kind=>({kind:'agent_'+kind,id:impact.resourceId,revision:impact[kind].revision}))
}
export function sameAgentImpact(previous,current){return ['grants','keys','dependencies'].every(kind=>same(previous[kind],current[kind]))}
export async function agentImpactContext(cap,headers,resourceId,workspaceId,action){
  const catalog=await agentManagementContext(cap,headers,resourceId,workspaceId,action)
  const snapshot=await(await cap('/resources/dify_app/'+encodeURIComponent(catalog.data.appId)+'?'+new URLSearchParams({workspaceId,catalogResourceId:resourceId}),'GET',undefined,headers)).json()
  check(snapshot && snapshot.resourceId===catalog.data.appId && snapshot.workspaceId===workspaceId && snapshot.data && text(snapshot.data.publicationVersionId) && integer(snapshot.data.catalogRevision) &&
    (action!=='republish' || text(snapshot.data.workflowSnapshotId)),409,'INVALID_AGENT_IMPACT_SOURCE')
  const impact=readAgentImpact(snapshot.data.agentImpact,{resourceId,appId:catalog.data.appId,workspaceId})
  const latest=await agentManagementContext(cap,headers,resourceId,workspaceId,action)
  check(['appId','workspaceId','publicationVersionId','workflowSnapshotId','policyRef'].every(key=>same(latest.data[key],catalog.data[key])),409,'STALE_AGENT_IMPACT')
  return {impact,publicationVersionId:snapshot.data.publicationVersionId,workflowSnapshotId:snapshot.data.workflowSnapshotId ?? null,catalogRevision:snapshot.data.catalogRevision}
}
