import {check} from '../../../../runtime/http.mjs'
export const targetPurposes=['dataset_binding','mcp_binding','dataset_publication']
const text=value=>typeof value==='string' && !!value.trim() && value.length<=200
export async function applicationTargetPage(cap,headers,input) {
  const purpose=input.get('purpose'),workspaceId=input.get('workspaceId')
  check(targetPurposes.includes(purpose) && text(workspaceId),400,'INVALID_APPLICATION_TARGET_QUERY')
  const query=new URLSearchParams({purpose,workspaceId})
  for(const key of ['q','cursor','limit']){
    const value=input.get(key)
    if(value){check(value.length<=200 && (key!=='limit' || /^\d{1,3}$/.test(value) && Number(value)>=1 && Number(value)<=100),400,'INVALID_QUERY');query.set(key,value)}
  }
  const raw=await(await cap('/application-targets?'+query,'GET',undefined,headers)).json()
  check(raw && Array.isArray(raw.items) && (raw.nextCursor===null || text(raw.nextCursor)) && raw.items.every(row=>row && text(row.appId) && text(row.name) && row.workspaceId===workspaceId) &&
    new Set(raw.items.map(row=>row.appId)).size===raw.items.length,503,'INVALID_APPLICATION_TARGET_PAGE')
  return {items:raw.items.map(({appId,name,workspaceId})=>({appId,name,workspaceId})),nextCursor:raw.nextCursor}
}
export async function applicationTarget(cap,headers,purpose,workspaceId,appId) {
  if(appId==null || appId==='')return null
  check(targetPurposes.includes(purpose) && text(workspaceId) && text(appId),400,'INVALID_APPLICATION_TARGET_QUERY')
  const raw=await(await cap('/application-targets/'+encodeURIComponent(appId)+'?'+new URLSearchParams({purpose,workspaceId}),'GET',undefined,headers)).json()
  check(raw?.eligible!==false,403,'APPLICATION_TARGET_DENIED')
  check(raw && raw.eligible===true && raw.appId===appId && raw.workspaceId===workspaceId && raw.purpose===purpose && text(raw.name) && text(raw.targetRef) &&
    Number.isSafeInteger(raw.revision) && raw.revision>=0,409,'INVALID_APPLICATION_TARGET')
  return {appId,name:raw.name,workspaceId,purpose,targetRef:raw.targetRef,revision:raw.revision}
}
export function targetPreconditions(preconditions,target) {
  if(!target)return preconditions
  check(!preconditions.some(p=>p.kind==='application_target' && p.id===target.targetRef),409,'AMBIGUOUS_APPLICATION_TARGET')
  return [...preconditions,{kind:'application_target',id:target.targetRef,revision:target.revision}]
}
export function targetFields(target) {
  return target?{'目标智能体ID':target.appId,'目标应用名称':target.name,'目标应用工作区ID':target.workspaceId,'目标应用登记ID':target.targetRef}:{}
}
