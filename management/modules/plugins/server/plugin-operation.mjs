import {check,id} from '../../../../runtime/http.mjs'
export const pluginOperationActions={'安装':'install','升级':'upgrade','卸载':'uninstall'}
export async function pluginOperationContext(cap,headers,resourceId,workspaceId,operation,installationId='') {
  check(Object.hasOwn(pluginOperationActions,operation) && typeof workspaceId==='string' && workspaceId.trim() && workspaceId.length<=200,400,'INVALID_PLUGIN_OPERATION')
  const action=pluginOperationActions[operation]
  if(operation==='安装') {
    check(!installationId,400,'UNEXPECTED_INSTALLATION')
    const item=await(await cap('/catalog/plugin/'+encodeURIComponent(resourceId)+'?workspaceId='+encodeURIComponent(workspaceId),
      'GET',undefined,headers)).json()
    const d=item?.data
    check(item && item.resourceId===resourceId && item.status==='approved' && typeof item.name==='string' && item.name.trim() && d && typeof d.version==='string' && d.version &&
      /^[a-f0-9]{64}$/.test(d.sha256) && ['instant','approval','denied'].includes(d.installAccess),409,'INVALID_PLUGIN_INSTALL_CONTEXT')
    check(d.installAccess!=='denied',403,'PLUGIN_OPERATION_DENIED')
    return {snapshotId:'plugin-context-'+id(),resourceId,data:{workspaceId,operation,name:item.name,version:d.version,sha256:d.sha256,
      access:d.installAccess},preconditions:[{kind:'plugin',id:resourceId,sha256:d.sha256}]}
  }
  check(typeof installationId==='string' && installationId.trim() && installationId.length<=200,400,'INSTALLATION_REQUIRED')
  const query=new URLSearchParams({action,resourceId,workspaceId,installationId})
  const raw=await(await cap('/execution-contexts/PLG-03?'+query,'GET',undefined,headers)).json()
  check(raw?.eligible!==false,403,'PLUGIN_OPERATION_DENIED')
  const f=raw?.fields
  check(raw && raw.ticketType==='PLG-03' && raw.action===action && raw.resourceId===resourceId && raw.eligible===true && typeof raw.snapshotId==='string' && raw.snapshotId.trim() &&
    f && f['目标Dify workspace ID']===workspaceId && typeof f['插件名称']==='string' && f['插件名称'].trim() && typeof f['批准版本号']==='string' && f['批准版本号'] &&
    typeof f['原安装版本号']==='string' && f['原安装版本号'] && /^[a-f0-9]{64}$/.test(f['原安装指纹']) &&
    /^[a-f0-9]{64}$/.test(f['版本指纹']) && f['安装实例ID']===installationId &&
    ['免审','需审批','不允许'].includes(f['权限匹配结果']) &&
    Array.isArray(raw.preconditions) && raw.preconditions.filter(p=>p && p.kind==='plugin_installation' && p.id===installationId).length===1 &&
    raw.preconditions.some(p=>p && p.kind==='plugin_installation' && p.id===installationId && Number.isSafeInteger(p.revision) && p.revision>=0) &&
    raw.preconditions.every(p=>p && typeof p.kind==='string' && typeof p.id==='string' && Object.keys(p).every(key=>['kind','id','revision','version','sha256'].includes(key)) &&
      (p.revision===undefined || Number.isSafeInteger(p.revision) && p.revision>=0) && (p.version===undefined || typeof p.version==='string') && (p.sha256===undefined || /^[a-f0-9]{64}$/.test(p.sha256))),409,'INCOMPLETE_PLUGIN_OPERATION')
  check(f['权限匹配结果']!=='不允许',403,'PLUGIN_OPERATION_DENIED')
  if(operation==='升级')check(f['升级策略']==='逐个工单升级' && raw.preconditions.filter(p=>p.kind==='plugin' && p.id===resourceId && p.sha256===f['版本指纹']).length===1,409,'UPGRADE_NOT_APPROVED')
  if(operation==='卸载')check(f['批准版本号']===f['原安装版本号'] && f['版本指纹']===f['原安装指纹'],409,'UNINSTALL_VERSION_MISMATCH')
  return {snapshotId:raw.snapshotId,resourceId,data:{workspaceId,operation,name:f['插件名称'],version:f['批准版本号'],sha256:f['版本指纹'],
    installedVersion:f['原安装版本号'],installedSha256:f['原安装指纹'],
    installationId:f['安装实例ID'],access:f['权限匹配结果']==='免审'?'instant':'approval',
    upgradePolicy:f['升级策略'] ?? null},preconditions:raw.preconditions}
}
export function pluginOperationPayload(context,executionId) {
  const d=context.data
  return d.operation==='安装'?{workspaceId:d.workspaceId,version:d.version,sha256:d.sha256}:{decisionRef:'dec-'+executionId}
}
export function pluginOperationFields(context) {
  const d=context.data
  return {'操作类型':d.operation,'目标Dify workspace ID':d.workspaceId,'插件名称':d.name,'批准版本号':d.version,'版本指纹':d.sha256,'升级策略':d.upgradePolicy ?? null,
    '安装实例ID':d.installationId ?? null,'原安装版本号':d.installedVersion ?? null,'原安装指纹':d.installedSha256 ?? null}
}
