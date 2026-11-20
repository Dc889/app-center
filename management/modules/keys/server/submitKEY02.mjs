import {keyContext} from './key-lifecycle.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitKEY02(services) {
  const {accounts,actor,applications,at,cap,fields,headersFor,identity,input,owns,save,send,submission,types,version}=services;

      const snapshot=await keyContext(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),input.resourceId,fields.operation)
      check(types.activeVersion(input.ticketType)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      return send(save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'KEY-02',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot,preconditions:snapshot.preconditions,status:'待受理',revision:1,
        history:[{at,actor,action:'提交密钥生命周期申请'}]}),201)
    

}
