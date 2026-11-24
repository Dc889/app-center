import {check, id} from '../../../../runtime/http.mjs'
import {buildAgentImpact, inspectDifyAppDependencies, listDifyApps, readDifyApp} from '../adapters/agent-store.mjs'

export async function listDifyAppResources({query, openLedger}) {
  const workspaceId = query?.get('workspaceId') || undefined
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
    items: slice.map(app => ({
      resourceId: app.resourceId,
      name: app.name,
      source: app.source || 'dify',
      workspaceId: app.workspaceId,
      ownerAccount: app.ownerAccount || '',
      data: {mode: app.mode ?? null, description: app.description ?? null, ownerAccount: app.ownerAccount || '', versions: app.versions ?? []},
    })),
    nextCursor: hasMore ? slice.at(-1).resourceId : null,
  }
}

export async function difyAppResourceDetail({resourceId, query, clients, openLedger}) {
  const workspaceId = (query?.get('workspaceId') ?? '').trim()
  const catalogResourceId = (query?.get('catalogResourceId') ?? '').trim()

  const apps = await listDifyApps({workspaceId, openLedger})
  const listedApp = apps.find(a => a.resourceId === resourceId)
  const app = listedApp ? {...listedApp, ...await readDifyApp(resourceId, listedApp.workspaceId)} : null

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
  const depAudit = app ? await inspectDifyAppDependencies(app, {clients}) : {dependencies: [], dependencySummary: null}
  const data = {
    appId: effectiveAppId,
    name: effectiveName,
    workspaceId: app?.workspaceId ?? catalogEntry?.workspaceId ?? null,
    mode: app?.mode ?? null,
    ownerAccount: app?.ownerAccount ?? catalogEntry?.ownerAccount ?? '',
    webSiteEnabled: app?.webSiteEnabled ?? null,
    publicationVersionId: app?.publicationVersionId ?? null,
    workflowSnapshotId: app?.workflowSnapshotId ?? null,
    catalogRevision: catalogEntry?.revision ?? 0,
    dependencies: depAudit.dependencies,
    dependencySummary: depAudit.dependencySummary,
  }
  if (catalogResourceId) {
    data.catalogRevision = catalogEntry?.revision ?? 0
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
    workspaceId: data.workspaceId,
    data,
  }
}

export const difyAppResource = Object.freeze({
  list: listDifyAppResources,
  detail: difyAppResourceDetail,
})
