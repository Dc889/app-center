import {check} from '../../../../runtime/http.mjs'

export async function agentManagementContext(cap,headers,resourceId,workspaceId,action) {
  check(['republish','withdraw_app'].includes(action),400,'INVALID_AGENT_ACTION')
  const row=await(await cap('/catalog/agent/'+encodeURIComponent(resourceId)+'?action='+action,'GET',undefined,headers)).json()
  check(row.resourceId===resourceId && row.data?.workspaceId===workspaceId &&
    typeof row.data.appId==='string' && row.data.appId.trim(),409,'INVALID_CATALOG_RESOURCE')
  check(Array.isArray(row.actions) && row.actions.includes(action) &&
    (action==='republish'?['active','unavailable','withdrawn']:['active','unavailable']).includes(row.status),
    403,'AGENT_MANAGEMENT_DENIED','当前身份没有此智能体的管理操作资格')
  return row
}
