

// Injected services retain the owning transaction and identity snapshot.
export async function approveAG03(services) {
  let {approvedFields,command,data,fields,previous}=services;

          command.action='grant_app_access'
          command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields={workspaceId:previous.submission.workspaceId,account:previous.account,
            startsAt:fields.startsAt,expiresAt:fields.expiresAt,usages:fields.usages,
            policyRef:previous.originalCatalog.data.policyRef,expectedRevision:data.catalogRevision}
        
return {approvedFields};
}
