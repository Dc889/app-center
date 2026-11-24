import {check, json} from '../../../../runtime/http.mjs'
import {listActiveBindings} from '../adapters/mcp-store.mjs'

const ALLOWED_STATUSES = {
  unbind_mcp: ['active', 'isolated', 'withdrawn'],
  isolate_mcp: ['active'],
  withdraw_mcp: ['active', 'isolated'],
}

export async function bindingContext({res, query, params, clients}) {
  const resourceId = params.resourceId
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  check(resourceId && workspaceId, 400, 'INVALID_REQUEST')
  const item = await (await clients.mcp('/mcps/' + encodeURIComponent(resourceId))).json()
  return json(res, {
    resourceId: item.resourceId,
    workspaceId,
    expectedUrlFingerprint: item.urlFingerprint,
    bindingAccess: item.status === 'active' ? item.bindingAccess || 'approval' : 'denied',
  })
}

export async function mcp03Context({res, query, clients, identity, openLedger}) {
  const action = query.get('action')
  const resourceId = (query.get('resourceId') ?? '').trim()
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  const targetAccount = (query.get('targetAccount') ?? '').trim()
  check(Object.hasOwn(ALLOWED_STATUSES, action) && resourceId, 400, 'INVALID_REQUEST')

  const item = await (await clients.mcp('/mcps/' + encodeURIComponent(resourceId))).json()
  check(ALLOWED_STATUSES[action].includes(item.status), 403, 'MCP_DISPOSITION_DENIED', '当前 MCP 状态不允许此处置动作')

  const db = openLedger('bindings')
  const allActive = listActiveBindings(db, resourceId)
  const isStaff = ['operator', 'admin'].includes(identity?.role)
  const isOwner = Boolean(identity?.account && item.ownerAccount === identity.account)
  let scoped
  if (action === 'unbind_mcp') {
    if (workspaceId && targetAccount) {
      check(isStaff || isOwner || targetAccount === identity?.account, 403, 'MCP_DISPOSITION_DENIED')
      scoped = allActive.filter(b => b.account === targetAccount && b.workspaceId === workspaceId)
    } else {
      scoped = isStaff || isOwner ? allActive : allActive.filter(b => b.account === identity?.account)
    }
  } else {
    check(isStaff || isOwner, 403, 'MCP_DISPOSITION_DENIED', '当前身份无目录隔离/下架资格')
    scoped = allActive
  }

  const deduped = []
  const seen = new Set()
  for (const b of scoped) {
    const k = JSON.stringify([b.account, b.workspaceId, b.providerId])
    if (seen.has(k)) continue
    seen.add(k)
    deduped.push({account: b.account, workspaceId: b.workspaceId, providerId: b.providerId})
  }

  return json(res, {
    snapshotId: `snap-mcp03-${item.resourceId}-r${item.revision}`,
    ticketType: 'MCP-03',
    action,
    resourceId: item.resourceId,
    name: item.name,
    capturedAt: new Date().toISOString(),
    fields: {
      'MCP名称': item.name,
      '绑定清单快照ID': `bset-${item.resourceId}-r${item.revision}-${deduped.length}`,
      '绑定清单完整': true,
      '绑定清单': deduped,
    },
    preconditions: [{kind: 'mcp', id: item.resourceId, revision: item.revision}],
  })
}
