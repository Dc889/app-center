import {check} from '../../../runtime/http.mjs'
import {toolOperations} from '../../modules/tools/public.server.mjs'
import {pluginOperationActions} from '../../modules/plugins/public.server.mjs'
import {executionCandidateHandlers} from './module-registry.mjs'

export async function executionCandidates(cap,headers,input) {
  const ticketType=input.get('ticketType')
  const customHandler=executionCandidateHandlers[ticketType]
  if(customHandler)return customHandler(cap,headers,input)
  const plugin=ticketType==='PLG-03'
  const operation=input.get('operation'),workspaceId=input.get('workspaceId') ?? ''
  check(plugin?Object.hasOwn(pluginOperationActions,operation) && input.get('action')===pluginOperationActions[operation]:ticketType==='TOL-01' && input.get('action')==='set_tool_approval' && toolOperations.includes(operation),400,'INVALID_CANDIDATE_QUERY')
  check((plugin?operation==='卸载':operation==='撤销批准') || workspaceId.trim(),400,'WORKSPACE_REQUIRED')
  const query=new URLSearchParams({action:input.get('action'),operation})
  for(const key of ['workspaceId','q','cursor','limit']) {
    const value=input.get(key)
    if(value){check(value.length<=200 && (key!=='limit' || /^\d{1,3}$/.test(value) && Number(value)>=1 && Number(value)<=100),400,'INVALID_QUERY');query.set(key,value)}
  }
  const data=await(await cap('/execution-contexts/'+ticketType+'/candidates?'+query,'GET',undefined,headers)).json()
  check(data && Array.isArray(data.items) && (data.nextCursor===null || typeof data.nextCursor==='string' && data.nextCursor.length>0 && data.nextCursor.length<=200),503,'INVALID_CANDIDATE_PAGE')
  check(data.items.every(row=>row && ['resourceId','name','source','workspaceId'].every(key=>typeof row[key]==='string' && row[key].trim() && row[key].length<=200) &&
    (!workspaceId || row.workspaceId===workspaceId) && (!plugin || (operation==='安装'?row.installationId===null:typeof row.installationId==='string' && row.installationId.trim() && row.installationId.length<=200))) &&
    new Set(data.items.map(row=>plugin?JSON.stringify([row.resourceId,row.workspaceId,row.installationId]):row.resourceId)).size===data.items.length,503,'INVALID_CANDIDATE_PAGE')
  return {items:data.items.map(({resourceId,name,source,workspaceId,installationId})=>({resourceId,name,source,workspaceId,...plugin?{installationId}:{}})),nextCursor:data.nextCursor}
}
