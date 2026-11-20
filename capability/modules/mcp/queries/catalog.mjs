import {check, json} from '../../../../runtime/http.mjs'
import {listActiveBindings} from '../adapters/mcp-store.mjs'

const ALLOWED_STATUSES = {
  unbind_mcp: ['active', 'isolated', 'withdrawn'],
  isolate_mcp: ['active'],
  withdraw_mcp: ['active', 'isolated'],
}

async function fetchMcps(clients) {
  check(clients?.mcp, 501, 'REPOSITORY_UNCONFIGURED', '未配置 MCP 仓库')
  const data = await (await clients.mcp('/mcps')).json()
  check(Array.isArray(data?.items), 502, 'UPSTREAM_INVALID_RESPONSE', 'MCP 仓库未返回有效列表')
  return data.items
}

async function fetchMcpItem(clients, resourceId) {
  check(clients?.mcp, 501, 'REPOSITORY_UNCONFIGURED', '未配置 MCP 仓库')
  const item = await (await clients.mcp('/mcps/' + encodeURIComponent(resourceId))).json()
  check(item?.resourceId === resourceId, 502, 'UPSTREAM_INVALID_RESPONSE', 'MCP 仓库返回的资源标识不一致')
  return item
}

function canDispose(item, action, identity, bindings) {
  if (!ALLOWED_STATUSES[action]?.includes(item.status)) return false
  if (['operator', 'admin'].includes(identity?.role)) return true
  if (action === 'unbind_mcp') {
    return Boolean(identity?.account && (item.ownerAccount === identity.account || bindings.some(b => b.account === identity.account)))
  }
  return Boolean(identity?.account && item.ownerAccount === identity.account)
}

function computeActions(item, requestedAction, identity, bindings) {
  if (requestedAction && Object.hasOwn(ALLOWED_STATUSES, requestedAction)) {
    return canDispose(item, requestedAction, identity, bindings) ? [requestedAction] : []
  }
  const list = []
  if (item.status === 'active') list.push('bind')
  for (const act of ['unbind_mcp', 'isolate_mcp', 'withdraw_mcp']) {
    if (canDispose(item, act, identity, bindings)) list.push(act)
  }
  return list
}

function projectEntry(item, {workspaceId, action, identity, bindings}) {
  const wsBinding = workspaceId ? bindings.find(b => b.workspaceId === workspaceId && (!identity?.account || b.account === identity.account)) : null
  const isBound = Boolean(wsBinding)
  return {
    resourceId: item.resourceId,
    name: item.name,
    status: item.status,
    actions: computeActions(item, action, identity, bindings),
    data: {
      transport: item.transport,
      toolNames: item.toolNames,
      bound: isBound,
      bindingId: wsBinding?.bindingId ?? '',
      bindingAccess: item.status === 'active' ? item.bindingAccess || 'approval' : 'denied',
      revision: item.revision,
    },
  }
}

export async function listCatalog({res, query, clients, identity, openLedger}) {
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const workspaceId = query.get('workspaceId') || ''
  const action = query.get('action') || ''
  const items = await fetchMcps(clients)
  const db = openLedger ? openLedger('bindings') : null

  const projected = items
    .map(item => {
      const bindings = db ? listActiveBindings(db, item.resourceId) : []
      return projectEntry(item, {workspaceId, action, identity, bindings})
    })
    .filter(entry => (!action ? entry.status !== 'withdrawn' : entry.actions.includes(action)))
    .filter(entry => !q || (entry.name + entry.resourceId).toLowerCase().includes(q))

  return json(res, {items: projected, nextCursor: null})
}

export async function catalogItem({res, query, resourceId, clients, identity, openLedger}) {
  const action = query.get('action') || ''
  const workspaceId = query.get('workspaceId') || ''
  const item = await fetchMcpItem(clients, resourceId)
  const bindings = openLedger ? listActiveBindings(openLedger('bindings'), item.resourceId) : []
  const entry = projectEntry(item, {workspaceId, action, identity, bindings})
  if (action && Object.hasOwn(ALLOWED_STATUSES, action)) {
    check(entry.actions.includes(action), 403, 'MCP_DISPOSITION_DENIED', '当前身份没有此 MCP 处置资格')
  }
  return json(res, entry)
}
