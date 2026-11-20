import {check, json} from '../../../../runtime/http.mjs'

const SECRET_KEY = /(?:secret|token|password|api[_-]?key|authorization|credential)/i

export function redactText(value) {
  if (typeof value !== 'string') return value
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(password|secret|api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
}

export function sanitizeEvidencePayload(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value ?? null
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeEvidencePayload(item, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        out[key] = '[REDACTED]'
      } else {
        out[key] = sanitizeEvidencePayload(item, depth + 1)
      }
    }
    return out
  }
  return null
}

function parseRoles(roleHeader) {
  if (typeof roleHeader !== 'string' || !roleHeader.trim()) return []
  return roleHeader
    .split(',')
    .map(r => r.trim())
    .filter(Boolean)
}

export async function getEventEvidenceSnapshot(ctx) {
  const {identity, params, query, res, getExecution} = ctx
  check(typeof identity?.account === 'string' && identity.account.length > 0, 403, 'ACCESS_DENIED')
  const roles = parseRoles(identity.role)
  const isAdmin = roles.some(role => role === 'admin' || role === 'platform_admin')
  const isOperator = isAdmin || roles.includes('operator')

  const executionId = params?.executionId
  check(typeof executionId === 'string' && executionId.length >= 1 && executionId.length <= 160, 400, 'INVALID_REQUEST')
  const expectedResourceId = query.get('resourceId')
  check(!expectedResourceId || expectedResourceId.length <= 200, 400, 'INVALID_REQUEST')

  const record = getExecution(executionId)
  check(record, 404, 'NOT_FOUND', '未找到关联的能力执行记录')

  const command = record.command ?? {}
  if (typeof command.ticketType === 'string' && command.ticketType.startsWith('ACC-')) {
    check(isAdmin, 403, 'ACCESS_DENIED', '账号类执行证据仅管理员可查阅')
  }
  if (!isOperator) {
    check(command.account && command.account === identity.account, 403, 'ACCESS_DENIED', '无权查阅他人执行证据')
  }
  if (expectedResourceId) {
    check(command.resourceId === expectedResourceId, 409, 'RESOURCE_MISMATCH', '关联执行记录与目标资源不匹配')
  }

  const state = record.state ?? {}
  const result = state.result ?? null
  return json(res, {
    source: 'capability_execution_ledger',
    capturedAt: new Date().toISOString(),
    redacted: true,
    executionId,
    ticketNo: command.ticketNo ?? null,
    ticketType: command.ticketType ?? null,
    action: command.action ?? null,
    resourceId: command.resourceId ?? null,
    status: state.status ?? null,
    updatedAt: state.updatedAt ?? null,
    failureCode: result?.failureCode ?? null,
    message: redactText(result?.message ?? null),
    resultSummary: result
      ? sanitizeEvidencePayload({
          status: result.status ?? null,
          failureCode: result.failureCode ?? null,
          message: result.message ?? null,
          summary: result.summary ?? null,
          values: result.values ?? null,
        })
      : null,
  })
}
