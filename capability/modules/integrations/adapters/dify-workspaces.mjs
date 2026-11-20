import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'

const LOCAL_DEV_WORKSPACES = Object.freeze([
  {workspaceId: 'ws-default', name: '平台核心默认工作区'},
  {workspaceId: 'ws-ops', name: '运营支撑工作区'},
  {workspaceId: 'ws-dev', name: '开发调试工作区'},
])

export async function listDifyWorkspaces({cursor = '', limit = 50} = {}) {
  const {base, token, isReal} = getDifyConfig()
  let rows
  if (isReal) {
    const response = await fetch(`${base}/console/api/workspaces`, {
      headers: {Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(15000),
    })
    check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 工作区查询失败: HTTP ${response.status}`)
    const data = await response.json()
    const raw = Array.isArray(data.workspaces) ? data.workspaces : Array.isArray(data.data) ? data.data : []
    rows = raw
      .filter(w => w && typeof w.id === 'string' && w.id.trim() && w.status !== 'archive')
      .map(w => ({workspaceId: w.id.trim(), name: (typeof w.name === 'string' && w.name.trim()) || w.id.trim()}))
  } else {
    check(process.env.CAPABILITY_STRICT_UPSTREAM !== '1', 501, 'UPSTREAM_UNSUPPORTED', '未配置已核验的 Dify 工作区连接')
    rows = [...LOCAL_DEV_WORKSPACES]
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
