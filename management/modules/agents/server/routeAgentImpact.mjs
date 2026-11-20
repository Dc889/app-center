import {check} from '../../../../runtime/http.mjs'
import {json} from '../../../../runtime/http.mjs'
import {agentImpactContext} from './agent-impact.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeAgentImpact(services) {
  const {cap,identity,ownerHeaders,req,res}=services;

      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      const query=new URL(req.url,'http://localhost').searchParams,resourceId=query.get('resourceId'),workspaceId=query.get('workspaceId')
      check(resourceId?.trim() && resourceId.length<=200 && workspaceId?.trim() && workspaceId.length<=200,400,'INVALID_AGENT_IMPACT_QUERY')
      return json(res,await agentImpactContext(cap,ownerHeaders({command:{account:identity.account,org:identity.org,actorRole:identity.roles[0]}}),resourceId,workspaceId,query.get('action')))
    

}
