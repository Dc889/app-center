import {check} from '../../../../runtime/http.mjs'
import {keyRegistration} from './key-registrations.mjs'
export const keyActions={'轮换':'rotate_key','撤销':'revoke_key'}
export async function keyContext(cap,headers,resourceId,operation) {
  check(Object.hasOwn(keyActions,operation),400,'INVALID_KEY_ACTION')
  const action=keyActions[operation]
  const before=await keyRegistration(cap,headers,resourceId,action)
  const query=new URLSearchParams({action,resourceId})
  const raw=await(await cap('/execution-contexts/KEY-02?'+query,'GET',undefined,headers)).json()
  const f=raw.fields
  check(raw.ticketType==='KEY-02' && raw.action===action && raw.resourceId===resourceId &&
    typeof raw.snapshotId==='string' && raw.snapshotId.trim() && f &&
    ['Dify应用ID','Dify密钥ID','密钥后四位'].every(k=>typeof f[k]==='string' && f[k]) &&
    f['密钥后四位'].length===4 && Array.isArray(raw.preconditions) &&
    raw.preconditions.filter(p=>p && p.kind==='key_registration' && p.id===resourceId).length===1 &&
    raw.preconditions.some(p=>p && p.kind==='key_registration' && p.id===resourceId && Number.isInteger(p.revision) && p.revision>=0) &&
    raw.preconditions.every(p=>p && typeof p.kind==='string' && typeof p.id==='string' && Object.keys(p).every(key=>['kind','id','revision','version','sha256'].includes(key)) &&
      (p.revision===undefined || Number.isSafeInteger(p.revision) && p.revision>=0) && (p.version===undefined || typeof p.version==='string') && (p.sha256===undefined || /^[a-f0-9]{64}$/.test(p.sha256))),
    409,'INCOMPLETE_KEY_CONTEXT')
  const after=await keyRegistration(cap,headers,resourceId,action)
  const revision=raw.preconditions.find(p=>p.kind==='key_registration' && p.id===resourceId).revision
  check(['appId','workspaceId','keyId','lastFour','revision'].every(key=>before[key]===after[key]) && revision===after.revision &&
    (f['Dify workspace ID']===undefined || f['Dify workspace ID']===after.workspaceId) &&
    f['Dify应用ID']===after.appId && f['Dify密钥ID']===after.keyId && f['密钥后四位']===after.lastFour,409,'KEY_REGISTRATION_MISMATCH','密钥登记或执行依据已变化，请重新读取')
  return {snapshotId:raw.snapshotId,ticketType:'KEY-02',action,resourceId,capturedAt:raw.capturedAt,
    fields:{'密钥登记ID':resourceId,'Dify workspace ID':after.workspaceId,'Dify应用ID':f['Dify应用ID'],'Dify密钥ID':f['Dify密钥ID'],'密钥后四位':f['密钥后四位']},
    preconditions:raw.preconditions}
}
export function keyFields(snapshot,fields) {
  return {...snapshot.fields,'创建方式':'人工申请','操作类型':fields.operation,'操作原因':fields.reason,
    '生效时间':fields.effectiveAt,'新有效期截止时间':fields.operation==='轮换'?fields.newExpiresAt:null}
}
