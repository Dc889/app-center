import {check} from '../../../../runtime/http.mjs'
import {bindingContext} from './dataset-binding.mjs'
import {applicationTarget} from '../../agents/public.server.mjs'
import {same} from '../../../../runtime/http.mjs'
import {targetPreconditions} from '../../agents/public.server.mjs'
import {bindingFields} from './dataset-binding.mjs'
import {targetFields} from '../../agents/public.server.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveKB03(services) {
  let {accounts,applications,approvedFields,cap,command,fields,headersFor,input,previous}=services;

          check(Date.parse(fields.expiresAt)>Date.now(),409,'AUTHORIZATION_EXPIRED')
          const current=await bindingContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),
            previous.submission.resourceId,previous.submission.workspaceId,fields.permission,fields.targetAppId)
          const target=await applicationTarget(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),'dataset_binding',previous.submission.workspaceId,fields.targetAppId)
          check(same(target,previous.targetApplication ?? null),409,'STALE_APPLICATION_TARGET')
          check(same(current.fields,previous.snapshot.fields) && same(targetPreconditions(current.preconditions,target),previous.preconditions),
            409,'STALE_SNAPSHOT','知识库绑定依据已变化，请重新申请')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action='bind_dataset'
          command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields={...bindingFields(current,fields,previous.account),...targetFields(target)}
        
return {approvedFields};
}
