import {check} from '../../../../runtime/http.mjs'
import {keyContext} from './key-lifecycle.mjs'
import {same} from '../../../../runtime/http.mjs'
import {keyActions} from './key-lifecycle.mjs'
import {keyFields} from './key-lifecycle.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveKEY02(services) {
  let {accounts,applications,approvedFields,cap,command,fields,headersFor,input,previous}=services;

          check(fields.operation!=='轮换' || Date.parse(fields.newExpiresAt)>Date.now(),409,'AUTHORIZATION_EXPIRED')
          const current=await keyContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),previous.submission.resourceId,fields.operation)
          check(same(current.fields,previous.snapshot.fields) && same(current.preconditions,previous.preconditions),409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action=keyActions[fields.operation];command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields=keyFields(current,fields)
        
return {approvedFields};
}
