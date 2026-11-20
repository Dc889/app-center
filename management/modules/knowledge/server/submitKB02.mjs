import {datasetContext} from './dataset-review.mjs'
import {check} from '../../../../runtime/http.mjs'
import {applicationTarget} from '../../agents/public.server.mjs'
import {same} from '../../../../runtime/http.mjs'
import {targetPreconditions} from '../../agents/public.server.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitKB02(services) {
  const {accounts,actor,applications,at,cap,fields,headersFor,identity,input,owns,save,send,submission,types,version,visibleApplication}=services;

      const snapshot=await datasetContext(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),input.resourceId,input.workspaceId)
      check(snapshot.fields['来源系统']===fields.sourceSystem && snapshot.fields['所有者账户名']===actor &&
        snapshot.fields['workspace/tenant ID']===input.workspaceId,403,'DATASET_CONTEXT_MISMATCH')
      const related=fields.shareMode==='随应用发布'?await applicationTarget(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),'dataset_publication',fields.relatedWorkspaceId,fields.relatedAppId):null
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(visibleApplication(concurrent,identity))
      }
      check(types.activeVersion(input.ticketType,input.workspaceId)===version,409,'TYPE_VERSION_CHANGED')
      return send(save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'KB-02',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot,targetApplication:related,preconditions:targetPreconditions(snapshot.preconditions,related),status:'待受理',revision:1,
        history:[{at,actor,action:'提交知识库分享申请'}]}),201)
    

}
