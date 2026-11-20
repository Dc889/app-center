import {id} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveAG02(services) {
  let {approvedFields,command,fields,policy,previous}=services;

          policy={ref:'policy-'+id(),revision:1,resourceId:command.resourceId,
            workspaceId:previous.submission.workspaceId,scope:fields.scope,
            targetOrgs:command.payload.targetOrgs,targetAccounts:command.payload.targetAccounts,
            boundaryOrgs:fields.boundaryOrgs,usages:fields.usages,
            classification:fields.classification,businessLine:fields.businessLine}
          approvedFields={...approvedFields,policyRef:policy.ref}
        
return {approvedFields,policy};
}
