import {randomUUID} from 'node:crypto'
import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'

export const SEED_DIFY_APPS = Object.freeze([
  {resourceId: 'app-police-01', name: '警情摘要与案情研判助手', source: 'dify', workspaceId: 'ws-default', revision: 1, ownerAccount: 'chen.yu'},
  {resourceId: 'app-doc-02', name: '智能政务公文问答助手', source: 'dify', workspaceId: 'ws-default', revision: 1, ownerAccount: 'zhou.min'},
])

export async function listDifyApps({workspaceId = 'ws-default', openLedger} = {}) {
  const {base, token, isReal} = getDifyConfig()
  const map = new Map()
  if (isReal) {
    const response = await fetch(`${base}/console/api/apps?page=1&limit=100`, {
      headers: {Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(15000),
    })
    check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 应用列表读取失败: HTTP ${response.status}`)
    const data = await response.json()
    for (const app of data.data ?? []) {
      if (!app || typeof app.id !== 'string') continue
      map.set(app.id, {
        resourceId: app.id,
        name: app.name || app.id,
        source: 'dify',
        workspaceId: app.workspace_id || workspaceId,
        revision: 1,
        mode: app.mode || 'workflow',
      })
    }
  } else {
    for (const seed of SEED_DIFY_APPS) {
      map.set(seed.resourceId, {...seed, workspaceId})
    }
  }
  if (openLedger) {
    for (const row of openLedger('synced-apps').all()) {
      if (!workspaceId || !row.workspaceId || row.workspaceId === workspaceId) {
        map.set(row.resourceId, row)
      }
    }
  }
  return [...map.values()]
}

export function saveSyncedApp(openLedger, app) {
  const db = openLedger('synced-apps')
  const existing = db.get(app.resourceId)
  const record = {
    resourceId: app.resourceId,
    name: app.name || existing?.name || app.resourceId,
    source: 'dify',
    workspaceId: app.workspaceId || existing?.workspaceId || 'ws-default',
    mode: app.mode || existing?.mode || 'workflow',
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
