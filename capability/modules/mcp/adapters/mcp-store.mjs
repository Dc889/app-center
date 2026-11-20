import {randomUUID} from 'node:crypto'
import {check} from '../../../../runtime/http.mjs'

export function getAllRegistrations(openLedger) {
  return openLedger ? openLedger('registrations').all() : []
}

export function findRegistration(openLedger, registrationId) {
  return openLedger ? openLedger('registrations').get(registrationId) ?? null : null
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
