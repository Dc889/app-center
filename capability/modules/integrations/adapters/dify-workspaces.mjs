import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'


export async function listDifyWorkspaces({cursor = '', limit = 50} = {}) {
  const {base, token, isReal} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置已核验的 Dify 工作区连接')
  let rows
  {
    const response = await fetch(`${base}/console/api/workspaces`, {
      headers: {Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(15000),
    })
    check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 工作区查询失败: HTTP ${response.status}`)
    const data = await response.json()
    const raw = Array.isArray(data.workspaces) ? data.workspaces : Array.isArray(data.data) ? data.data : null
    check(raw, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 工作区列表响应格式错误')
    rows = raw
      .filter(w => w && typeof w.id === 'string' && w.id.trim() && w.status !== 'archive')
      .map(w => ({workspaceId: w.id.trim(), name: (typeof w.name === 'string' && w.name.trim()) || w.id.trim()}))
  }

  const sorted = rows.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))
  const start = cursor ? sorted.findIndex(r => r.workspaceId > cursor) : 0
  const slice = start < 0 ? [] : sorted.slice(start, start + limit)
  const hasMore = start >= 0 && start + limit < sorted.length
  return {
    items: slice,
    nextCursor: hasMore ? slice.at(-1).workspaceId : null,
  }
}
