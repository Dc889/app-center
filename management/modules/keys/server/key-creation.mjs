import {isIP} from 'node:net'
import {check} from '../../../../runtime/http.mjs'
export function validCidrs(values) {
  return Array.isArray(values) && values.length>0 && values.length<=100 && values.every(value=>{
    if(typeof value!=='string')return false
    const parts=value.split('/')
    const family=isIP(parts[0])
    return parts.length===2 && family>0 && /^\d{1,3}$/.test(parts[1]) &&
      Number(parts[1])<=(family===4?32:128)
  })
}
export async function keyCreationContext(cap,headers,resourceId,workspaceId) {
  const query=new URLSearchParams({action:'create_key',resourceId,workspaceId})
  const raw=await(await cap('/execution-contexts/KEY-01?'+query,'GET',undefined,headers)).json()
  const f=raw.fields
  check(raw.ticketType==='KEY-01' && raw.action==='create_key' && raw.resourceId===resourceId &&
    typeof raw.snapshotId==='string' && raw.snapshotId && f && f['Dify应用ID']===resourceId &&
    typeof f['所有者账户名']==='string' && f['所有者账户名'] && typeof f['Dify API地址']==='string' &&
    Array.isArray(raw.preconditions),409,'INCOMPLETE_KEY_CREATION_CONTEXT')
  return {snapshotId:raw.snapshotId,ticketType:'KEY-01',action:'create_key',resourceId,capturedAt:raw.capturedAt,
    fields:{'Dify应用ID':resourceId,'所有者账户名':f['所有者账户名'],'Dify API地址':f['Dify API地址'],
      '关联发布工单号':f['关联发布工单号'] ?? null},preconditions:raw.preconditions}
}
export function keyCreationFields(fields) {
  return {'密钥用途':fields.purpose,'调用方名称':fields.callerName,'调用方组织':fields.callerOrg,'调用环境':fields.environment,
    '允许来源CIDR':fields.allowedCidrs,'预计峰值QPS':fields.peakQps,'有效期截止时间':fields.expiresAt,
    '关联发布工单号':fields.publicationTicketNo ?? null}
}
