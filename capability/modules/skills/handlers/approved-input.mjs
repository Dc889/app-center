import {check} from '../../../../runtime/http.mjs'

export async function readSkillApprovedInput(clients, command) {
  check(clients?.management, 503, 'REPOSITORY_UNCONFIGURED', '未配置管理端获准输入地址')
  const response = await clients.management('/approved-inputs/' + encodeURIComponent(command.executionId))
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

export function expectedSkillRevision(approved, resourceId) {
  const match = approved.preconditions.find(p => p && p.kind === 'skill' && p.id === resourceId)
  check(match && Number.isInteger(match.revision) && match.revision >= 0, 409, 'STALE_SNAPSHOT', '缺少 Skill 目录修订前置条件')
  return match.revision
}
