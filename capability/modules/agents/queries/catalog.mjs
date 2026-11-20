import {check, json} from '../../../../runtime/http.mjs'

const FALLBACK_AGENTS = [
  {
    resourceId: 'app-police-query',
    name: '警情摘要与案情研判助手',
    status: 'active',
    revision: 1,
    appId: 'app-dify-police-01',
    workspaceId: 'ws-default',
    version: 'v1.0.0',
    publicationVersionId: 'pub-police-v1',
    workflowSnapshotId: 'wf-police-snap-1',
    policyRef: 'pol-police-v1',
    ownerAccount: 'chen.yu',
  },
  {
    resourceId: 'app-doc-assistant',
    name: '智能政务公文问答助手',
    status: 'active',
    revision: 1,
    appId: 'app-dify-doc-02',
    workspaceId: 'ws-default',
    version: 'v1.2.0',
    publicationVersionId: 'pub-doc-v1',
    workflowSnapshotId: 'wf-doc-snap-1',
    policyRef: 'pol-doc-v1',
    ownerAccount: 'zhou.min',
  },
]

async function fetchAgents(clients) {
  if (!clients?.agent) return FALLBACK_AGENTS
  try {
    const data = await (await clients.agent('/agents')).json()
    return Array.isArray(data.items) ? data.items : FALLBACK_AGENTS
  } catch (err) {
    if (err.code === 'REPOSITORY_UNCONFIGURED') return FALLBACK_AGENTS
    throw err
  }
}

async function fetchAgent(clients, resourceId) {
  if (clients?.agent) {
    try {
      return await (await clients.agent('/agents/' + encodeURIComponent(resourceId))).json()
    } catch (err) {
      if (err.code !== 'REPOSITORY_UNCONFIGURED') throw err
    }
  }
  const found = FALLBACK_AGENTS.find(a => a.resourceId === resourceId)
  check(found, 404, 'NOT_FOUND')
  return found
}

function canManage(item, identity) {
  if (!identity?.account && !identity?.role) return true
  if (['operator', 'admin'].includes(identity.role)) return true
  return Boolean(identity.account && item.ownerAccount === identity.account)
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
      scope: item.scope ?? 'all',
      usages: Array.isArray(item.usages) && item.usages.length ? item.usages : ['run', 'embed', 'api'],
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
