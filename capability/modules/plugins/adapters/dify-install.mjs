import {check, digest} from '../../../../runtime/http.mjs'
import {getDifyPluginDaemonConfig, difyPluginDaemonFetch} from '../../../platform/dify/public.mjs'
import {inspectPluginArchive} from './package-archive.mjs'
import {pluginConsole, verifyPluginWorkspace, listInstalledPlugins} from './dify-client.mjs'

async function uploadApprovedPlugin(command, plugin) {
  const workspaceId = command.payload.workspaceId
  const path = '/plugins/' + encodeURIComponent(command.resourceId) + '/versions/' + encodeURIComponent(command.payload.version)
  const bytes = Buffer.from(await (await plugin(path + '/file')).arrayBuffer())
  check(digest(bytes) === command.payload.sha256, 409, 'STALE_SNAPSHOT')
  const metadata = inspectPluginArchive(bytes)
  check(metadata.version === command.payload.version, 409, 'PLUGIN_VERSION_MISMATCH', '实际归档版本与获准版本不一致')

  const daemon = getDifyPluginDaemonConfig()
  if (daemon.isReal) {
    const form = new FormData()
    form.append('dify_pkg', new Blob([bytes]), 'plugin.difypkg')
    const upRes = await difyPluginDaemonFetch(`/plugin/${encodeURIComponent(workspaceId)}/management/install/upload/package`, {
      method: 'POST',
      body: form,
      timeoutMs: 30000,
    })
    const upJson = await upRes.json().catch(() => null)
    const uid = upJson?.data?.unique_identifier || upJson?.unique_identifier
    if (upRes.ok && typeof uid === 'string' && uid) {
      return {uniqueIdentifier: uid, viaDaemon: true}
    }
  }

  await verifyPluginWorkspace(workspaceId)
  const form = new FormData(); form.append('pkg', new Blob([bytes]), 'plugin.difypkg')
  const uploaded = await pluginConsole('/plugin/upload/pkg', {method: 'POST', body: form})
  check(typeof uploaded.unique_identifier === 'string' && uploaded.unique_identifier.startsWith(`${metadata.uniqueIdentifier}:${metadata.version}@`),
    502, 'UPSTREAM_INVALID_RESPONSE', '产品返回的原生插件身份与获准包不一致')
  return {uniqueIdentifier: uploaded.unique_identifier, viaDaemon: false}
}

export async function installPlugin(command, plugin) {
  const workspaceId = command.payload.workspaceId
  const {uniqueIdentifier: pluginUniqueIdentifier, viaDaemon} = await uploadApprovedPlugin(command, plugin)
  if (viaDaemon) {
    const instRes = await difyPluginDaemonFetch(`/plugin/${encodeURIComponent(workspaceId)}/management/install/identifiers`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({plugin_unique_identifiers: [pluginUniqueIdentifier], source: 'package', metas: [{}]}),
      timeoutMs: 30000,
    })
    const instJson = await instRes.json().catch(() => null)
    const taskId = instJson?.data?.task_id ?? instJson?.task_id ?? null
    const allInstalled = instJson?.data?.all_installed === true || instJson?.all_installed === true
    check(instRes.ok && (taskId || allInstalled || instJson?.code === 0), 502, 'UPSTREAM_INVALID_RESPONSE', 'Plugin Daemon 未确认插件安装任务')
    return {pluginUniqueIdentifier, workspaceId, upstreamTaskId: taskId, viaDaemon: true}
  }
  const accepted = await pluginConsole('/plugin/install/pkg', {method: 'POST', body: {plugin_unique_identifiers: [pluginUniqueIdentifier]}})
  check(typeof accepted.task_id === 'string' && accepted.task_id || accepted.all_installed === true, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 没有返回安装任务或确认')
  return {pluginUniqueIdentifier, workspaceId, upstreamTaskId: accepted.task_id ?? null, viaDaemon: false}
}

export async function upgradePlugin(command, plugin, existing) {
  const daemon = getDifyPluginDaemonConfig()
  check(daemon.isReal, 501, 'UPSTREAM_UNSUPPORTED', '本地包原生升级需要已配置的 Plugin Daemon 管理连接')
  const current = await findInstalledPlugin({pluginUniqueIdentifier: existing.uniqueIdentifier, workspaceId: existing.workspaceId})
  check(current && current.id === existing.productInstallationId, 409, 'PLUGIN_INSTALLATION_CHANGED', '原生安装实例已变化')
  const {uniqueIdentifier: pluginUniqueIdentifier} = await uploadApprovedPlugin(command, plugin)
  const res = await difyPluginDaemonFetch(`/plugin/${encodeURIComponent(existing.workspaceId)}/management/install/upgrade`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({original_plugin_unique_identifier: existing.uniqueIdentifier, new_plugin_unique_identifier: pluginUniqueIdentifier, source: 'package', meta: {}}),
    timeoutMs: 15000,
  })
  const response = await res.json().catch(() => null)
  check(res.ok && response?.code === 0 && typeof response?.data?.task_id === 'string', 502, 'UPSTREAM_ERROR', 'Plugin Daemon 未确认原生升级任务')
  return {pluginUniqueIdentifier, previousPluginUniqueIdentifier: existing.uniqueIdentifier, workspaceId: existing.workspaceId, upstreamTaskId: response.data.task_id, viaDaemon: true}
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
