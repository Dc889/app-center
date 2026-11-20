import {check} from '../../../../runtime/http.mjs'
import {pluginOperationActions} from './plugin-operation.mjs'
import {pluginOperationContext} from './plugin-operation.mjs'
import {json} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routePluginOperationContext(services) {
  const {cap,demoAccounts,identity,ownerHeaders,req,res}=services;

      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      const query=new URL(req.url,'http://localhost').searchParams
      const resourceId=query.get('resourceId'),workspaceId=query.get('workspaceId'),operation=query.get('operation')
      check(resourceId && resourceId.length<=200 && workspaceId && workspaceId.length<=200 &&
        Object.hasOwn(pluginOperationActions,operation),400,'INVALID_CONTEXT')
      const context=await pluginOperationContext(cap,ownerHeaders({command:{account:identity.account,org:demoAccounts.get(identity.account),actorRole:identity.roles[0]}}),
          resourceId,workspaceId,operation,query.get('installationId') ?? '')
      return json(res,context.data)
    

}
