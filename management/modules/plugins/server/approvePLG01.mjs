import {check} from '../../../../runtime/http.mjs'
import {readyIntake} from '../../../platform/packages/public.server.mjs'
import {same} from '../../../../runtime/http.mjs'
import {pluginPublicationFields} from '../../../platform/packages/public.server.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approvePLG01(services) {
  let {accounts,applications,approvedFields,cap,command,fields,headersFor,input,previous}=services;

          check(['允许','禁止'].includes(input.externalAllowed),400,'EXTERNAL_PERMISSION_REQUIRED')
          const current=await readyIntake(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),'plugin',fields.intakeId)
          check(same(current.packageMetadata,previous.snapshot.data.packageMetadata) &&
            current.sha256===previous.snapshot.data.sha256 && current.sizeBytes===previous.snapshot.data.sizeBytes,
            409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action='publish_package';command.resourceId=previous.catalogId
          command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields=pluginPublicationFields(fields,current,previous.account,input.externalAllowed)
        
return {approvedFields};
}
