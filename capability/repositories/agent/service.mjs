import {body, check, json, ledger, listen, prefix} from '../../../runtime/http.mjs'

const seedAgents = [
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
    scope: 'org',
    targetOrgs: ['业务一部'],
    targetAccounts: [],
    boundaryOrgs: ['业务一部'],
    usages: ['web'],
    ownerAccount: 'chen.yu',
    versions: [{publicationVersionId: 'pub-police-v1', version: 'v1.0.0', workflowSnapshotId: 'wf-police-snap-1', status: 'active'}],
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
    scope: 'public',
    targetOrgs: [],
    targetAccounts: [],
    boundaryOrgs: [],
    usages: ['web', 'api'],
    ownerAccount: 'zhou.min',
    versions: [{publicationVersionId: 'pub-doc-v1', version: 'v1.2.0', workflowSnapshotId: 'wf-doc-snap-1', status: 'active'}],
  },
]

export function startAgent(options) {
  const store = ledger(options.dir, 'agents')

  function mergedItems() {
    const map = new Map()
    for (const s of seedAgents) map.set(s.resourceId, {...s})
    for (const row of store.all()) map.set(row.resourceId, row)
    return [...map.values()]
  }

  function findItem(resourceId) {
    return store.get(resourceId) ?? seedAgents.find(s => s.resourceId === resourceId) ?? null
  }

  return listen(
    async (req, res, path) => {
      const root = prefix + '/agents'
      if (req.method === 'GET' && path === root) {
        const items = mergedItems().map(({versions: _v, ...summary}) => summary)
        return json(res, {items, nextCursor: null})
      }

      if (req.method === 'POST' && path === root) {
        const input = await body(req)
        check(
          input &&
            typeof input.resourceId === 'string' &&
            /^[\w-]+$/.test(input.resourceId) &&
            typeof input.appId === 'string' &&
            input.appId.trim() &&
            typeof input.workspaceId === 'string' &&
            input.workspaceId.trim() &&
            typeof input.publicationVersionId === 'string' &&
            input.publicationVersionId.trim(),
          400,
          'INVALID_REQUEST',
        )
        const existing = findItem(input.resourceId)
        if (existing) {
          check(input.expectedRevision === existing.revision, 409, 'STALE_SNAPSHOT', '智能体目录修订已变化')
        } else {
          check((input.expectedRevision ?? 0) === 0, 409, 'STALE_SNAPSHOT')
        }
        const ver = {
          publicationVersionId: input.publicationVersionId,
          version: input.version || input.publicationVersionId,
          workflowSnapshotId: input.workflowSnapshotId || input.snapshotId || 'wf-snap',
          status: 'active',
          publishedAt: new Date().toISOString(),
        }
        const record = {
          resourceId: input.resourceId,
          name: (typeof input.name === 'string' && input.name.trim()) || existing?.name || input.resourceId,
          status: 'active',
          revision: existing ? existing.revision + 1 : 1,
          appId: input.appId,
          workspaceId: input.workspaceId,
          version: ver.version,
          publicationVersionId: ver.publicationVersionId,
          workflowSnapshotId: ver.workflowSnapshotId,
          policyRef: input.policyRef || `pol-${input.resourceId}-${existing ? existing.revision + 1 : 1}`,
          scope: input.scope || existing?.scope || 'org',
          targetOrgs: Array.isArray(input.targetOrgs) ? input.targetOrgs : existing?.targetOrgs ?? [],
          targetAccounts: Array.isArray(input.targetAccounts) ? input.targetAccounts : existing?.targetAccounts ?? [],
          boundaryOrgs: Array.isArray(input.boundaryOrgs) ? input.boundaryOrgs : existing?.boundaryOrgs ?? [],
          usages: Array.isArray(input.usages) ? input.usages : existing?.usages ?? ['web'],
          ownerAccount: input.ownerAccount || existing?.ownerAccount || '',
          versions: [...(existing?.versions ?? []), ver],
        }
        store.put(record.resourceId, record)
        return json(res, record, existing ? 200 : 201)
      }

      const sub = /^\/internal\/v1\/agents\/([^/]+)(?:\/(versions|withdraw))?$/.exec(path)
      check(sub, 404, 'NOT_FOUND')
      const resourceId = decodeURIComponent(sub[1])
      const item = findItem(resourceId)
      check(item, 404, 'NOT_FOUND')

      if (!sub[2] && req.method === 'GET') {
        const {versions: _v, ...summary} = item
        return json(res, summary)
      }
      if (!sub[2] && req.method === 'PUT') {
        const input = await body(req)
        if (input.expectedRevision !== undefined && input.expectedRevision !== null) {
          check(item.revision === input.expectedRevision, 409, 'STALE_SNAPSHOT', '智能体目录修订已变化')
        }
        const nextRev = item.revision + 1
        const ver = {
          publicationVersionId: input.publicationVersionId || `pub-${item.resourceId}-r${nextRev}`,
          version: input.version || `v${nextRev}.0.0`,
          workflowSnapshotId: input.workflowSnapshotId || item.workflowSnapshotId,
          status: 'active',
          publishedAt: new Date().toISOString(),
        }
        const updated = {
          ...item,
          status: 'active',
          revision: nextRev,
          version: ver.version,
          publicationVersionId: ver.publicationVersionId,
          workflowSnapshotId: ver.workflowSnapshotId,
          policyRef: input.policyRef || item.policyRef,
          versions: [...(item.versions ?? []), ver],
        }
        store.put(item.resourceId, updated)
        return json(res, updated)
      }
      if (sub[2] === 'versions' && req.method === 'GET') {
        return json(res, {resourceId: item.resourceId, revision: item.revision, versions: item.versions ?? []})
      }
      if (sub[2] === 'withdraw' && req.method === 'POST') {
        const input = await body(req)
        if (input?.expectedRevision !== undefined && input?.expectedRevision !== null) {
          check(item.revision === input.expectedRevision, 409, 'STALE_SNAPSHOT', '智能体目录修订已变化')
        }
        check(item.status !== 'withdrawn', 409, 'ALREADY_WITHDRAWN')
        const updated = {
          ...item,
          status: 'withdrawn',
          revision: item.revision + 1,
          withdrawnAt: new Date().toISOString(),
          replacementResourceId: input?.replacementResourceId ?? null,
        }
        store.put(item.resourceId, updated)
        return json(res, updated)
      }
      check(false, 405, 'METHOD_NOT_ALLOWED')
    },
    {...options, close: store.close},
  )
}
