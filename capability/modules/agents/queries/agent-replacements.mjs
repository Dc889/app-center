import {check, json} from '../../../../runtime/http.mjs'

function audienceCovers(candidate, source) {
  if (candidate.scope === 'public') return true
  if (source.scope === 'public') return false
  const srcOrgs = Array.isArray(source.targetOrgs) ? source.targetOrgs : []
  const candOrgs = Array.isArray(candidate.targetOrgs) ? candidate.targetOrgs : []
  return srcOrgs.every(org => candOrgs.includes(org))
}

function sameNativeAlias(a, b) {
  return a.appId === b.appId && a.workspaceId === b.workspaceId
}

export async function listAgentReplacements({res, query, clients}) {
  const sourceResourceId = (query.get('sourceResourceId') ?? '').trim()
  check(sourceResourceId, 400, 'INVALID_REPLACEMENT_QUERY')
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const cursor = query.get('cursor') ?? ''
  const limitRaw = query.get('limit')
  const limit = limitRaw ? Number(limitRaw) : 50
  check(Number.isInteger(limit) && limit >= 1 && limit <= 100, 400, 'INVALID_QUERY')

  const source = await (await clients.agent('/agents/' + encodeURIComponent(sourceResourceId))).json()
  const {items} = await (await clients.agent('/agents')).json()
  const candidates = items
    .filter(
      row =>
        row.status === 'active' &&
        row.resourceId !== sourceResourceId &&
        !sameNativeAlias(row, source) &&
        audienceCovers(row, source),
    )
    .filter(row => !q || (row.name + row.resourceId).toLowerCase().includes(q))
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId))

  const start = cursor ? candidates.findIndex(c => c.resourceId > cursor) : 0
  const slice = start < 0 ? [] : candidates.slice(start, start + limit)
  const hasMore = start >= 0 && start + limit < candidates.length
  return json(res, {
    items: slice.map(c => ({resourceId: c.resourceId, name: c.name})),
    nextCursor: hasMore ? slice.at(-1).resourceId : null,
  })
}

export async function agentReplacementDetail({res, query, params, clients}) {
  const sourceResourceId = (query.get('sourceResourceId') ?? '').trim()
  const resourceId = params.resourceId
  check(sourceResourceId && resourceId && resourceId !== sourceResourceId, 400, 'INVALID_REPLACEMENT')

  const source = await (await clients.agent('/agents/' + encodeURIComponent(sourceResourceId))).json()
  const candidate = await (await clients.agent('/agents/' + encodeURIComponent(resourceId))).json()
  check(!sameNativeAlias(candidate, source), 409, 'INVALID_REPLACEMENT_CONTEXT', '不能选择同原生应用作为替代目录')
  const active = candidate.status === 'active'
  const compatible = audienceCovers(candidate, source)

  return json(res, {
    eligible: active,
    audienceCompatible: compatible,
    sourceResourceId: source.resourceId,
    resourceId: candidate.resourceId,
    status: candidate.status,
    name: candidate.name,
    appId: candidate.appId,
    workspaceId: candidate.workspaceId,
    sourceAppId: source.appId,
    sourceWorkspaceId: source.workspaceId,
    publicationVersionId: candidate.publicationVersionId,
    policyRef: candidate.policyRef,
    revision: candidate.revision,
  })
}
