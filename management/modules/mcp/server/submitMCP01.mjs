import {mcpRegistration} from './mcp-registration.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitMCP01(services) {
  const {accounts,actor,applications,at,cap,headersFor,identity,input,owns,save,send,submission,types,version}=services;

      const snapshot=await mcpRegistration(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),input.resourceId)
      check(types.activeVersion(input.ticketType)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      const catalogId='mcp-'+id()
      return send(save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'MCP-01',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot,catalogId,policySourceResourceId:catalogId,status:'待受理',revision:1,
        preconditions:[{kind:'mcp',id:catalogId,revision:0},{kind:'mcp_registration',id:input.resourceId,sha256:snapshot.data.urlFingerprint}],
        history:[{at,actor,action:'提交MCP上架登记'}]}),201)
    

}
