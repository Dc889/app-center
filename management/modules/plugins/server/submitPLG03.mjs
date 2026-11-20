import {pluginOperationActions} from './plugin-operation.mjs'
import {pluginOperationContext} from './plugin-operation.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'
import {pluginOperationPayload} from './plugin-operation.mjs'
import {pluginOperationFields} from './plugin-operation.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitPLG03(services) {
  const {accounts,actor,applications,at,cap,deliver,fields,headersFor,identity,input,owns,save,send,submission,text,types,version}=services;

      const mode=fields.operation==='安装'?'instant':types.branchMode('PLG-03',version,pluginOperationActions[fields.operation],input.workspaceId)
      const snapshot=await pluginOperationContext(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),
        input.resourceId,input.workspaceId,fields.operation,fields.installationId ?? '')
      if(mode==='approval' || snapshot.data.access==='approval')check(text(fields.purpose),400,'PURPOSE_REQUIRED')
      check(types.activeVersion(input.ticketType,input.workspaceId)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      const instant=mode==='instant' && snapshot.data.access==='instant'
      const executionId=id()
      const payload=pluginOperationPayload(snapshot,executionId)
      const command=instant?{executionId,ticketNo:input.ticketNo,ticketType:'PLG-03',ticketTypeVersion:version,
        action:pluginOperationActions[fields.operation],resourceId:input.resourceId,account:actor,org:accounts.get(actor),payload}:undefined
      const approvedFields=instant?(fields.operation==='安装'?payload:pluginOperationFields(snapshot)):undefined
      const row=save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'PLG-03',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot,branchMode:mode,preconditions:snapshot.preconditions,status:instant?'执行中':'待受理',
        revision:1,command,approvedFields,attempts:command?[{command,approvedFields}]:[],history:[{at,actor,action:'提交插件'+fields.operation}]})
      if(instant)void deliver(row)
      return send(row,201)
    

}
