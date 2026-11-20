import {check} from '../../../../runtime/http.mjs'
export const bindingPermissions=['检索使用','编排绑定']
const text=value=>typeof value==='string' && !!value.trim()
export async function bindingCandidates(cap,headers,input) {
  const workspaceId=input.get('workspaceId'),permission=input.get('permission') ?? '检索使用'
  check(input.get('action')==='bind_dataset' && text(workspaceId) && workspaceId.length<=200 && bindingPermissions.includes(permission),400,'INVALID_BINDING_CANDIDATE_QUERY')
  const query=new URLSearchParams({action:'bind_dataset',workspaceId,permission})
  for(const key of ['q','cursor','limit']){
    const value=input.get(key)
    if(value){check(value.length<=200 && (key!=='limit' || /^\d{1,3}$/.test(value) && Number(value)>=1 && Number(value)<=100),400,'INVALID_QUERY');query.set(key,value)}
  }
  const raw=await(await cap('/execution-contexts/KB-03/candidates?'+query,'GET',undefined,headers)).json()
  check(raw && Array.isArray(raw.items) && (raw.nextCursor===null || text(raw.nextCursor) && raw.nextCursor.length<=200),503,'INVALID_BINDING_CANDIDATES')
  check(raw.items.every(row=>row && ['resourceId','name','workspaceId','sourceScopeId','sourceResourceId','ownerAccount'].every(key=>text(row[key]) && row[key].length<=200) &&
    row.workspaceId===workspaceId && ['本人纳管','已发布共享'].includes(row.source) && ['Dify','RAGFlow'].includes(row.sourceSystem) &&
    (row.source!=='本人纳管' || row.ownerAccount===headers['x-account'])) && new Set(raw.items.map(row=>row.resourceId)).size===raw.items.length,503,'INVALID_BINDING_CANDIDATES')
  return {items:raw.items.map(({resourceId,name,workspaceId,source,sourceSystem,sourceScopeId,sourceResourceId,ownerAccount})=>({resourceId,name,workspaceId,source,sourceSystem,sourceScopeId,sourceResourceId,ownerAccount})),nextCursor:raw.nextCursor}
}
export async function bindingContext(cap,headers,resourceId,workspaceId,permission='检索使用',targetAppId='') {
  check(text(workspaceId) && workspaceId.length<=200 && bindingPermissions.includes(permission),400,'INVALID_BINDING_QUERY')
  const query=new URLSearchParams({action:'bind_dataset',resourceId,workspaceId,permission})
  if(targetAppId!=null && targetAppId!==''){check(text(targetAppId) && targetAppId.length<=200,400,'INVALID_APPLICATION_TARGET_QUERY');query.set('targetAppId',targetAppId)}
  const snapshot=await(await cap('/execution-contexts/KB-03?'+query,'GET',undefined,headers)).json()
  check(snapshot?.eligible!==false,403,'DATASET_BINDING_DENIED')
  const f=snapshot?.fields
  check(snapshot && snapshot.ticketType==='KB-03' && snapshot.action==='bind_dataset' && snapshot.resourceId===resourceId && snapshot.eligible===true &&
    typeof snapshot.snapshotId==='string' && snapshot.snapshotId && f && Array.isArray(snapshot.preconditions) &&
    ['本人纳管','已发布共享'].includes(f['目录来源']) && ['知识库名称','业务线'].every(key=>text(f[key])) && ['公开','内部','敏感','机密'].includes(f['密级']) &&
    Array.isArray(f['组织边界']) && f['组织边界'].length>0 && f['组织边界'].every(text) &&
    Array.isArray(f['允许申请权限']) && f['允许申请权限'].length>0 && f['允许申请权限'].every(p=>bindingPermissions.includes(p)) &&
    ['RAGFlow','Dify'].includes(f['来源系统']) && text(f['源知识库ID']) &&
    text(f['源所有者账户名']) && f['目标Dify workspace ID']===workspaceId &&
    typeof f['源workspace/tenant ID']==='string' && f['源workspace/tenant ID'] &&
    typeof f.policyRef==='string' && f.policyRef &&
    snapshot.preconditions.filter(p=>p && p.kind==='dataset_catalog' && p.id===resourceId).length===1 &&
    snapshot.preconditions.some(p=>p && p.kind==='dataset_catalog' && p.id===resourceId && Number.isSafeInteger(p.revision) && p.revision>=0) &&
    snapshot.preconditions.every(p=>p && text(p.kind) && text(p.id) && Object.keys(p).every(key=>['kind','id','revision','version','sha256'].includes(key)) &&
      (p.revision===undefined || Number.isSafeInteger(p.revision) && p.revision>=0) && (p.version===undefined || typeof p.version==='string') && (p.sha256===undefined || /^[a-f0-9]{64}$/.test(p.sha256))),409,'INCOMPLETE_BINDING_CONTEXT')
  check(f['目录来源']!=='本人纳管' || f['源所有者账户名']===headers['x-account'],403,'PRIVATE_DATASET_NOT_OWNED')
  check(f['允许申请权限'].includes(permission),403,'DATASET_PERMISSION_DENIED')
  const variant=f['来源系统']==='RAGFlow'?'RAGFlow外部知识库':
    f['源workspace/tenant ID']===workspaceId?'Dify同workspace授权':'Dify跨workspace复制'
  check(f['实现方式']===variant,409,'INVALID_BINDING_VARIANT')
  check(f['边界匹配结果']==='符合',403,'OUTSIDE_DATASET_BOUNDARY')
  if(variant==='RAGFlow外部知识库'){
    let endpoint
    try{endpoint=new URL(f['外部知识库API地址'])}catch{}
    check(endpoint && ['https:','http:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash,409,'INVALID_EXTERNAL_DATASET_ENDPOINT')
  }
  if(variant==='Dify跨workspace复制')check(/^[a-f0-9]{64}$/.test(f['源文档版本指纹']) &&
    text(f['文档清单快照ID']) && snapshot.preconditions.filter(p=>p.kind==='dataset_manifest' && p.id===f['文档清单快照ID']).length===1 &&
    snapshot.preconditions.some(p=>p.kind==='dataset_manifest' && p.id===f['文档清单快照ID'] && p.sha256===f['源文档版本指纹']),
    409,'MISSING_COPY_MANIFEST')
  const keys=['目录来源','来源系统','知识库名称','源知识库ID','源所有者账户名','目标Dify workspace ID','源workspace/tenant ID','policyRef','实现方式','边界匹配结果','组织边界','密级','业务线','允许申请权限','外部知识库API地址','源文档版本指纹','文档清单快照ID']
  return {snapshotId:snapshot.snapshotId,ticketType:'KB-03',action:'bind_dataset',resourceId,eligible:true,fields:Object.fromEntries(keys.filter(key=>f[key]!==undefined && (key!=='外部知识库API地址' || variant==='RAGFlow外部知识库')).map(key=>[key,f[key]])),preconditions:snapshot.preconditions}
}
export function bindingFields(snapshot,fields,account) {
  const f=snapshot.fields
  return {'目录知识库ID':snapshot.resourceId,'目录来源':f['目录来源'],'知识库名称':f['知识库名称'],'源所有者账户名':f['源所有者账户名'],
    '组织边界':f['组织边界'],'密级':f['密级'],'业务线':f['业务线'],'来源系统':f['来源系统'],'实现方式':f['实现方式'],'源知识库ID':f['源知识库ID'],
    '源workspace/tenant ID':f['源workspace/tenant ID'],'目标Dify workspace ID':f['目标Dify workspace ID'],
    '获批使用者账户名':account,'目标智能体ID':fields.targetAppId ?? null,
    '申请使用期限':{from:fields.startsAt,to:fields.expiresAt},'申请权限':fields.permission,
    '外部知识库API地址':f['外部知识库API地址'] ?? null,'源文档版本指纹':f['源文档版本指纹'] ?? null,policyRef:f.policyRef}
}
