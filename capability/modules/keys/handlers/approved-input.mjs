import {check} from '../../../../runtime/http.mjs'

export async function readApprovedInput(clients, command) {
  if (!clients?.management) return null
  let response
  try {
    response = await clients.management('/approved-inputs/' + encodeURIComponent(command.executionId))
  } catch (err) {
    if (err.code === 'REPOSITORY_UNCONFIGURED') return null
    throw err
  }
  const approved = await response.json()
  check(
    approved &&
      approved.decisionRef === command.payload?.decisionRef &&
      approved.ticketType === command.ticketType &&
      approved.action === command.action &&
      approved.resourceId === command.resourceId,
    409,
    'APPROVED_INPUT_MISMATCH',
    '获准输入与执行命令不一致',
  )
  return {
    fields: approved.fields ?? {},
    preconditions: Array.isArray(approved.preconditions) ? approved.preconditions : [],
  }
}

export function expectedRegistrationRevision(approved, registrationId) {
  if (!approved) return null
  const match = approved.preconditions.find(p => p && p.kind === 'key_registration' && p.id === registrationId)
  check(match && Number.isInteger(match.revision) && match.revision >= 0, 409, 'STALE_SNAPSHOT', '缺少密钥登记修订前置条件')
  return match.revision
}
