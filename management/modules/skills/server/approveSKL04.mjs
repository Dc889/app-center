import {skillWithdrawalContext} from './skill-withdrawal.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveSKL04(services) {
  let {accounts,applications,approvedFields,cap,command,fields,headersFor,input,previous}=services;

          const current=await skillWithdrawalContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),previous.submission.resourceId)
          check(same(current.preconditions,previous.preconditions) && current.fields['当前版本号']===previous.snapshot.fields['当前版本号'],409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action='withdraw_skill';command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields={'生效时间':fields.effectiveAt,'文件处置':'保留审计副本并禁止下载'}
        
return {approvedFields};
}
