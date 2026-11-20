import {mcpDispositionContext} from './mcp-disposition.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitMCP03(services) {
  const {accounts,actor,applications,at,cap,fields,headersFor,identity,input,owns,save,send,submission,types,version}=services;

      const snapshot=await mcpDispositionContext(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),
        input.resourceId,input.workspaceId,fields)
      check(types.activeVersion(input.ticketType,input.workspaceId)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      return send(save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'MCP-03',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot,preconditions:snapshot.preconditions,status:'待受理',revision:1,
        history:[{at,actor,action:'提交MCP处置申请'}]}),201)
    

}
