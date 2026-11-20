import {check, id} from '../../../../runtime/http.mjs'

export const resources = Object.freeze({
  async list({clients, query}) {
    const ws = query?.get('workspaceId') || null
    const q = (query?.get('q') ?? '').trim().toLowerCase()
    let items = []
    try {
      const data = await (await clients.plugin('/plugins')).json()
      items = (data.items ?? []).map(p => ({
        resourceId: p.resourceId,
        name: p.name,
        source: 'plugin_repo',
        workspaceId: ws,
      }))
    } catch (err) {
      if (process.env.CAPABILITY_STRICT_UPSTREAM === '1' || err.code !== 'REPOSITORY_UNCONFIGURED') throw err
    }
    return {
      items: items.filter(i => !q || (i.name + i.resourceId).toLowerCase().includes(q)),
      nextCursor: null,
    }
  },
  async detail({clients, resourceId, query}) {
    const ws = query?.get('workspaceId') || null
    const item = await (await clients.plugin('/plugins/' + encodeURIComponent(resourceId))).json()
    check(item, 404, 'NOT_FOUND')
    return {
      snapshotId: `plugin-res-${id()}`,
      resourceId: item.resourceId,
      workspaceId: ws,
      capturedAt: new Date().toISOString(),
      data: {
        name: item.name,
        version: item.version,
        sha256: item.sha256,
        status: item.status,
        revision: item.revision,
      },
    }
  },
})
