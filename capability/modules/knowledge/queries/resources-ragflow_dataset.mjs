import {id} from '../../../../runtime/http.mjs'
import {listRagflowDatasets, getRagflowDatasetDetail} from '../adapters/ragflow-datasets.mjs'

export const resources = Object.freeze({
  async list({query}) {
    const q = (query.get('q') ?? '').trim().toLowerCase()
    const rows = await listRagflowDatasets()
    const items = rows.filter(item => !q || item.name.toLowerCase().includes(q) || item.resourceId.toLowerCase().includes(q))
    return {items, nextCursor: null}
  },
  async detail({resourceId}) {
    const detail = await getRagflowDatasetDetail(resourceId)
    return {
      snapshotId: `rag-ds-${id()}`,
      resourceId: detail.resourceId,
      workspaceId: null,
      capturedAt: new Date().toISOString(),
      data: {
        tenantId: detail.tenantId,
        name: detail.name,
        ownerAccount: detail.ownerAccount,
        documentCount: detail.documents.length,
        modelVerified: detail.modelVerified,
        manifestSnapshotId: detail.manifestSnapshotId,
        manifestSha256: detail.manifestSha256,
      },
    }
  },
})
