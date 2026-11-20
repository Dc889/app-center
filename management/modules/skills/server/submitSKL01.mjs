import {readyIntake} from '../../../platform/packages/public.server.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitSKL01(services) {
  const {accounts,actor,applications,at,cap,fields,headersFor,identity,input,owns,save,send,submission,types,version}=services;

      const intake=await readyIntake(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),'skill',fields.intakeId)
      check(types.activeVersion(input.ticketType)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      return send(save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'SKL-01',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot:{snapshotId:'skill-intake-'+id(),resourceId:input.resourceId,data:intake},
        preconditions:[{kind:'skill',id:input.resourceId,revision:0},{kind:'skill_upload',id:fields.intakeId,sha256:intake.sha256}],
        status:'待受理',revision:1,history:[{at,actor,action:'提交Skill上架申请'}]}),201)
    

}
