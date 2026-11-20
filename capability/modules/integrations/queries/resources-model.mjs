import {check} from '../../../../runtime/http.mjs'
import {fetchAllModels} from '../adapters/dify-models.mjs'

export async function listModels({query}) {
  const workspaceId = query.get('workspaceId') || null
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const cursor = query.get('cursor') ?? ''
  const limitRaw = query.get('limit')
  const limit = limitRaw ? Number(limitRaw) : 50
  check(Number.isInteger(limit) && limit >= 1 && limit <= 100, 400, 'INVALID_QUERY')

  const all = await fetchAllModels({workspaceId})
  const filtered = all
    .filter(m => !q || (m.name + ' ' + m.resourceId).toLowerCase().includes(q))
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId))
  const start = cursor ? filtered.findIndex(r => r.resourceId > cursor) : 0
  const slice = start < 0 ? [] : filtered.slice(start, start + limit)
  const hasMore = start >= 0 && start + limit < filtered.length

  return {
    items: slice.map(({resourceId, name, source, workspaceId: ws}) => ({resourceId, name, source, workspaceId: ws})),
    nextCursor: hasMore ? slice.at(-1).resourceId : null,
  }
}

export async function modelDetail({resourceId, query}) {
  const workspaceId = query.get('workspaceId') || null
  const all = await fetchAllModels({workspaceId})
  const item = all.find(m => m.resourceId === resourceId)
  check(item, 404, 'NOT_FOUND', '模型资源不存在')
  return item
}

export const modelResource = Object.freeze({
  list: listModels,
  detail: modelDetail,
})
