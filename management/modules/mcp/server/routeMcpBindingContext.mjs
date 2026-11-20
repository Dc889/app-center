import {check} from '../../../../runtime/http.mjs'
import {mcpBindingContext} from './mcp-binding.mjs'
import {json} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeMcpBindingContext(services) {
  const {cap,demoAccounts,hasRole,identity,ownerHeaders,req,res}=services;

      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      const query=new URL(req.url,'http://localhost').searchParams
      const resourceId=query.get('resourceId'),workspaceId=query.get('workspaceId')
      check(resourceId && resourceId.length<=200 && workspaceId && workspaceId.length<=200,400,'INVALID_CONTEXT')
      const context=await mcpBindingContext(cap,ownerHeaders({command:{account:identity.account,org:demoAccounts.get(identity.account),actorRole:identity.roles[0]}}),resourceId,workspaceId)
      return json(res,hasRole(identity,'user')?{resourceId,workspaceId,bindingAccess:context.bindingAccess}:context)
    

}
