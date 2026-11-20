import {check} from '../../../../runtime/http.mjs'
export const revisionKinds={'SKL-02':'skill','PLG-02':'plugin'}
export const revisionActions={'SKL-02':'revise_skill','PLG-02':'revise_package'}
export async function packageRevisionContext(cap,headers,ticketType,resourceId) {
  const query=new URLSearchParams({action:revisionActions[ticketType],resourceId})
  const raw=await(await cap('/execution-contexts/'+ticketType+'?'+query,'GET',undefined,headers)).json()
  const f=raw.fields
  const hashKey=ticketType==='SKL-02'?'原文件SHA-256':'原版本指纹'
  check(raw.ticketType===ticketType && raw.action===revisionActions[ticketType] && raw.resourceId===resourceId &&
    typeof raw.snapshotId==='string' && raw.snapshotId && f &&
    typeof f['原版本号']==='string' && f['原版本号'] && /^[a-f0-9]{64}$/.test(f[hashKey]) &&
    Array.isArray(raw.preconditions) && raw.preconditions.some(p=>p.kind===revisionKinds[ticketType] &&
      p.id===resourceId && Number.isInteger(p.revision) && p.revision>=0),409,'INCOMPLETE_PACKAGE_REVISION')
  if(ticketType==='PLG-02')check(typeof f['插件唯一标识']==='string' && f['插件唯一标识'],409,'MISSING_PLUGIN_IDENTITY')
  return {snapshotId:raw.snapshotId,ticketType,action:raw.action,resourceId,capturedAt:raw.capturedAt,fields:f,preconditions:raw.preconditions}
}
export function checkNewPackage(ticketType,fields,context,intake) {
  const version=ticketType==='SKL-02'?fields.newVersion:intake.packageMetadata.version
  check(version!==context.fields['原版本号'],409,'VERSION_ALREADY_PUBLISHED')
  if(ticketType==='PLG-02')check(intake.packageMetadata.uniqueIdentifier===context.fields['插件唯一标识'],409,'PLUGIN_IDENTITY_MISMATCH')
}
export function packageRevisionFields(ticketType,fields,context,intake,decision) {
  const base={intakeId:intake.intakeId,'原版本号':context.fields['原版本号'],'变更说明':fields.changeDescription}
  if(ticketType==='SKL-02')return {...base,'新版本号':fields.newVersion,'原文件SHA-256':context.fields['原文件SHA-256'],
    '新文件SHA-256':intake.sha256,'历史版本下载策略':decision.historyPolicy}
  return {...base,'新版本号':intake.packageMetadata.version,'原版本指纹':context.fields['原版本指纹'],
    '新版本指纹':intake.sha256,'升级策略':fields.upgradePolicy,'对外使用权限':decision.externalAllowed}
}
