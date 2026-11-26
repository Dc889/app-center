import {check, json} from '../../../../runtime/http.mjs'

async function fetchAgents(clients) {
  check(clients?.agent, 501, 'REPOSITORY_UNCONFIGURED', '未配置智能体仓库')
  const data = await (await clients.agent('/agents')).json()
  check(Array.isArray(data?.items), 502, 'UPSTREAM_INVALID_RESPONSE', '智能体仓库未返回有效列表')
  return data.items
}

async function fetchAgent(clients, resourceId) {
  check(clients?.agent, 501, 'REPOSITORY_UNCONFIGURED', '未配置智能体仓库')
  const item = await (await clients.agent('/agents/' + encodeURIComponent(resourceId))).json()
  check(item?.resourceId === resourceId, 502, 'UPSTREAM_INVALID_RESPONSE', '智能体仓库返回的资源标识不一致')
  return item
}

function canManage(item, identity) {
  if (!identity?.account && !identity?.role) return false
  if (['operator', 'ops', 'admin'].includes(identity.role)) return true
  if (!identity.account || !item.ownerAccount) return false
  const acct = String(identity.account).toLowerCase()
  const owner = String(item.ownerAccount).toLowerCase()
  return acct === owner || acct.split('@')[0] === owner.split('@')[0]
}

function agentActions(item, requestedAction, identity) {
  const manageable = canManage(item, identity)
  if (requestedAction === 'republish') {
    return manageable && ['active', 'unavailable', 'withdrawn'].includes(item.status) ? ['republish'] : []
  }
  if (requestedAction === 'withdraw_app') {
    return manageable && ['active', 'unavailable'].includes(item.status) ? ['withdraw_app'] : []
  }
  const list = []
  if (item.status === 'active') list.push('view')
  if (manageable && ['active', 'unavailable', 'withdrawn'].includes(item.status)) list.push('republish')
  if (manageable && ['active', 'unavailable'].includes(item.status)) list.push('withdraw_app')
  return list
}

function projectAgent(item, requestedAction, identity) {
  return {
    resourceId: item.resourceId,
    name: item.name,
    status: item.status,
    actions: agentActions(item, requestedAction, identity),
    data: {
      appId: item.appId,
      workspaceId: item.workspaceId,
      version: item.version,
      publicationVersionId: item.publicationVersionId,
      workflowSnapshotId: item.workflowSnapshotId,
      policyRef: item.policyRef,
      revision: item.revision,
      scope: item.scope ?? null,
      usages: Array.isArray(item.usages) ? item.usages : [],
      boundaryOrgs: item.boundaryOrgs ?? [],
      targetOrgs: item.targetOrgs ?? [],
      targetAccounts: item.targetAccounts ?? [],
    },
  }
}

export async function listCatalog({res, query, clients, identity}) {
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const workspaceId = query.get('workspaceId') || ''
  const action = query.get('action') || ''
  const items = await fetchAgents(clients)
  const projected = items
    .filter(item => !workspaceId || item.workspaceId === workspaceId)
    .map(item => projectAgent(item, action, identity))
    .filter(entry => (!action ? entry.status !== 'withdrawn' : entry.actions.includes(action)))
    .filter(entry => !q || (entry.name + entry.resourceId).toLowerCase().includes(q))

  return json(res, {items: projected, nextCursor: null})
}

export async function catalogItem({res, query, resourceId, clients, identity}) {
  const action = query.get('action') || ''
  const item = await fetchAgent(clients, resourceId)
  const entry = projectAgent(item, action, identity)
  if (action && ['republish', 'withdraw_app'].includes(action)) {
    check(entry.actions.includes(action), 403, 'AGENT_MANAGEMENT_DENIED', '当前身份没有此智能体管理操作资格')
  }
  return json(res, entry)
}

export async function catalogVersions({res, resourceId, clients}) {
  const data = await (await clients.agent('/agents/' + encodeURIComponent(resourceId) + '/versions')).json()
  return json(res, data)
}
