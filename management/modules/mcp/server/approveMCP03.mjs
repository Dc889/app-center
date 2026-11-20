import {mcpDispositionContext} from './mcp-disposition.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'
import {mcpDispositionActions} from './mcp-disposition.mjs'
import {mcpDispositionFields} from './mcp-disposition.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveMCP03(services) {
  let {accounts,applications,approvedFields,cap,command,fields,headersFor,input,previous}=services;

          const current=await mcpDispositionContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),
            previous.submission.resourceId,previous.submission.workspaceId,fields)
          check(same(current.preconditions,previous.preconditions) &&
            same(current.fields['绑定清单'],previous.snapshot.fields['绑定清单']),409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action=mcpDispositionActions[fields.operation]
          command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields=mcpDispositionFields(current,fields,previous.submission.workspaceId)
        
return {approvedFields};
}
