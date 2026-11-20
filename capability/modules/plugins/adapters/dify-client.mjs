import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'

export async function pluginConsole(path, {method = 'GET', body} = {}) {
  const {base, token, isReal} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 插件连接')
  const res = await fetch(`${base}/console/api/workspaces/current${path}`, {method,
    headers: {authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? {'content-type': 'application/json'} : {})},
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000)})
  check(res.ok, res.status >= 500 ? 502 : res.status, 'UPSTREAM_ERROR', `Dify 插件接口 HTTP ${res.status}`)
  const data = await res.json().catch(() => null)
  check(data && typeof data === 'object', 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 插件响应无法解析')
  return data
}

export async function verifyPluginWorkspace(workspaceId) {
  const cfg = getDifyConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 插件连接')
  check(workspaceId && cfg.workspaceId === workspaceId, 403, 'ACCESS_DENIED', '目标工作区与已核验身份不一致')
  const current = await pluginConsole('')
  check(current.id === workspaceId, 403, 'ACCESS_DENIED', 'Dify 当前工作区已变化')
}

export async function listInstalledPlugins(workspaceId) {
  await verifyPluginWorkspace(workspaceId)
  const rows = [], ids = new Set()
  let total
  for (let page = 1;;page++) {
    const data = await pluginConsole(`/plugin/list?page=${page}&page_size=100`)
    check(Array.isArray(data.plugins) && Number.isSafeInteger(data.total) && data.total >= 0, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 插件清单不完整')
    if (total === undefined) total = data.total
    check(total === data.total, 409, 'PLUGIN_INVENTORY_CHANGED', '产品安装清单在分页期间变化，请重新读取')
    for (const item of data.plugins) {
      check(item && typeof item.id === 'string' && item.id && item.tenant_id === workspaceId &&
        typeof item.plugin_unique_identifier === 'string' && item.plugin_unique_identifier && !ids.has(item.id),
        502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 插件实例标识或范围无效')
      ids.add(item.id); rows.push(item)
    }
    if (rows.length >= total) {check(rows.length === total, 502, 'UPSTREAM_INVALID_RESPONSE'); return rows}
    check(data.plugins.length > 0 && page < 10000, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 插件分页未完成')
  }
}
