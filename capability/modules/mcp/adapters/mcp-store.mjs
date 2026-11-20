import {randomUUID} from 'node:crypto'
import {check, digest} from '../../../../runtime/http.mjs'

export const SEED_MCP_REGISTRATIONS = Object.freeze([
  {
    registrationId: 'mcp-archive-reg',
    name: '档案检索服务技术注册',
    source: 'mcp',
    status: 'registered',
    transport: 'sse',
    urlFingerprint: digest(Buffer.from('http://mcp.internal/archive-reg')),
    authType: 'bearer',
    tools: [
      {name: 'search_archive', description: '检索案卷档案', inputSchema: {type: 'object', properties: {q: {type: 'string'}}}},
      {name: 'get_archive_detail', description: '读取卷宗详情', inputSchema: {type: 'object', properties: {id: {type: 'string'}}}},
    ],
    syncedAt: '2026-11-20T00:00:00.000Z',
  },
  {
    registrationId: 'mcp-corp-reg',
    name: '企业信用查询技术注册',
    source: 'mcp',
    status: 'active',
    transport: 'stream',
    urlFingerprint: digest(Buffer.from('http://mcp.internal/corp-reg')),
    authType: 'api_key',
    tools: [
      {name: 'query_company', description: '查询工商信息', inputSchema: {type: 'object', properties: {name: {type: 'string'}}}},
    ],
    syncedAt: '2026-11-20T00:00:00.000Z',
  },
])

export function getAllRegistrations(openLedger) {
  const map = new Map()
  for (const seed of SEED_MCP_REGISTRATIONS) map.set(seed.registrationId, {...seed})
  if (openLedger) {
    for (const row of openLedger('registrations').all()) map.set(row.registrationId, row)
  }
  return [...map.values()]
}

export function findRegistration(openLedger, registrationId) {
  const persisted = openLedger ? openLedger('registrations').get(registrationId) : null
  return persisted ?? SEED_MCP_REGISTRATIONS.find(s => s.registrationId === registrationId) ?? null
}

export function listActiveBindings(db, resourceId) {
  return db
    .all()
    .filter(b => b && b.resourceId === resourceId && b.status === 'active')
}

export function createBinding(db, {resourceId, account, workspaceId, providerId, targetAppId = '', startsAt, expiresAt}) {
  const existing = db
    .all()
    .find(
      b =>
        b &&
        b.status === 'active' &&
        b.resourceId === resourceId &&
        b.account === account &&
        b.workspaceId === workspaceId &&
        b.providerId === providerId,
    )
  if (existing) {
    const updated = {...existing, targetAppId, startsAt, expiresAt, updatedAt: new Date().toISOString()}
    db.put(existing.bindingId, updated)
    return updated
  }
  const bindingId = 'bind-' + randomUUID().slice(0, 12)
  const record = {
    bindingId,
    resourceId,
    account,
    workspaceId,
    providerId,
    targetAppId,
    startsAt,
    expiresAt,
    status: 'active',
    createdAt: new Date().toISOString(),
  }
  db.put(bindingId, record)
  return record
}

export function deactivateBindings(db, resourceId, triples) {
  const keySet = new Set(triples.map(t => JSON.stringify([t.account, t.workspaceId, t.providerId])))
  let count = 0
  const nowIso = new Date().toISOString()
  for (const row of db.all()) {
    if (!row || row.resourceId !== resourceId || row.status !== 'active') continue
    const key = JSON.stringify([row.account, row.workspaceId, row.providerId])
    if (keySet.has(key)) {
      db.put(row.bindingId, {...row, status: 'unbound', unboundAt: nowIso})
      count++
    }
  }
  return count
}

export async function readMcpApprovedInput(clients, command) {
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
