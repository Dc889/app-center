import {check, json} from '../../../../runtime/http.mjs'
import {listDifyApps} from '../adapters/agent-store.mjs'

const PURPOSES = ['dataset_binding', 'mcp_binding', 'dataset_publication']

export async function listApplicationTargets({res, query, openLedger}) {
  const purpose = query.get('purpose')
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  check(PURPOSES.includes(purpose) && workspaceId, 400, 'INVALID_APPLICATION_TARGET_QUERY')
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const cursor = query.get('cursor') ?? ''
  const limitRaw = query.get('limit')
  const limit = limitRaw ? Number(limitRaw) : 50
  check(Number.isInteger(limit) && limit >= 1 && limit <= 100, 400, 'INVALID_QUERY')

  const apps = (await listDifyApps({workspaceId, openLedger}))
    .filter(a => !q || (a.name + a.resourceId).toLowerCase().includes(q))
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId))
  const start = cursor ? apps.findIndex(a => a.resourceId > cursor) : 0
  const slice = start < 0 ? [] : apps.slice(start, start + limit)
  const hasMore = start >= 0 && start + limit < apps.length

  return json(res, {
    items: slice.map(a => ({appId: a.resourceId, name: a.name, workspaceId})),
    nextCursor: hasMore ? slice.at(-1).resourceId : null,
  })
}

export async function applicationTargetDetail({res, query, params, openLedger}) {
  const purpose = query.get('purpose')
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  const appId = params.appId
  check(PURPOSES.includes(purpose) && workspaceId && appId, 400, 'INVALID_APPLICATION_TARGET_QUERY')

  const apps = await listDifyApps({workspaceId, openLedger})
  const app = apps.find(a => a.resourceId === appId)
  check(app, 404, 'NOT_FOUND', '目标应用不存在或无配置资格')

  return json(res, {
    eligible: true,
    appId: app.resourceId,
    name: app.name,
    workspaceId,
    purpose,
    targetRef: `target-${workspaceId}-${app.resourceId}`,
    revision: Number.isInteger(app.revision) ? app.revision : 1,
  })
}
