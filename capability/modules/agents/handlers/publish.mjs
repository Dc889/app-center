export async function execute(context) {
  const {command, state, clients} = context
  const p = command.payload

  const published = await (
    await clients.agent('/agents', 'POST', {
      resourceId: command.resourceId,
      appId: p.appId || command.resourceId,
      name: p.name || command.resourceId,
      workspaceId: p.workspaceId,
      publicationVersionId: p.publicationVersionId,
      workflowSnapshotId: p.snapshotId,
      scope: p.scope,
      expectedRevision: p.expectedRevision,
      targetOrgs: p.targetOrgs,
      targetAccounts: p.targetAccounts,
      boundaryOrgs: p.boundaryOrgs,
      usages: p.usages,
      ownerAccount: command.account,
    })
  ).json()

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: published.resourceId,
    version: published.publicationVersionId,
    sha256: '',
    details: {
      resourceId: published.resourceId,
      publicationVersionId: published.publicationVersionId,
      policyRef: published.policyRef,
      revision: published.revision,
      scope: published.scope,
      status: '已发布',
    },
  }
}
