import {readyIntake} from '../../../platform/packages/public.server.mjs'
import {check} from '../../../../runtime/http.mjs'
import {skillPublicationFields} from '../../../platform/packages/public.server.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveSKL01(services) {
  let {accounts,applications,approvedFields,cap,command,fields,headersFor,input,previous}=services;

          const current=await readyIntake(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),'skill',fields.intakeId)
          check(current.sha256===previous.snapshot.data.sha256 && current.sizeBytes===previous.snapshot.data.sizeBytes,409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action='publish_skill';command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields=skillPublicationFields(fields,current,previous.account)
        
return {approvedFields};
}
