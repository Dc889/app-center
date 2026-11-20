import {body,check,json} from '../../../../runtime/http.mjs'
const levels=['公开','内部','敏感','机密']

export async function policyDecision(req,res,{token,records,resolveAccount}) {
  check(req.method==='POST' && req.headers.authorization==='Bearer '+token,403,'ACCESS_DENIED')
  const input=await body(req)
  check(input && ['policyRef','account','resourceId','action'].every(key=>typeof input[key]==='string' && input[key]) &&
    (input.workspaceId===null || typeof input.workspaceId==='string'),400,'INVALID_POLICY_REQUEST')
  return json(res,await evaluatePolicy(input,{records,resolveAccount}))
}
async function evaluatePolicy(input,{records,resolveAccount},profileSnapshot,seen=new Set()) {
  const rows=records()
  const owner=rows.find(row=>row.policy?.ref===input.policyRef)
  const policy=owner?.policy
  const decision=(allowed,reasonCode)=>({allowed,reasonCode,policyRevision:policy?.revision ?? 0})
  if(!policy)return decision(false,'POLICY_NOT_FOUND')
  if(policy.expiresAt && Date.parse(policy.expiresAt)<=Date.now())return decision(false,'POLICY_EXPIRED')
  if(seen.has(policy.ref))return decision(false,'CYCLIC_APPLICATION_POLICY')
  const visiting=new Set(seen);visiting.add(policy.ref)
  if(input.resourceId!==policy.resourceId || input.workspaceId!==policy.workspaceId)return decision(false,'POLICY_RESOURCE_MISMATCH')
  if(!policy.usages.includes(input.action) && input.action!=='grant_app_access')return decision(false,'USAGE_NOT_ALLOWED')
  check(typeof resolveAccount==='function',503,'ACCOUNT_CONTEXT_UNAVAILABLE','未接入实时账户权限目录')
  const profile=profileSnapshot ?? await resolveAccount(input.account)
  if(!profile || !profile.active || !['user','operator','admin'].includes(profile.role))return decision(false,'ACCOUNT_INACTIVE')
  check(profile.account===input.account,503,'ACCOUNT_CONTEXT_MISMATCH')
  const effects=records().filter(row=>row.execution?.status==='succeeded' &&
    row.ticketType?.split('-')[0]===owner.ticketType?.split('-')[0] &&
    (row.policySourceResourceId ?? row.snapshot?.resourceId)===policy.resourceId && (row.submission?.workspaceId || null)===policy.workspaceId)
    .sort((a,b)=>(b.effectOrder ?? 0)-(a.effectOrder ?? 0))
  let published=false
  for(const row of effects) {
    if(['isolate_mcp','withdraw_mcp'].includes(row.command.action))return decision(false,'MCP_UNAVAILABLE')
    if(row.command.action==='withdraw_app') {
      const scope=row.approvedFields.disposalScope
      if(scope.includes('仓库下架') || scope.includes('撤销访问授权') ||
        input.action==='api' && scope.includes('撤销登记密钥'))return decision(false,'PUBLICATION_WITHDRAWN')
    }
    if(row.command.action==='set_tool_approval' && (row.approvedFields['操作类型']==='撤销批准' || row.approvedFields['对外使用权限']==='禁止'))return decision(false,'TOOL_APPROVAL_REVOKED')
    if(['publish','republish','publish_dataset','set_tool_approval','register_mcp'].includes(row.command.action)) {
      if(row.approvedFields.policyRef!==policy.ref)return decision(false,'POLICY_SUPERSEDED')
      published=true
      break
    }
  }
  if(!published)return decision(false,'PUBLICATION_NOT_EFFECTIVE')
  const level=levels.indexOf(profile.clearance)
  if(level<levels.indexOf(policy.classification) || level<0)return decision(false,'CLASSIFICATION_DENIED')
  if(!profile.businessLines?.includes(policy.businessLine))return decision(false,'BUSINESS_LINE_DENIED')
  if(!policy.boundaryOrgs.includes(profile.org))return decision(false,'ORG_BOUNDARY_DENIED')
  if(policy.scope==='app'){
    if(!policy.relatedAppId || !policy.relatedWorkspaceId)return decision(false,'APPLICATION_SCOPE_INCOMPLETE')
    if(input.targetAppId!==policy.relatedAppId || input.targetWorkspaceId!==policy.relatedWorkspaceId)return decision(false,'APPLICATION_CONTEXT_MISMATCH')
    const publications=records().filter(row=>row.ticketType?.startsWith('AG-') && row.execution?.status==='succeeded' &&
      row.snapshot?.resourceId===policy.relatedAppId && row.submission?.workspaceId===policy.relatedWorkspaceId && ['publish','republish'].includes(row.command?.action))
      .sort((a,b)=>(b.effectOrder ?? 0)-(a.effectOrder ?? 0))
    const applicationPolicy=publications[0]?.approvedFields?.policyRef
    if(!applicationPolicy)return decision(false,'APPLICATION_NOT_PUBLISHED')
    // Reuse the AG policy evaluator so later withdrawal, policy replacement and account changes remain effective.
    const evaluated=await evaluatePolicy({policyRef:applicationPolicy,account:input.account,resourceId:policy.relatedAppId,workspaceId:policy.relatedWorkspaceId,action:'grant_app_access'},
      {records,resolveAccount},profile,visiting)
    return decision(evaluated.allowed,evaluated.allowed?'ALLOWED':'APPLICATION_'+evaluated.reasonCode)
  }
  const allowed=policy.scope==='all' || policy.scope==='orgs' && policy.targetOrgs.includes(profile.org) ||
    policy.scope==='accounts' && policy.targetAccounts.includes(input.account)
  return decision(allowed,allowed?'ALLOWED':'SCOPE_DENIED')
}
