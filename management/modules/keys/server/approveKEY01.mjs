import {check} from '../../../../runtime/http.mjs'
import {keyCreationContext} from './key-creation.mjs'
import {same} from '../../../../runtime/http.mjs'
import {keyCreationFields} from './key-creation.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveKEY01(services) {
  let {accounts,applications,approvedFields,cap,command,fields,headersFor,input,previous}=services;

          check(Date.parse(fields.expiresAt)>Date.now(),409,'AUTHORIZATION_EXPIRED')
          const current=await keyCreationContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),
            previous.submission.resourceId,previous.submission.workspaceId)
          check(same(current.fields,previous.snapshot.fields) && same(current.preconditions,previous.preconditions),409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action='create_key';command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields=keyCreationFields(fields)
        
return {approvedFields};
}
