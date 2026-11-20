import {randomUUID} from 'node:crypto'
import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig, resolveProductOwner, difyConsoleFetch} from '../../../platform/dify/public.mjs'

export async function listDifyApps({workspaceId, openLedger} = {}) {
  const {isReal, workspaceId: configuredWorkspace} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 应用连接')
  const scope = workspaceId || configuredWorkspace
  const map = new Map()
  let page = 1
  for (;;) {
    const response = await difyConsoleFetch(`/console/api/apps?page=${page}&limit=100`)
    check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 应用列表读取失败: HTTP ${response.status}`)
    const data = await response.json()
    check(Array.isArray(data?.data), 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 应用列表响应格式错误')
    for (const app of data.data) {
      check(typeof app?.id === 'string' && app.id, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 应用缺少真实标识')
      const appScope = app.workspace_id || configuredWorkspace
      if (scope && appScope && appScope !== scope) continue
      const synced = openLedger ? openLedger('synced-apps').get(app.id) : null
      map.set(app.id, {
        resourceId: app.id,
        name: app.name || app.id,
        source: 'dify',
        workspaceId: appScope || null,
        revision: synced?.revision ?? 0,
        mode: app.mode ?? null,
        ownerAccount: resolveProductOwner([app.owner_account, app.ownerAccount, app.created_by], {product: 'DIFY'}),
        webSiteEnabled: app.enable_site ?? app.webSiteEnabled ?? null,
        publicationVersionId: app.publication_version_id ?? app.publicationVersionId ?? app.workflow?.id ?? null,
        workflowSnapshotId: app.workflow_snapshot_id ?? app.workflowSnapshotId ?? app.workflow?.id ?? null,
      })
    }
    if (!data.has_more) break
    check(data.data.length > 0 && page < 10000, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 应用分页未结束')
    page += 1
  }
  // 同步台账只补充管理元数据，不能让已删除或已失权的产品资源重新出现。
  return [...map.values()]
}

export async function readDifyApp(appId, workspaceId) {
  const {isReal, workspaceId: configuredWorkspace} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 应用连接')
  const response = await difyConsoleFetch(`/console/api/apps/${encodeURIComponent(appId)}`)
  check(response.ok, response.status === 404 ? 404 : 503, 'UPSTREAM_ERROR', `Dify 应用详情读取失败: HTTP ${response.status}`)
  const app = await response.json()
  check(app?.id === appId, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 应用详情标识不一致')
  const actualScope = app.workspace_id || configuredWorkspace || workspaceId
  check(!workspaceId || !actualScope || workspaceId === actualScope, 404, 'NOT_FOUND', '应用不属于目标工作区')
  return {
    resourceId: app.id,
    name: app.name,
    workspaceId: actualScope || null,
    mode: app.mode ?? null,
    ownerAccount: resolveProductOwner([app.owner_account, app.ownerAccount, app.created_by], {product: 'DIFY'}),
    webSiteEnabled: app.enable_site ?? null,
    publicationVersionId: app.publication_version_id ?? app.publicationVersionId ?? app.workflow?.id ?? app.model_config?.id ?? null,
    workflowSnapshotId: app.workflow_snapshot_id ?? app.workflowSnapshotId ?? app.workflow?.id ?? null,
  }
}

export function saveSyncedApp(openLedger, app) {
  const db = openLedger('synced-apps')
  const existing = db.get(app.resourceId)
  check(app.workspaceId, 409, 'MISSING_WORKSPACE', '同步应用缺少已核验工作区')
  const record = {
    resourceId: app.resourceId,
    name: app.name || existing?.name || app.resourceId,
    source: 'dify',
    workspaceId: app.workspaceId,
    mode: app.mode ?? existing?.mode ?? null,
    ownerAccount: app.ownerAccount || existing?.ownerAccount || '',
    revision: existing ? existing.revision + 1 : 1,
    syncedAt: new Date().toISOString(),
  }
  db.put(record.resourceId, record)
  return record
}

export function getGrantState(openLedger, catalogResourceId) {
  const db = openLedger('grants')
  const doc = db.get(catalogResourceId)
  if (!doc) return {revision: 0, items: []}
  return {revision: doc.revision ?? 0, items: Array.isArray(doc.items) ? doc.items : []}
}

export function addGrant(openLedger, catalogResourceId, principals) {
  const db = openLedger('grants')
  const prev = getGrantState(openLedger, catalogResourceId)
  const merged = [...new Set([...prev.items, ...principals.filter(p => typeof p === 'string' && p.trim())])].sort()
  const next = {catalogResourceId, revision: prev.revision + 1, items: merged, updatedAt: new Date().toISOString()}
  db.put(catalogResourceId, next)
  return next
}

export function revokeAllGrants(openLedger, catalogResourceId) {
  const db = openLedger('grants')
  const prev = getGrantState(openLedger, catalogResourceId)
  const next = {catalogResourceId, revision: prev.revision + 1, items: [], revokedCount: prev.items.length, updatedAt: new Date().toISOString()}
  db.put(catalogResourceId, next)
  return next
}

export function buildAgentImpact({resourceId, appId, workspaceId, openLedger}) {
  const capturedAt = new Date().toISOString()
  const grantState = openLedger ? getGrantState(openLedger, resourceId) : {revision: 0, items: []}
  const metaDoc = openLedger ? openLedger('impact-meta').get(resourceId) : null
  const keysItems = Array.isArray(metaDoc?.keys) ? [...new Set(metaDoc.keys)].sort() : []
  const keysRev = Number.isInteger(metaDoc?.keysRevision) ? metaDoc.keysRevision : 0
  const depItems = Array.isArray(metaDoc?.dependencies) ? metaDoc.dependencies : []
  const depRev = Number.isInteger(metaDoc?.dependenciesRevision) ? metaDoc.dependenciesRevision : 0

  return {
    resourceId,
    appId,
    workspaceId,
    snapshotId: `snap-impact-${randomUUID().slice(0, 10)}`,
    capturedAt,
    grants: {state: 'collected', count: grantState.items.length, revision: grantState.revision, items: grantState.items},
    keys: {state: 'collected', count: keysItems.length, revision: keysRev, items: keysItems},
    dependencies: {state: 'collected', count: depItems.length, revision: depRev, items: depItems},
    // 未接入真实调用日志时不伪造 0
    calls30d: {state: 'unavailable', count: null, from: null, to: null, reasonCode: 'CALL_STATS_UNCOLLECTED'},
  }
}

export async function readAgentApprovedInput(clients, command) {
  if (!clients?.management) return null
  let response
  try {
    response = await clients.management('/approved-inputs/' + encodeURIComponent(command.executionId))
  } catch (err) {
    if (err.code === 'REPOSITORY_UNCONFIGURED') return null
    throw err
  }
  const approved = await response.json()
  check(
    approved &&
      approved.decisionRef === command.payload?.decisionRef &&
      approved.ticketType === command.ticketType &&
      approved.action === command.action &&
      approved.resourceId === command.resourceId,
    409,
    'APPROVED_INPUT_MISMATCH',
    '获准输入与执行命令不一致',
  )
  return {
    fields: approved.fields ?? {},
    preconditions: Array.isArray(approved.preconditions) ? approved.preconditions : [],
  }
}
