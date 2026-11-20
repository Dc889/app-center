import {id} from '../../../../runtime/http.mjs'
import {listDifyDatasets, getDifyDatasetDetail} from '../adapters/dify-datasets.mjs'

export const resources = Object.freeze({
  async list({query}) {
    const ws = query.get('workspaceId') || undefined
    const q = (query.get('q') ?? '').trim().toLowerCase()
    const rows = await listDifyDatasets(ws)
    const items = rows.filter(item => !q || item.name.toLowerCase().includes(q) || item.resourceId.toLowerCase().includes(q))
    return {items, nextCursor: null}
  },
  async detail({resourceId, query}) {
    const ws = query.get('workspaceId') || undefined
    const detail = await getDifyDatasetDetail(resourceId, ws)
    return {
      snapshotId: `dify-ds-${id()}`,
      resourceId: detail.resourceId,
      workspaceId: detail.workspaceId,
      capturedAt: new Date().toISOString(),
      data: {
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
