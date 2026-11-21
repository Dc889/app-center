import {check, digest} from '../../../../runtime/http.mjs'
import {getDifyPluginDaemonConfig, difyPluginDaemonFetch} from '../../../platform/dify/public.mjs'
import {inspectPluginArchive} from './package-archive.mjs'
import {pluginConsole, verifyPluginWorkspace, listInstalledPlugins} from './dify-client.mjs'

async function uploadApprovedPlugin(command, plugin) {
  await verifyPluginWorkspace(command.payload.workspaceId)
  check(process.env.DIFY_INSTALL_ACCOUNT && command.account === process.env.DIFY_INSTALL_ACCOUNT, 403, 'ACCESS_DENIED', '请求人与已核验安装身份不一致')
  const path = '/plugins/' + encodeURIComponent(command.resourceId) + '/versions/' + encodeURIComponent(command.payload.version)
  const bytes = Buffer.from(await (await plugin(path + '/file')).arrayBuffer())
  check(digest(bytes) === command.payload.sha256, 409, 'STALE_SNAPSHOT')
  const metadata = inspectPluginArchive(bytes)
  check(metadata.version === command.payload.version, 409, 'PLUGIN_VERSION_MISMATCH', '实际归档版本与获准版本不一致')
  const form = new FormData(); form.append('pkg', new Blob([bytes]), 'plugin.difypkg')
  const uploaded = await pluginConsole('/plugin/upload/pkg', {method: 'POST', body: form})
  check(typeof uploaded.unique_identifier === 'string' && uploaded.unique_identifier.startsWith(`${metadata.uniqueIdentifier}:${metadata.version}@`),
    502, 'UPSTREAM_INVALID_RESPONSE', '产品返回的原生插件身份与获准包不一致')
  return uploaded.unique_identifier
}

export async function installPlugin(command, plugin) {
  const pluginUniqueIdentifier = await uploadApprovedPlugin(command, plugin)
  const accepted = await pluginConsole('/plugin/install/pkg', {method: 'POST', body: {plugin_unique_identifiers: [pluginUniqueIdentifier]}})
  check(typeof accepted.task_id === 'string' && accepted.task_id || accepted.all_installed === true, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 没有返回安装任务或确认')
  return {pluginUniqueIdentifier, workspaceId: command.payload.workspaceId, upstreamTaskId: accepted.task_id ?? null}
}

export async function upgradePlugin(command, plugin, existing) {
  const daemon = getDifyPluginDaemonConfig()
  check(daemon.isReal, 501, 'UPSTREAM_UNSUPPORTED', '本地包原生升级需要已配置的 Plugin Daemon 管理连接')
  const current = await findInstalledPlugin({pluginUniqueIdentifier: existing.uniqueIdentifier, workspaceId: existing.workspaceId})
  check(current && current.id === existing.productInstallationId, 409, 'PLUGIN_INSTALLATION_CHANGED', '原生安装实例已变化')
  const pluginUniqueIdentifier = await uploadApprovedPlugin(command, plugin)
  const res = await difyPluginDaemonFetch(`/plugin/${encodeURIComponent(existing.workspaceId)}/management/install/upgrade`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({original_plugin_unique_identifier: existing.uniqueIdentifier, new_plugin_unique_identifier: pluginUniqueIdentifier, source: 'package', meta: {}}),
    timeoutMs: 15000,
  })
  const response = await res.json().catch(() => null)
  check(res.ok && response?.code === 0 && typeof response?.data?.task_id === 'string', 502, 'UPSTREAM_ERROR', 'Plugin Daemon 未确认原生升级任务')
  return {pluginUniqueIdentifier, previousPluginUniqueIdentifier: existing.uniqueIdentifier, workspaceId: existing.workspaceId, upstreamTaskId: response.data.task_id}
}

export async function findInstalledPlugin(task) {
  const list = await listInstalledPlugins(task.workspaceId)
  const item = list.find(plugin => plugin.plugin_unique_identifier === task.pluginUniqueIdentifier)
  if (item) {
    check(!task.previousPluginUniqueIdentifier || !list.some(plugin => plugin.plugin_unique_identifier === task.previousPluginUniqueIdentifier),
      409, 'PLUGIN_UPGRADE_NOT_CONVERGED', '新旧原生实例并存，不能认定升级完成')
    return item
  }
  if (task.upstreamTaskId) {
    const state = await pluginConsole('/plugin/tasks/' + encodeURIComponent(task.upstreamTaskId))
    const failed = ['failed', 'error'].includes(state.task?.status) || state.task?.plugins?.some(plugin =>
      plugin.plugin_unique_identifier === task.pluginUniqueIdentifier && ['failed', 'error'].includes(plugin.status))
    check(!failed, 502, 'PLUGIN_INSTALL_FAILED', '原生插件安装任务已失败，请查证原任务与部署依赖')
  }
  return null
}

export async function installed(task) {return Boolean(await findInstalledPlugin(task))}
