import {check} from '../../../../runtime/http.mjs'
export const mcpDispositionActions={'单用户解绑':'unbind_mcp','目录隔离':'isolate_mcp','目录下架':'withdraw_mcp'}
export async function mcpDispositionContext(cap,headers,resourceId,workspaceId,fields,{discovery=false}={}) {
  check(Object.hasOwn(mcpDispositionActions,fields.operation),400,'INVALID_MCP_DISPOSITION')
  const action=mcpDispositionActions[fields.operation]
  check(action,400,'INVALID_MCP_DISPOSITION')
  const allowedStatuses=action==='unbind_mcp'?['active','isolated','withdrawn']:action==='isolate_mcp'?['active']:['active','isolated']
  async function eligible() {
    const entry=await(await cap('/catalog/mcp/'+encodeURIComponent(resourceId)+'?action='+action,'GET',undefined,headers)).json()
    check(entry.resourceId===resourceId && allowedStatuses.includes(entry.status) && Array.isArray(entry.actions) && entry.actions.includes(action),
      403,'MCP_DISPOSITION_DENIED','当前身份没有此MCP处置动作的申请资格')
  }
  await eligible()
  const query=new URLSearchParams({action,resourceId})
  if(!discovery && fields.operation==='单用户解绑') {
    check(typeof workspaceId==='string' && workspaceId.trim() && typeof fields.targetAccount==='string' && fields.targetAccount.trim(),400,'BINDING_TARGET_REQUIRED')
    query.set('workspaceId',workspaceId);query.set('targetAccount',fields.targetAccount)
  }
  const snapshot=await(await cap('/execution-contexts/MCP-03?'+query,'GET',undefined,headers)).json()
  const data=snapshot.fields
  check(snapshot.ticketType==='MCP-03' && snapshot.action===action && snapshot.resourceId===resourceId &&
    typeof snapshot.snapshotId==='string' && snapshot.snapshotId && data &&
    typeof data['绑定清单快照ID']==='string' && data['绑定清单快照ID'].trim() && Array.isArray(data['绑定清单']) &&
    Array.isArray(snapshot.preconditions) && snapshot.preconditions.filter(p=>p && p.kind==='mcp' && p.id===resourceId).length===1 &&
    snapshot.preconditions.some(p=>p && p.kind==='mcp' && p.id===resourceId && Number.isInteger(p.revision) && p.revision>=0),
    409,'INCOMPLETE_MCP_DISPOSITION_CONTEXT')
  const rows=data['绑定清单']
  check(rows.every(b=>b && typeof b.account==='string' && b.account.trim() && typeof b.workspaceId==='string' && b.workspaceId.trim() &&
    typeof b.providerId==='string' && b.providerId.trim()),409,'INCOMPLETE_MCP_BINDINGS')
  check(snapshot.preconditions.every(p=>p && typeof p.kind==='string' && p.kind && typeof p.id==='string' && p.id &&
    Object.keys(p).every(key=>['kind','id','revision','version','sha256'].includes(key)) &&
    (p.revision===undefined || Number.isInteger(p.revision) && p.revision>=0) &&
    (p.version===undefined || typeof p.version==='string') && (p.sha256===undefined || /^[a-f0-9]{64}$/.test(p.sha256))),409,'INCOMPLETE_MCP_DISPOSITION_CONTEXT')
  check(new Set(rows.map(b=>JSON.stringify([b.account,b.workspaceId,b.providerId]))).size===rows.length,409,'AMBIGUOUS_MCP_BINDINGS')
  if(fields.operation==='单用户解绑') {
    if(!discovery) {
      check(rows.some(b=>b.account===fields.targetAccount && b.workspaceId===workspaceId),403,'BINDING_NOT_IN_SCOPE')
      check(data['绑定清单完整']===true,409,'INCOMPLETE_MCP_BINDINGS')
    }
  }else check(data['绑定清单完整']===true,409,'INCOMPLETE_MCP_BINDINGS')
  await eligible()
  const scoped=!discovery && fields.operation==='单用户解绑'?rows.filter(b=>b.account===fields.targetAccount && b.workspaceId===workspaceId):rows
  return {snapshotId:snapshot.snapshotId,ticketType:'MCP-03',action,resourceId,capturedAt:snapshot.capturedAt,
    fields:{'绑定清单快照ID':data['绑定清单快照ID'],'绑定清单完整':data['绑定清单完整']===true,
      '绑定清单':scoped.map(({account,workspaceId,providerId})=>({account,workspaceId,providerId}))},preconditions:snapshot.preconditions}
}
export function mcpDispositionFields(snapshot,fields,workspaceId) {
  const bindings=fields.operation==='单用户解绑'?snapshot.fields['绑定清单'].filter(b=>b.account===fields.targetAccount && b.workspaceId===workspaceId):snapshot.fields['绑定清单']
  return {'处置类型':fields.operation,'目标账户名':fields.operation==='单用户解绑'?fields.targetAccount:null,
    '目标workspace ID':workspaceId || null,'处置原因':fields.reason,'绑定清单快照ID':snapshot.fields['绑定清单快照ID'],
    '绑定清单':bindings}
}
