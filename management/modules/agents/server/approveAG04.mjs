

// Injected services retain the owning transaction and identity snapshot.
export async function approveAG04(services) {
  let {approvedFields,command,currentAgentImpact,data,fields,input,previous,warnings}=services;

          command.action='republish'
          command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields={workspaceId:previous.submission.workspaceId,appId:previous.snapshot.resourceId,
            snapshotId:previous.snapshot.snapshotId,expectedRevision:data.catalogRevision,
            oldPublicationVersionId:previous.originalCatalog.data.publicationVersionId,
            newPublicationVersionId:data.publicationVersionId,
            oldWorkflowSnapshotId:previous.originalCatalog.data.workflowSnapshotId,
            newWorkflowSnapshotId:data.workflowSnapshotId,changeDescription:fields.changeDescription,
              switchMode:'full',policyRef:previous.originalCatalog.data.policyRef,warningDecision:input.warningDecision ?? null,warningNote:warnings.length?input.note.trim():null,'影响依据':currentAgentImpact}
        
return {approvedFields};
}
