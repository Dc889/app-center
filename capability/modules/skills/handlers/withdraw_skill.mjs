import {expectedSkillRevision, readSkillApprovedInput} from './approved-input.mjs'

export async function execute(context) {
  const {command, state, skill, clients} = context
  const approved = await readSkillApprovedInput(clients, command)
  const expectedRevision = expectedSkillRevision(approved, command.resourceId)

  const withdrawn = await (
    await skill('/skills/' + encodeURIComponent(command.resourceId) + '/withdraw', 'POST', {expectedRevision})
  ).json()

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: withdrawn.resourceId,
    version: withdrawn.version,
    sha256: withdrawn.sha256,
    details: {
      resourceId: withdrawn.resourceId,
      status: withdrawn.status,
      revision: withdrawn.revision,
      auditCopyPreserved: Boolean(withdrawn.auditCopyPreserved),
      withdrawnAt: withdrawn.withdrawnAt,
    },
  }
}
