import {check} from '../../../../runtime/http.mjs'
import {replacementContext} from './agent-replacements.mjs'
import {verifyReplacementSource} from './agent-replacements.mjs'
import {same} from '../../../../runtime/http.mjs'
import {agentManagementContext} from './agent-management.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveAG05(services) {
  let {accounts,applications,approvedFields,cap,command,currentAgentImpact,data,fields,headersFor,input,previous}=services;

          check(Array.isArray(input.disposalScope) && input.disposalScope.length>0 &&
            input.disposalScope.every(s=>['仓库下架','撤销访问授权','撤销登记密钥'].includes(s)),400,'INVALID_DISPOSAL_SCOPE')
          const replacement=await replacementContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),previous.submission.resourceId,fields.replacementAppId)
          verifyReplacementSource(replacement,previous.originalCatalog)
          check(same(replacement,previous.replacementApplication ?? null),409,'STALE_REPLACEMENT')
          if(replacement){
            const latest=await agentManagementContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),previous.submission.resourceId,previous.submission.workspaceId,'withdraw_app')
            check(['appId','workspaceId','publicationVersionId','workflowSnapshotId','policyRef'].every(key=>same(latest.data[key],previous.originalCatalog.data[key])),409,'STALE_SNAPSHOT')
          }
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action='withdraw_app'
          command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields={workspaceId:previous.submission.workspaceId,appId:previous.snapshot.resourceId,
            snapshotId:previous.snapshot.snapshotId,expectedRevision:data.catalogRevision,
              effectiveAt:fields.effectiveAt,disposalScope:[...new Set(input.disposalScope)],replacementAppId:replacement?.resourceId ?? null,replacementApplication:replacement,'影响依据':currentAgentImpact}
        
return {approvedFields};
}
