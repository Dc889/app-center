import {randomUUID} from 'node:crypto'
import {check} from '../../../../runtime/http.mjs'

export const KEY_REGISTRATION_ACTIONS = Object.freeze(['rotate_key', 'revoke_key'])
const DEFAULT_REVEAL_TTL_MS = 10 * 60 * 1000
const vaults = new WeakMap()

export function vaultFor(db) {
  let vault = vaults.get(db)
  if (!vault) {
    vault = new Map()
    vaults.set(db, vault)
  }
  return vault
}

export function clearVault(db) {
  vaults.get(db)?.clear()
  vaults.delete(db)
}

export function canManageRegistration(record, identity) {
  if (!record || !identity) return false
  if (record.ownerAccount && record.ownerAccount === identity.account) return true
  return ['operator', 'admin'].includes(identity.role)
}

export function registrationActionsFor(record, identity) {
  if (!record || !['active', 'expired'].includes(record.status)) return []
  return canManageRegistration(record, identity) ? [...KEY_REGISTRATION_ACTIONS] : []
}

export function projectMetadata(record, identity, {detail = false} = {}) {
  const result = {
    registrationId: record.registrationId,
    appId: record.appId,
    workspaceId: record.workspaceId,
    lastFour: record.lastFour,
    status: record.status,
    revision: record.revision,
    actions: registrationActionsFor(record, identity),
  }
  for (const key of ['appName', 'callerName', 'callerOrg', 'environment']) {
    if (typeof record[key] === 'string' && record[key].trim()) {
      result[key] = record[key].trim()
    }
  }
  if (detail) {
    result.keyId = record.keyId
  }
  return result
}

export function registerKey(db, meta, secret, {ttlMs = DEFAULT_REVEAL_TTL_MS, now = Date.now} = {}) {
  check(typeof secret === 'string' && secret.length >= 4, 500, 'INVALID_KEY_SECRET')
  const lastFour = typeof meta.lastFour === 'string' && meta.lastFour.length === 4 ? meta.lastFour : secret.slice(-4)
  check(lastFour.length === 4, 500, 'INVALID_KEY_METADATA')
  const createdMs = now()
  const createdAt = new Date(createdMs).toISOString()
  const revealExpiresAt = new Date(createdMs + ttlMs).toISOString()
  const registrationId = meta.registrationId || `reg-${randomUUID().slice(0, 12)}`
  const record = {
    registrationId,
    appId: meta.appId,
    workspaceId: meta.workspaceId,
    keyId: meta.keyId,
    lastFour,
    status: 'active',
    revision: 1,
    ownerAccount: meta.ownerAccount,
    ownerOrg: meta.ownerOrg ?? '',
    apiBase: meta.apiBase ?? '',
    appName: meta.appName ?? null,
    callerName: meta.callerName ?? null,
    callerOrg: meta.callerOrg ?? null,
    environment: meta.environment ?? null,
    publicationTicketNo: meta.publicationTicketNo ?? null,
    createdAt,
    updatedAt: createdAt,
    revealExpiresAt,
    revealConsumedAt: null,
  }
  db.put(registrationId, record)
  vaultFor(db).set(registrationId, {
    secret,
    account: record.ownerAccount,
    expiresAtMs: createdMs + ttlMs,
  })
  return {record, revealExpiresAt}
}

export function consumeSecretOnce(db, registrationId, identity, {now = Date.now} = {}) {
  const record = db.get(registrationId)
  check(record && identity?.account && record.ownerAccount === identity.account, 404, 'NOT_FOUND', '登记不存在或无领取权')
  check(!record.revealConsumedAt, 409, 'REVEAL_UNAVAILABLE', '密钥明文已被领取')
  const vault = vaultFor(db)
  const entry = vault.get(registrationId)
  check(entry && entry.account === identity.account, 409, 'REVEAL_UNAVAILABLE', '密钥明文已不可用')
  if (now() > entry.expiresAtMs) {
    vault.delete(registrationId)
    check(false, 409, 'REVEAL_UNAVAILABLE', '密钥领取已过期')
  }
  vault.delete(registrationId)
  const consumedAt = new Date(now()).toISOString()
  db.put(registrationId, {...record, revealConsumedAt: consumedAt, updatedAt: consumedAt})
  return {secret: entry.secret}
}

export function transitionRegistration(db, registrationId, expectedRevision, nextStatus, {now = Date.now} = {}) {
  const record = db.get(registrationId)
  check(record, 404, 'NOT_FOUND', '密钥登记不存在')
  check(['active', 'expired'].includes(record.status), 409, 'INVALID_KEY_STATE', '当前密钥状态不允许变更')
  if (expectedRevision !== undefined && expectedRevision !== null) {
    check(record.revision === expectedRevision, 409, 'STALE_SNAPSHOT', '密钥登记修订已变化，请重新读取')
  }
  vaultFor(db).delete(registrationId)
  const updated = {
    ...record,
    status: nextStatus,
    revision: record.revision + 1,
    updatedAt: new Date(now()).toISOString(),
  }
  db.put(registrationId, updated)
  return updated
}
