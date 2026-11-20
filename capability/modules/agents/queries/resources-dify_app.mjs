import {check, id} from '../../../../runtime/http.mjs'
import {buildAgentImpact, listDifyApps} from '../adapters/agent-store.mjs'

export async function listDifyAppResources({query, openLedger}) {
  const workspaceId = query?.get('workspaceId') || 'ws-default'
  const q = (query?.get('q') ?? '').trim().toLowerCase()
  const cursor = query?.get('cursor') ?? ''
  const limitRaw = query?.get('limit')
  const limit = limitRaw ? Number(limitRaw) : 50
  check(Number.isInteger(limit) && limit >= 1 && limit <= 100, 400, 'INVALID_QUERY')

  const apps = (await listDifyApps({workspaceId, openLedger}))
    .filter(a => !q || (a.name + a.resourceId).toLowerCase().includes(q))
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId))
  const start = cursor ? apps.findIndex(a => a.resourceId > cursor) : 0
  const slice = start < 0 ? [] : apps.slice(start, start + limit)
  const hasMore = start >= 0 && start + limit < apps.length

  return {
    items: slice.map(({resourceId, name, source, workspaceId: ws}) => ({resourceId, name, source: source || 'dify', workspaceId: ws})),
    nextCursor: hasMore ? slice.at(-1).resourceId : null,
  }
}

export async function difyAppResourceDetail({resourceId, query, clients, openLedger}) {
  const workspaceId = (query?.get('workspaceId') ?? 'ws-default').trim()
  const catalogResourceId = (query?.get('catalogResourceId') ?? '').trim()

  const apps = await listDifyApps({workspaceId, openLedger})
  const app = apps.find(a => a.resourceId === resourceId)

  let catalogEntry = null
  const lookupCatalogId = catalogResourceId || resourceId
  if (lookupCatalogId && clients?.agent) {
    try {
      catalogEntry = await (await clients.agent('/agents/' + encodeURIComponent(lookupCatalogId))).json()
    } catch (err) {
      if (err.code !== 'REPOSITORY_UNCONFIGURED' && err.status !== 404) throw err
    }
  }
  check(app || catalogEntry, 404, 'NOT_FOUND', 'Dify 应用不存在')

  const effectiveAppId = app?.resourceId ?? catalogEntry.appId
  const effectiveName = app?.name ?? catalogEntry.name
  const data = {
    appId: effectiveAppId,
    name: effectiveName,
    workspaceId,
    mode: app?.mode ?? 'workflow',
    ownerAccount: app?.ownerAccount ?? catalogEntry?.ownerAccount ?? '',
    webSiteEnabled: Boolean(app?.webSiteEnabled ?? false),
    publicationVersionId: catalogEntry?.publicationVersionId ?? app?.publicationVersionId ?? `pub-${effectiveAppId}-v1`,
    workflowSnapshotId: catalogEntry?.workflowSnapshotId ?? app?.workflowSnapshotId ?? `wf-${effectiveAppId}-1`,
    catalogRevision: catalogEntry?.revision ?? 0,
  }
  if (catalogResourceId) {
    data.publicationVersionId = catalogEntry?.publicationVersionId ?? `pub-${catalogResourceId}-v1`
    data.workflowSnapshotId = catalogEntry?.workflowSnapshotId ?? `wf-${catalogResourceId}-1`
    data.catalogRevision = catalogEntry?.revision ?? 1
    data.agentImpact = buildAgentImpact({
      resourceId: catalogResourceId,
      appId: effectiveAppId,
      workspaceId,
      openLedger,
    })
  }

  return {
    snapshotId: `dify-app-${id()}`,
    capturedAt: new Date().toISOString(),
    resourceId: effectiveAppId,
    name: effectiveName,
    source: 'dify',
    workspaceId,
    data,
  }
}

export const difyAppResource = Object.freeze({
  list: listDifyAppResources,
  detail: difyAppResourceDetail,
})
