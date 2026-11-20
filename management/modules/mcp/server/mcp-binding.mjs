import {check} from '../../../../runtime/http.mjs'
export async function mcpBindingContext(cap,headers,resourceId,workspaceId) {
  const data=await(await cap('/binding-contexts/'+encodeURIComponent(resourceId)+'?workspaceId='+encodeURIComponent(workspaceId),
    'GET',undefined,headers)).json()
  check(data.resourceId===resourceId && data.workspaceId===workspaceId &&
    /^[a-f0-9]{64}$/.test(data.expectedUrlFingerprint) &&
    ['instant','approval','denied'].includes(data.bindingAccess),409,'INVALID_MCP_BINDING_CONTEXT')
  check(data.bindingAccess!=='denied',403,'MCP_BINDING_DENIED')
  return {resourceId:data.resourceId,workspaceId:data.workspaceId,expectedUrlFingerprint:data.expectedUrlFingerprint,bindingAccess:data.bindingAccess}
}
