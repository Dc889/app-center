import {check, json} from '../../../../runtime/http.mjs'
import {knowledgeWarehouseReport} from './knowledge-warehouse.mjs'

async function readCatalog(cap, headers) {
  if (!cap) return null
  const items = []
  let seen = false
  for (const kind of ['ragflow_dataset', 'dify_dataset']) {
    try {
      const response = await cap('/resources?kind=' + kind + '&limit=100', 'GET', undefined, headers)
      if (!response?.ok) continue
      const body = await response.json()
      if (!Array.isArray(body?.items)) continue
      seen = true
      for (const item of body.items) items.push({...item, source: item.source ?? (kind === 'ragflow_dataset' ? 'RAGFlow' : 'Dify')})
    } catch { /* 未采集时保留工单仓库 */ }
  }
  if (seen) return items
  try {
    const response = await cap('/catalog?kind=knowledge', 'GET', undefined, headers)
    if (!response?.ok) return null
    const body = await response.json()
    return Array.isArray(body?.items) ? body.items : null
  } catch {
    return null
  }
}

export async function routeKnowledgeWarehouse(services) {
  const {applications, cap, directory, identity, options, ownerHeaders, req, res} = services
  check(req.method === 'GET' && identity?.active, 403, 'ACCESS_DENIED')
  const headers = ownerHeaders({command: {account: identity.account, org: identity.org, actorRole: identity.roles[0]}})
  const report = knowledgeWarehouseReport({
    query: new URL(req.url, 'http://localhost').searchParams,
    now: (options.now ?? Date.now)(),
    identity,
    applications: applications.records(),
    catalogItems: await readCatalog(cap, headers),
  })
  const current = directory.get(identity.subjectId)
  check(directory.isActive(current) && current.revision === identity.profileRevision && !directory.restricted(identity.account), 403, 'ACTOR_SESSION_CHANGED')
  return json(res, report)
}
