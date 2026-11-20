import {check} from '../../../../runtime/http.mjs'
export const toolOperations=['首次批准','变更再审','撤销批准']
export async function toolContext(cap,headers,resourceId,workspaceId,operation) {
  check(toolOperations.includes(operation),400,'INVALID_TOOL_OPERATION')
  check(typeof workspaceId==='string' && workspaceId.trim() && workspaceId.length<=200,400,'WORKSPACE_REQUIRED')
  const query=new URLSearchParams({action:'set_tool_approval',resourceId,workspaceId,operation})
  const raw=await(await cap('/execution-contexts/TOL-01?'+query,'GET',undefined,headers)).json()
  check(raw.eligible!==false,403,'TOOL_APPROVAL_DENIED','当前身份没有此工具操作的申请资格')
  const f=raw.fields
  check(raw.ticketType==='TOL-01' && raw.action==='set_tool_approval' && raw.resourceId===resourceId &&
    raw.operation===operation && raw.eligible===true && typeof raw.snapshotId==='string' && raw.snapshotId.trim() && f && f['Dify workspace ID']===workspaceId &&
    ['Dify工具ID','Dify工具提供者ID','工具名称','工具提供者名称'].every(key=>typeof f[key]==='string' && f[key].trim()) &&
    (operation==='撤销批准'?['产品现状','批准登记'].includes(f['配置来源']):f['配置来源']==='产品现状') &&
    /^[a-f0-9]{64}$/.test(f['工具配置指纹']) && typeof f['工具版本']==='string' && f['工具版本'] &&
    f['输入参数schema'] && typeof f['输入参数schema']==='object' && !Array.isArray(f['输入参数schema']) && typeof f['输出说明']==='string' && Array.isArray(raw.preconditions) &&
    raw.preconditions.filter(p=>p && p.kind==='tool_configuration' && p.id===resourceId).length===1 &&
    raw.preconditions.some(p=>p && p.kind==='tool_configuration' && p.id===resourceId && p.sha256===f['工具配置指纹']) &&
    raw.preconditions.filter(p=>p && p.kind==='tool_approval' && p.id===resourceId).length===1 &&
    raw.preconditions.some(p=>p && p.kind==='tool_approval' && p.id===resourceId && Number.isSafeInteger(p.revision) && (operation==='首次批准'?p.revision===0:p.revision>0)) &&
    raw.preconditions.every(p=>p && typeof p.kind==='string' && typeof p.id==='string' && Object.keys(p).every(key=>['kind','id','revision','version','sha256'].includes(key)) &&
      (p.revision===undefined || Number.isSafeInteger(p.revision) && p.revision>=0) && (p.version===undefined || typeof p.version==='string') && (p.sha256===undefined || /^[a-f0-9]{64}$/.test(p.sha256))),
    409,'INCOMPLETE_TOOL_CONTEXT')
  if(operation==='首次批准')check(!f['原批准工单号'],409,'EXISTING_TOOL_APPROVAL')
  if(operation!=='首次批准')check(typeof f['原批准工单号']==='string' && f['原批准工单号'],409,'MISSING_PREVIOUS_APPROVAL')
  if(operation==='变更再审')check(typeof f['原工具版本']==='string' && f['原工具版本'] && /^[a-f0-9]{64}$/.test(f['原工具配置指纹']) &&
    Array.isArray(f['配置差异']) && f['配置差异'].every(d=>d && typeof d==='object' && !Array.isArray(d) &&
      Object.keys(d).every(key=>['差异项','原值摘要','新值摘要'].includes(key)) && ['差异项','原值摘要','新值摘要'].every(key=>typeof d[key]==='string')),409,'MISSING_TOOL_DIFF')
  const fields={}
  for(const key of ['Dify workspace ID','Dify工具ID','Dify工具提供者ID','工具名称','工具提供者名称','配置来源','工具配置指纹','工具版本','输入参数schema','输出说明','原批准工单号','原工具版本','原工具配置指纹','配置差异']) {
    if(f[key]!==undefined)fields[key]=f[key]
  }
  return {snapshotId:raw.snapshotId,ticketType:'TOL-01',action:'set_tool_approval',operation,eligible:true,resourceId,capturedAt:raw.capturedAt,fields,preconditions:raw.preconditions}
}
