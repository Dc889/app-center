import {check, id} from '../../../../runtime/http.mjs'

export const resources = Object.freeze({
  async list({clients, query}) {
    const q = (query?.get('q') ?? '').trim().toLowerCase()
    let items = []
    try {
      const data = await (await clients.skill('/skills')).json()
      items = (data.items ?? []).map(s => ({
        resourceId: s.resourceId,
        name: s.name,
        source: 'skill_repo',
        workspaceId: null,
      }))
    } catch (err) {
      if (process.env.CAPABILITY_STRICT_UPSTREAM === '1' || err.code !== 'REPOSITORY_UNCONFIGURED') throw err
    }
    return {
      items: items.filter(i => !q || (i.name + i.resourceId).toLowerCase().includes(q)),
      nextCursor: null,
    }
  },
  async detail({clients, resourceId}) {
    const item = await (await clients.skill('/skills/' + encodeURIComponent(resourceId))).json()
    check(item, 404, 'NOT_FOUND')
    return {
      snapshotId: `skill-res-${id()}`,
      resourceId: item.resourceId,
      workspaceId: null,
      capturedAt: new Date().toISOString(),
      data: {
        name: item.name,
        version: item.version,
        sha256: item.sha256,
        sizeBytes: item.sizeBytes,
        status: item.status,
        revision: item.revision,
      },
    }
  },
})
