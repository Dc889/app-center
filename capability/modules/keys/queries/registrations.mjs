import {check, json} from '../../../../runtime/http.mjs'
import {
  KEY_REGISTRATION_ACTIONS,
  canManageRegistration,
  consumeSecretOnce,
  projectMetadata,
} from '../adapters/registration-store.mjs'

export async function listKeyRegistrations({res, query, identity, openLedger}) {
  const action = query.get('action')
  check(KEY_REGISTRATION_ACTIONS.includes(action), 400, 'INVALID_KEY_ACTION')
  const limitRaw = query.get('limit')
  const limit = limitRaw ? Number(limitRaw) : 50
  check(Number.isInteger(limit) && limit >= 1 && limit <= 100, 400, 'INVALID_QUERY')
  const cursor = query.get('cursor') ?? ''
  const q = (query.get('q') ?? '').trim().toLowerCase()

  const db = openLedger('registrations')
  const eligible = db
    .all()
    .filter(record => ['active', 'expired'].includes(record.status) && canManageRegistration(record, identity))
    .filter(record => {
      if (!q) return true
      const hay = [record.registrationId, record.appId, record.appName, record.callerName, record.lastFour]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
    .sort((a, b) => a.registrationId.localeCompare(b.registrationId))

  const startIndex = cursor ? eligible.findIndex(r => r.registrationId > cursor) : 0
  const slice = startIndex < 0 ? [] : eligible.slice(startIndex, startIndex + limit)
  const hasMore = startIndex >= 0 && startIndex + limit < eligible.length
  const nextCursor = hasMore ? slice.at(-1).registrationId : null

  return json(res, {
    items: slice.map(record => projectMetadata(record, identity, {detail: false})),
    nextCursor,
  })
}

export async function getKeyRegistration({res, query, params, identity, openLedger}) {
  const action = query.get('action')
  check(KEY_REGISTRATION_ACTIONS.includes(action), 400, 'INVALID_KEY_ACTION')
  const db = openLedger('registrations')
  const record = db.get(params.registrationId)
  check(record && canManageRegistration(record, identity), 404, 'NOT_FOUND', '密钥登记不存在或无权限')
  check(['active', 'expired'].includes(record.status), 403, 'KEY_ACTION_DENIED', '当前登记状态不允许此密钥操作')
  return json(res, projectMetadata(record, identity, {detail: true}))
}

export async function revealKeyRegistration({res, params, identity, openLedger}) {
  const db = openLedger('registrations')
  const revealed = consumeSecretOnce(db, params.registrationId, identity)
  return json(res, revealed)
}
