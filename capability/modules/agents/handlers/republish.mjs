import {check} from '../../../../runtime/http.mjs'
import {readAgentApprovedInput} from '../adapters/agent-store.mjs'

export async function execute(context) {
  const {command, state, clients} = context
  const approved = await readAgentApprovedInput(clients, command)
  const fields = approved?.fields ?? {}
  const agentPre = approved?.preconditions?.find(p => p && p.kind === 'agent' && p.id === command.resourceId)
  const expectedRevision = agentPre?.revision
  const publicationVersionId = fields.newPublicationVersionId || fields.publicationVersionId || fields['新发布版本ID']
  const workflowSnapshotId = fields.newWorkflowSnapshotId || fields.workflowSnapshotId || fields['新工作流快照ID']
  check(typeof publicationVersionId === 'string' && publicationVersionId.trim(), 409, 'MISSING_APPROVED_VERSION', '获准输入缺少真实新发布版本')
  check(typeof workflowSnapshotId === 'string' && workflowSnapshotId.trim(), 409, 'MISSING_APPROVED_SNAPSHOT', '获准输入缺少真实新工作流快照')


  const updated = await (
    await clients.agent('/agents/' + encodeURIComponent(command.resourceId), 'PUT', {
      expectedRevision,
      publicationVersionId,
      workflowSnapshotId,
      policyRef: fields.policyRef,
    })
  ).json()

  check(updated.status === 'active', 409, 'AGENT_REPUBLISH_FAILED')
  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: updated.resourceId,
    version: updated.publicationVersionId,
    sha256: '',
    details: {
      resourceId: updated.resourceId,
      publicationVersionId: updated.publicationVersionId,
      revision: updated.revision,
      status: '已再发布',
    },
  }
}
