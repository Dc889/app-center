import {mcpBindingContext} from './mcp-binding.mjs'
import {applicationTarget} from '../../agents/public.server.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'
import {targetFields} from '../../agents/public.server.mjs'
import {targetPreconditions} from '../../agents/public.server.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitMCP02(services) {
  const {accounts,actor,applications,at,cap,deliver,fields,headersFor,identity,input,owns,save,send,submission,types,version,visibleApplication}=services;

      const context=await mcpBindingContext(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),input.resourceId,input.workspaceId)
      const target=await applicationTarget(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),'mcp_binding',input.workspaceId,fields.targetAppId)
      check(types.activeVersion(input.ticketType,input.workspaceId)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(visibleApplication(concurrent,identity))
      }
      const instant=context.bindingAccess==='instant'
      const executionId=id()
      const payload={workspaceId:input.workspaceId,startsAt:fields.startsAt,expiresAt:fields.expiresAt,
        expectedUrlFingerprint:context.expectedUrlFingerprint,...target?{targetAppId:target.appId,decisionRef:'dec-'+executionId}:{}}
      const command=instant?{executionId,ticketNo:input.ticketNo,ticketType:'MCP-02',ticketTypeVersion:version,
        action:'bind',resourceId:input.resourceId,account:actor,org:accounts.get(actor),payload}:undefined
      const approvedFields=instant?{...payload,'目标智能体ID':fields.targetAppId || null,...targetFields(target)}:undefined
      const row=save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'MCP-02',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot:{snapshotId:'mcp-context-'+id(),data:context},
        targetApplication:target,preconditions:targetPreconditions([{kind:'mcp',id:input.resourceId,sha256:context.expectedUrlFingerprint}],target),
        status:instant?'执行中':'待受理',revision:1,command,approvedFields,attempts:command?[{command,approvedFields}]:[],
        history:[{at,actor,action:'提交MCP使用绑定'}]})
      if(instant)void deliver(row)
      return send(visibleApplication(row,identity),201)
    

}
