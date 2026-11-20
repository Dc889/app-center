import {check} from '../../../../runtime/http.mjs'
import {datasetDispositionContext} from './dataset-disposition.mjs'
import {same} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitKB05(services) {
  const {accounts,actor,applications,at,cap,evidence,fields,headersFor,identity,input,owns,save,send,submission,types,version}=services;

      const evidenceRefs=evidence.references(fields.evidenceIds ?? [],actor)
      check(!['内容违规','权限越界'].includes(fields.reason) || evidenceRefs.length,400,'EVIDENCE_REQUIRED')
      const snapshot=await datasetDispositionContext(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),input.resourceId,fields)
      check(types.activeVersion(input.ticketType)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      return send(save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'KB-05',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),creationMode:'人工申请',submission,snapshot,preconditions:snapshot.preconditions,
        evidenceRefs,status:'待受理',revision:1,history:[{at,actor,action:'提交知识库处置申请'}]}),201)
    

}
