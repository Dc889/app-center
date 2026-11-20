import {randomUUID} from 'node:crypto'
import {check, json} from '../../../../runtime/http.mjs'
import {fetchDifyAppForKey} from '../adapters/difyAppInfo.mjs'
import {KEY_REGISTRATION_ACTIONS, canManageRegistration} from '../adapters/registration-store.mjs'

export async function key01Context({res, query, identity}) {
  const action = query.get('action')
  const resourceId = (query.get('resourceId') ?? '').trim()
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  check(action === 'create_key', 400, 'INVALID_KEY_ACTION')
  check(resourceId && workspaceId, 400, 'INVALID_REQUEST')

  const app = await fetchDifyAppForKey(resourceId, workspaceId, identity.account)
  return json(res, {
    snapshotId: `snap-key01-${randomUUID().slice(0, 12)}`,
    ticketType: 'KEY-01',
    action: 'create_key',
    resourceId,
    capturedAt: new Date().toISOString(),
    fields: {
      'Dify应用ID': app.appId,
      '所有者账户名': app.ownerAccount,
      'Dify API地址': app.apiBase,
      '关联发布工单号': app.publicationTicketNo,
    },
    preconditions: [],
  })
}

export async function key02Context({res, query, identity, openLedger}) {
  const action = query.get('action')
  const resourceId = (query.get('resourceId') ?? '').trim()
  check(KEY_REGISTRATION_ACTIONS.includes(action), 400, 'INVALID_KEY_ACTION')
  check(resourceId, 400, 'INVALID_REQUEST')

  const db = openLedger('registrations')
  const record = db.get(resourceId)
  check(record && canManageRegistration(record, identity), 404, 'NOT_FOUND', '密钥登记不存在或无权限')
  check(['active', 'expired'].includes(record.status), 403, 'KEY_ACTION_DENIED', '当前登记状态不允许此密钥操作')

  return json(res, {
    snapshotId: `snap-key02-${record.registrationId}-r${record.revision}`,
    ticketType: 'KEY-02',
    action,
    resourceId: record.registrationId,
    capturedAt: new Date().toISOString(),
    fields: {
      'Dify workspace ID': record.workspaceId,
      'Dify应用ID': record.appId,
      'Dify密钥ID': record.keyId,
      '密钥后四位': record.lastFour,
    },
    preconditions: [{kind: 'key_registration', id: record.registrationId, revision: record.revision}],
  })
}
