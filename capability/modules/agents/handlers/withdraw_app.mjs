import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'
import {getGrantState, readAgentApprovedInput, revokeAllGrants} from '../adapters/agent-store.mjs'

export async function execute(context) {
  check(getDifyConfig().isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')
  const {command, state, clients, openLedger} = context
  const approved = await readAgentApprovedInput(clients, command)
  const fields = approved?.fields ?? {}

  const agentPre = approved?.preconditions?.find(p => p && p.kind === 'agent' && p.id === command.resourceId)
  const grantPre = approved?.preconditions?.find(p => p && p.kind === 'agent_grants' && p.id === command.resourceId)
  if (grantPre && Number.isInteger(grantPre.revision)) {
    const currentGrants = getGrantState(openLedger, command.resourceId)
    check(currentGrants.revision === grantPre.revision, 409, 'STALE_SNAPSHOT', '智能体授权台账已变化')
  }

  const replacementResourceId = fields['替代目录ID'] || fields.replacementResourceId || null
  if (replacementResourceId) {
    const replPre = approved?.preconditions?.find(p => p && p.kind === 'agent_replacement' && p.id === replacementResourceId)
    const repl = await (await clients.agent('/agents/' + encodeURIComponent(replacementResourceId))).json()
    check(repl.status === 'active', 409, 'REPLACEMENT_UNAVAILABLE')
    if (replPre && Number.isInteger(replPre.revision)) {
      check(repl.revision === replPre.revision, 409, 'STALE_SNAPSHOT', '替代目录修订已变化')
    }
  }

  const withdrawn = await (
    await clients.agent('/agents/' + encodeURIComponent(command.resourceId) + '/withdraw', 'POST', {
      expectedRevision: agentPre?.revision,
      replacementResourceId,
    })
  ).json()

  const grantRevocation = openLedger ? revokeAllGrants(openLedger, command.resourceId) : {revokedCount: 0}

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: withdrawn.resourceId,
    version: String(withdrawn.revision),
    sha256: '',
    details: {
      resourceId: withdrawn.resourceId,
      status: '已下架',
      revision: withdrawn.revision,
      revokedGrants: grantRevocation.revokedCount ?? 0,
      replacementResourceId,
      withdrawnAt: withdrawn.withdrawnAt,
    },
  }
}
