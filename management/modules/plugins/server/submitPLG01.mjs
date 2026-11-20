import {readyIntake} from '../../../platform/packages/public.server.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitPLG01(services) {
  const {accounts,actor,applications,at,cap,fields,headersFor,identity,input,owns,save,send,submission,types,version}=services;

      const intake=await readyIntake(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),'plugin',fields.intakeId)
      check(types.activeVersion(input.ticketType)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      const catalogId='plugin-'+id()
      return send(save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'PLG-01',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,catalogId,snapshot:{snapshotId:'plugin-intake-'+id(),data:intake},
        preconditions:[{kind:'plugin',id:catalogId,revision:0},{kind:'plugin_upload',id:fields.intakeId,sha256:intake.sha256}],
        status:'待受理',revision:1,history:[{at,actor,action:'提交插件上架申请'}]}),201)
    

}
