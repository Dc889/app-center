import {check, json} from '../../../../runtime/http.mjs'

export const knowledgeCatalog = Object.freeze({
  async list({openLedger, query, identity, res}) {
    const db = openLedger('datasets')
    const q = (query.get('q') ?? '').trim().toLowerCase()
    const sourceSystem = query.get('sourceSystem') || ''
    const statusFilter = query.get('status') || ''
    const items = db
      .all()
      .filter(row => {
        if (sourceSystem && row.sourceSystem !== sourceSystem) return false
        if (statusFilter && row.status !== statusFilter) return false
        if (
          q &&
          !row.name.toLowerCase().includes(q) &&
          !row.resourceId.toLowerCase().includes(q) &&
          !row.sourceResourceId.toLowerCase().includes(q)
        ) {
          return false
        }
        if (row.status === '已纳管' && identity?.account && row.ownerAccount !== identity.account) {
          const roles = (identity.role ?? '').split(',').map(r => r.trim())
          if (!roles.includes('admin') && !roles.includes('operator')) return false
        }
        return true
      })
      .map(row => ({
        resourceId: row.resourceId,
        name: row.name,
        status: row.status,
        actions:
          row.status === '已纳管'
            ? ['publish_dataset', 'bind_dataset', 'dispose_dataset']
            : row.status === '已发布'
              ? ['bind_dataset', 'review_dataset_changes', 'pause_share', 'dispose_dataset']
              : row.status === '暂停分享'
                ? ['review_dataset_changes', 'dispose_dataset']
                : [],
        data: {
          sourceSystem: row.sourceSystem,
          sourceResourceId: row.sourceResourceId,
          sourceScopeId: row.sourceScopeId,
          ownerAccount: row.ownerAccount,
          documentCount: row.documents?.length ?? 0,
          classification: row.classification ?? '内部',
          businessLine: row.businessLine ?? '通用业务',
          revision: row.revision,
        },
      }))
    return json(res, {items, nextCursor: null})
  },
  async detail({openLedger, resourceId, res}) {
    const row = openLedger('datasets').get(resourceId)
    check(row, 404, 'NOT_FOUND')
    return json(res, {
      snapshotId: `kb-cat-${row.revision}`,
      resourceId: row.resourceId,
      name: row.name,
      status: row.status,
      capturedAt: row.updatedAt ?? new Date().toISOString(),
      data: {
        sourceSystem: row.sourceSystem,
        sourceResourceId: row.sourceResourceId,
        sourceScopeId: row.sourceScopeId,
        ownerAccount: row.ownerAccount,
        documentCount: row.documents?.length ?? 0,
        manifestSnapshotId: row.manifestSnapshotId,
        manifestSha256: row.manifestSha256,
        classification: row.classification ?? '内部',
        businessLine: row.businessLine ?? '通用业务',
        boundaryOrgs: row.boundaryOrgs ?? [],
        policyRef: row.policyRef ?? null,
        relatedAppId: row.relatedAppId ?? null,
        revision: row.revision,
      },
    })
  },
})
