import {check} from '../../../../runtime/http.mjs'
import {datasetDispositionContext} from './dataset-disposition.mjs'
import {approveDatasetDisposition} from './dataset-disposition.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveKB05(services) {
  let {accounts,applications,approvedFields,approvedPreconditions,approvedSnapshot,cap,command,fields,headersFor,input,previous}=services;

          check(previous.creationMode!=='告警转单' || previous.node==='pause' && previous.execution?.status==='succeeded',409,'PAUSE_NOT_CONFIRMED')
          const current=await datasetDispositionContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),
            previous.submission.resourceId,fields,'dispose_dataset',previous.sourceEventId)
          approvedFields=approveDatasetDisposition(previous,current,input)
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action='dispose_dataset';command.payload={decisionRef:'dec-'+command.executionId}
          approvedSnapshot=current;approvedPreconditions=current.preconditions
        
return {approvedFields,approvedPreconditions,approvedSnapshot};
}
