import {check} from '../../../../runtime/http.mjs'
import {addGrant, readAgentApprovedInput} from '../adapters/agent-store.mjs'

export async function execute(context) {
  const {command, state, clients, openLedger} = context
  const approved = await readAgentApprovedInput(clients, command)
  const fields = approved?.fields ?? {}

  const item = await (await clients.agent('/agents/' + encodeURIComponent(command.resourceId))).json()
  check(item.status === 'active', 409, 'AGENT_UNAVAILABLE', '当前智能体状态不允许新增授权')

  const principals = [
    ...(Array.isArray(fields['目标人员']) ? fields['目标人员'] : []),
    ...(Array.isArray(fields['目标组织']) ? fields['目标组织'].map(o => `org:${o}`) : []),
  ]
  if (!principals.length && command.account) principals.push(command.account)

  const grant = addGrant(openLedger, item.resourceId, principals)

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: `${item.resourceId}:grant:${grant.revision}`,
    version: String(grant.revision),
    sha256: '',
    details: {
      resourceId: item.resourceId,
      grantRevision: grant.revision,
      grantCount: grant.items.length,
      status: '已授权',
    },
  }
}
