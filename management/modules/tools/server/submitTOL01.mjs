import {toolContext} from './tool-approval.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitTOL01(services) {
  const {accounts,actor,applications,at,cap,fields,headersFor,identity,input,owns,save,send,submission,types,version}=services;

      const snapshot=await toolContext(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),input.resourceId,input.workspaceId,fields.operation)
      check(types.activeVersion(input.ticketType,input.workspaceId)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      return send(save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'TOL-01',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot,preconditions:snapshot.preconditions,status:'待受理',revision:1,
        history:[{at,actor,action:'提交工具批准申请'}]}),201)
    

}
