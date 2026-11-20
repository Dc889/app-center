import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'

export async function uninstallDifyPlugin({installationId, workspaceId}) {
  const {base, token, isReal} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 插件运维身份')

  const response = await fetch(`${base}/console/api/workspaces/current/plugin/uninstall`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({plugin_installation_id: installationId, workspace_id: workspaceId}),
    signal: AbortSignal.timeout(15000),
  })
  check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 插件卸载失败: HTTP ${response.status}`)
  return {installationId, workspaceId, uninstalled: true}
}

export async function setDifyPluginState({installationId, workspaceId, action}) {
  const {base, token, isReal} = getDifyConfig()
  if (!isReal) {
    check(process.env.CAPABILITY_STRICT_UPSTREAM !== '1', 501, 'UPSTREAM_UNSUPPORTED', '未配置已核验的 Dify 插件运维身份')
    return {installationId, workspaceId, state: action === 'disable_plugin' ? '已禁用' : '已启用', mode: 'ledger'}
  }
  const route = action === 'disable_plugin' ? 'disable' : 'enable'
  const response = await fetch(`${base}/console/api/workspaces/current/plugin/${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({plugin_installation_id: installationId, workspace_id: workspaceId}),
    signal: AbortSignal.timeout(15000),
  })
  check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 插件状态切换失败: HTTP ${response.status}`)
  return {installationId, workspaceId, state: action === 'disable_plugin' ? '已禁用' : '已启用', mode: 'dify'}
}
