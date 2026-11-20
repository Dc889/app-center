import {check, json, body} from '../../../../runtime/http.mjs'

const ALLOWED_VIEWS = new Set(['audit', 'monitor', 'integration'])
const CALL_CATEGORIES = new Set(['agent', 'retrieval', 'mcp'])
const EXCEPTION_CATEGORIES = new Set(['agent', 'dataset_build', 'plugin', 'mcp'])
const SECRET_PATTERN = /(?:Bearer\s+[A-Za-z0-9._~+/-]+|\b(?:password|secret|api[_-]?key|token)\s*[:=]\s*[^\s,;]+)/gi

function parseRoles(roleHeader) {
  if (typeof roleHeader !== 'string' || !roleHeader.trim()) return []
  return roleHeader
    .split(',')
    .map(r => r.trim())
    .filter(Boolean)
}

export function requireOperatorOrAdmin(identity) {
  const roles = parseRoles(identity?.role)
  const isAdmin = roles.includes('admin') || roles.includes('platform_admin')
  const isOperator = isAdmin || roles.includes('operator')
  check(isOperator, 403, 'ACCESS_DENIED', '仅运维或管理员可访问观测接口')
  return {isAdmin, isOperator}
}

function redactSummary(text) {
  if (typeof text !== 'string') return ''
  return text.replace(SECRET_PATTERN, '[REDACTED]').slice(0, 1000)
}

function isUtc(value) {
  return typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value))
}

export async function listObservations(ctx) {
  const {query, identity, res, openLedger} = ctx
  const {isAdmin} = requireOperatorOrAdmin(identity)

  const view = query.get('view') ?? 'monitor'
  check(ALLOWED_VIEWS.has(view), 400, 'INVALID_VIEW')
  const sourceFilter = query.get('source') || ''
  const cursorRaw = query.get('cursor') || ''
  const limitRaw = query.get('limit') ?? '50'
  check(/^\d{1,3}$/.test(limitRaw), 400, 'INVALID_LIMIT')
  const limit = Number(limitRaw)
  check(limit >= 1 && limit <= 100, 400, 'INVALID_LIMIT')
  const offset = cursorRaw ? Number(cursorRaw) : 0
  check(Number.isSafeInteger(offset) && offset >= 0, 400, 'INVALID_CURSOR')

  const ledger = openLedger('events')
  const all = ledger
    .all()
    .filter(row => {
      if (row.view !== view) return false
      if (sourceFilter && row.source !== sourceFilter) return false
      if (!isAdmin && row.ticketType?.startsWith('ACC-')) return false
      return true
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.dedupKey.localeCompare(b.dedupKey))

  const slice = all.slice(offset, offset + limit).map(({dedupKey: _key, ...item}) => item)
  const nextCursor = offset + limit < all.length ? String(offset + limit) : null

  return json(res, {
    view,
    items: slice,
    total: all.length,
    nextCursor,
  })
}

export async function ingestObservation(ctx) {
  const {req, res, openLedger} = ctx
  const input = await body(req)
  check(input && typeof input === 'object' && !Array.isArray(input), 400, 'INVALID_REQUEST')

  if (input.collectorRegistration) {
    const reg = input.collectorRegistration
    check(
      ['calls', 'exceptions'].includes(reg.group) &&
        typeof reg.source === 'string' &&
        reg.source.trim() &&
        reg.source.length <= 200 &&
        Array.isArray(reg.streams) &&
        isUtc(reg.capturedAt),
      400,
      'INVALID_COLLECTOR_REGISTRATION',
    )
    const collectors = openLedger('collectors')
    collectors.put(reg.group, {
      group: reg.group,
      source: reg.source.trim(),
      streams: [...new Set(reg.streams)],
      capturedAt: reg.capturedAt,
    })
    return json(res, {registered: true, group: reg.group}, 201)
  }

  const events = Array.isArray(input.events) ? input.events : [input]
  check(events.length >= 1 && events.length <= 200, 400, 'INVALID_OBSERVATION_BATCH')

  const ledger = openLedger('events')
  let inserted = 0
  let deduplicated = 0

  for (const ev of events) {
    check(
      ev &&
        typeof ev.source === 'string' &&
        ev.source.trim() &&
        ev.source.length <= 200 &&
        typeof ev.eventId === 'string' &&
        ev.eventId.trim() &&
        ev.eventId.length <= 200 &&
        isUtc(ev.at) &&
        ['call', 'exception', 'audit', 'integration'].includes(ev.kind),
      400,
      'INVALID_OBSERVATION_EVENT',
    )
    check(!(typeof ev.ticketType === 'string' && ev.ticketType.startsWith('ACC-')), 400, 'ACCOUNT_EVENT_FORBIDDEN')
    if (ev.kind === 'call') check(CALL_CATEGORIES.has(ev.category), 400, 'INVALID_CALL_CATEGORY')
    if (ev.kind === 'exception') check(EXCEPTION_CATEGORIES.has(ev.category), 400, 'INVALID_EXCEPTION_CATEGORY')

    const dedupKey = `${ev.source.trim()}::${ev.eventId.trim()}`
    if (ledger.get(dedupKey)) {
      deduplicated += 1
      continue
    }
    const view =
      ev.view && ALLOWED_VIEWS.has(ev.view)
        ? ev.view
        : ev.kind === 'audit'
          ? 'audit'
          : ev.kind === 'integration'
            ? 'integration'
            : 'monitor'

    ledger.put(dedupKey, {
      dedupKey,
      source: ev.source.trim(),
      eventId: ev.eventId.trim(),
      at: ev.at,
      kind: ev.kind,
      category: ev.category ?? null,
      view,
      resourceId: typeof ev.resourceId === 'string' ? ev.resourceId.slice(0, 200) : null,
      executionId: typeof ev.executionId === 'string' ? ev.executionId.slice(0, 160) : null,
      status: typeof ev.status === 'string' ? ev.status.slice(0, 64) : null,
      summary: redactSummary(ev.summary ?? ''),
    })
    inserted += 1
  }

  return json(res, {inserted, deduplicated}, 201)
}
