import {check} from '../../../../runtime/http.mjs'
const text=value=>typeof value==='string' && !!value.trim() && value.length<=200
export async function replacementPage(cap,headers,input){
  const sourceResourceId=input.get('sourceResourceId');check(text(sourceResourceId),400,'INVALID_REPLACEMENT_QUERY')
  const query=new URLSearchParams({sourceResourceId})
  for(const key of ['q','cursor','limit']){const value=input.get(key);if(value){check(value.length<=200 && (key!=='limit' || /^\d{1,3}$/.test(value) && Number(value)>=1 && Number(value)<=100),400,'INVALID_QUERY');query.set(key,value)}}
  const raw=await(await cap('/agent-replacements?'+query,'GET',undefined,headers)).json()
  check(raw && Array.isArray(raw.items) && (raw.nextCursor===null || text(raw.nextCursor)) && raw.items.every(row=>row && text(row.resourceId) && row.resourceId!==sourceResourceId && text(row.name)) && new Set(raw.items.map(row=>row.resourceId)).size===raw.items.length,503,'INVALID_REPLACEMENT_PAGE')
  return {items:raw.items.map(({resourceId,name})=>({resourceId,name})),nextCursor:raw.nextCursor}
}
export async function replacementContext(cap,headers,sourceResourceId,resourceId){
  if(resourceId==null || resourceId==='')return null
  check(text(sourceResourceId) && text(resourceId) && resourceId!==sourceResourceId,400,'INVALID_REPLACEMENT')
  const raw=await(await cap('/agent-replacements/'+encodeURIComponent(resourceId)+'?'+new URLSearchParams({sourceResourceId}),'GET',undefined,headers)).json()
  check(raw?.eligible!==false,403,'REPLACEMENT_DENIED')
  check(raw && raw.eligible===true && raw.sourceResourceId===sourceResourceId && raw.resourceId===resourceId && raw.status==='active' &&
    ['name','appId','workspaceId','sourceAppId','sourceWorkspaceId','publicationVersionId','policyRef'].every(key=>text(raw[key])) && Number.isSafeInteger(raw.revision) && raw.revision>=0 &&
    !(raw.appId===raw.sourceAppId && raw.workspaceId===raw.sourceWorkspaceId),409,'INVALID_REPLACEMENT_CONTEXT')
  check(raw.audienceCompatible===true,403,'REPLACEMENT_SCOPE_MISMATCH')
  return Object.fromEntries(['sourceResourceId','resourceId','name','appId','workspaceId','sourceAppId','sourceWorkspaceId','publicationVersionId','policyRef','revision'].map(key=>[key,raw[key]]))
}
export function verifyReplacementSource(replacement,catalog){
  if(replacement)check(replacement.sourceAppId===catalog.data.appId && replacement.sourceWorkspaceId===catalog.data.workspaceId,409,'REPLACEMENT_SOURCE_MISMATCH')
}
