import {check} from '../../../../runtime/http.mjs'
export async function readyIntake(cap,headers,kind,intakeId) {
  check(typeof intakeId==='string' && /^[\w-]+$/.test(intakeId),400,'INVALID_INTAKE_ID')
  const data=await(await cap('/intake/'+kind+'/'+encodeURIComponent(intakeId),'GET',undefined,headers)).json()
  check(data.intakeId===intakeId && data.status==='ready' && /^[a-f0-9]{64}$/.test(data.sha256) &&
    Number.isInteger(data.sizeBytes) && data.sizeBytes>=0 && typeof data.filename==='string' &&
    data.scan?.verdict==='passed' && Number.isFinite(Date.parse(data.scan.checkedAt)),409,'UPLOAD_NOT_APPROVED','文件尚未就绪或扫描未通过')
  let packageMetadata
  if(kind==='plugin') {
    const p=data.packageMetadata
    check(p && ['uniqueIdentifier','name','version'].every(k=>typeof p[k]==='string' && p[k]) &&
      Array.isArray(p.dependencies) && p.dependencies.every(d=>['name','version','license'].every(k=>typeof d[k]==='string')),
      409,'MISSING_PLUGIN_IDENTITY')
    packageMetadata={uniqueIdentifier:p.uniqueIdentifier,name:p.name,version:p.version,
      dependencies:p.dependencies.map(d=>({name:d.name,version:d.version,license:d.license}))}
  }
  return {packageMetadata,intakeId:data.intakeId,status:'ready',sha256:data.sha256,sizeBytes:data.sizeBytes,filename:data.filename,
    scan:{checkedAt:data.scan.checkedAt,verdict:data.scan.verdict}}
}
export function skillPublicationFields(fields,intake,account) {
  return {intakeId:intake.intakeId,'版本号':fields.version,'审批文件指纹':intake.sha256,'Skill名称':fields.name,
    '功能说明':fields.description,'使用说明':fields.instructions,'作者账户名':account,'许可证':fields.license,
    '公开方式':fields.scope,'目标组织':fields.targetOrgs ?? [],'目标人员':fields.targetAccounts ?? [],'目录标签':fields.tags}
}

export function pluginPublicationFields(fields,intake,account,externalAllowed) {
  const p=intake.packageMetadata
  return {intakeId:intake.intakeId,'插件唯一标识':p.uniqueIdentifier,'插件名称':p.name,'版本号':p.version,
    '审批版本指纹':intake.sha256,'发布者账户名':account,'功能说明':fields.description,'使用说明':fields.instructions,
    '权限声明':fields.permissions,'外部网络访问清单':fields.networkAccess,'公开方式':fields.accessMode,
    '可见组织':fields.visibleOrgs ?? [],'对外使用权限':externalAllowed,'Dify安装方式':fields.installationMethod}
}
