import {pluginOperationContext} from './plugin-operation.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'
import {pluginOperationActions} from './plugin-operation.mjs'
import {pluginOperationPayload} from './plugin-operation.mjs'
import {pluginOperationFields} from './plugin-operation.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approvePLG03(services) {
  let {accounts,applications,approvedFields,cap,command,fields,headersFor,input,previous}=services;

          const current=await pluginOperationContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),
            previous.submission.resourceId,previous.submission.workspaceId,fields.operation,fields.installationId ?? '')
          check(same(current.data,previous.snapshot.data) && same(current.preconditions,previous.preconditions),409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action=pluginOperationActions[fields.operation]
          command.payload=pluginOperationPayload(current,command.executionId)
          approvedFields=fields.operation==='安装'?command.payload:pluginOperationFields(current)
        
return {approvedFields};
}
