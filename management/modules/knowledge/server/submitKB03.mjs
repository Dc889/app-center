import {bindingContext} from './dataset-binding.mjs'
import {applicationTarget} from '../../agents/public.server.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'
import {bindingFields} from './dataset-binding.mjs'
import {targetFields} from '../../agents/public.server.mjs'
import {targetPreconditions} from '../../agents/public.server.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitKB03(services) {
  const {accounts,actor,applications,at,cap,deliver,fields,headersFor,identity,input,owns,save,send,submission,types,version,visibleApplication}=services;

      const snapshot=await bindingContext(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),input.resourceId,input.workspaceId,fields.permission,fields.targetAppId)
      const target=await applicationTarget(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),'dataset_binding',input.workspaceId,fields.targetAppId)
      check(types.activeVersion(input.ticketType,input.workspaceId)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(visibleApplication(concurrent,identity))
      }
      const own=snapshot.fields['源所有者账户名']===actor
      const executionId=id()
      const approvedFields=own?{...bindingFields(snapshot,fields,actor),...targetFields(target)}:undefined
      const command=own?{executionId,ticketNo:input.ticketNo,ticketType:'KB-03',ticketTypeVersion:version,
        action:'bind_dataset',resourceId:input.resourceId,account:actor,org:accounts.get(actor),payload:{decisionRef:'dec-'+executionId}}:undefined
      const row=save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'KB-03',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot,targetApplication:target,preconditions:targetPreconditions(snapshot.preconditions,target),
        status:own?'执行中':'待受理',revision:1,command,approvedFields,attempts:command?[{command,approvedFields}]:[],
        history:[{at,actor,action:'提交知识库使用绑定'}]})
      if(own)void deliver(row)
      return send(visibleApplication(row,identity),201)
    

}
