import {check} from '../../../../runtime/http.mjs'
export const keyRegistrationActions=['rotate_key','revoke_key']
const text=value=>typeof value==='string' && !!value.trim() && value.length<=200
export function registrationMetadata(row,{detail=false}={}) {
  check(row && ['registrationId','appId','workspaceId'].every(key=>text(row[key])) && typeof row.lastFour==='string' && row.lastFour.length===4 &&
    ['active','expired','revoked','rotated','reconciling'].includes(row.status) && Number.isSafeInteger(row.revision) && row.revision>=0 &&
    Array.isArray(row.actions) && row.actions.every(action=>typeof action==='string' && action.length<=64) &&
    (!detail || text(row.keyId)),503,'INVALID_KEY_REGISTRATION','密钥登记元数据不完整')
  const result={registrationId:row.registrationId,appId:row.appId,workspaceId:row.workspaceId,lastFour:row.lastFour,status:row.status,revision:row.revision,
    actions:[...new Set(row.actions.filter(action=>keyRegistrationActions.includes(action)))]}
  for(const key of ['appName','callerName','callerOrg','environment'])if(row[key]!==undefined && row[key]!==null) {
    check(text(row[key]),503,'INVALID_KEY_REGISTRATION');result[key]=row[key]
  }
  if(detail)result.keyId=row.keyId
  return result
}
export const registrationEligible=(row,action)=>['active','expired'].includes(row.status) && row.actions.includes(action)
export async function keyRegistration(cap,headers,registrationId,action) {
  check(keyRegistrationActions.includes(action),400,'INVALID_KEY_ACTION')
  const row=registrationMetadata(await(await cap('/key-registrations/'+encodeURIComponent(registrationId)+'?action='+action,'GET',undefined,headers)).json(),{detail:true})
  check(row.registrationId===registrationId,409,'KEY_REGISTRATION_MISMATCH')
  check(registrationEligible(row,action),403,'KEY_ACTION_DENIED','当前登记状态或身份不允许此密钥操作')
  return row
}
export async function keyRegistrationPage(cap,headers,params) {
  const action=params.get('action')
  check(keyRegistrationActions.includes(action),400,'INVALID_KEY_ACTION')
  const raw=await(await cap('/key-registrations?'+params,'GET',undefined,headers)).json()
  check(raw && Array.isArray(raw.items) && (raw.nextCursor===null || typeof raw.nextCursor==='string' && raw.nextCursor.length>0 && raw.nextCursor.length<=200),503,'INVALID_KEY_REGISTRATION_PAGE')
  const items=raw.items.map(row=>registrationMetadata(row))
  check(new Set(items.map(row=>row.registrationId)).size===items.length,503,'INVALID_KEY_REGISTRATION_PAGE')
  return {items:items.filter(row=>registrationEligible(row,action)),nextCursor:raw.nextCursor}
}
