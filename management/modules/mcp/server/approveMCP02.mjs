import {check} from '../../../../runtime/http.mjs'
import {mcpBindingContext} from './mcp-binding.mjs'
import {applicationTarget} from '../../agents/public.server.mjs'
import {same} from '../../../../runtime/http.mjs'
import {targetFields} from '../../agents/public.server.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveMCP02(services) {
  let {accounts,applications,approvedFields,cap,command,fields,headersFor,input,previous}=services;

          check(Date.parse(fields.expiresAt)>Date.now(),409,'AUTHORIZATION_EXPIRED')
          const current=await mcpBindingContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),
            previous.submission.resourceId,previous.submission.workspaceId)
          const target=await applicationTarget(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),'mcp_binding',previous.submission.workspaceId,fields.targetAppId)
          check(same(target,previous.targetApplication ?? null),409,'STALE_APPLICATION_TARGET')
          check(current.expectedUrlFingerprint===previous.snapshot.data.expectedUrlFingerprint,409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action='bind'
          command.payload={workspaceId:previous.submission.workspaceId,startsAt:fields.startsAt,expiresAt:fields.expiresAt,
            expectedUrlFingerprint:current.expectedUrlFingerprint,...target?{targetAppId:target.appId,decisionRef:'dec-'+command.executionId}:{}}
          approvedFields={...command.payload,'目标智能体ID':fields.targetAppId || null,...targetFields(target)}
        
return {approvedFields};
}
