import {check} from '../../../../runtime/http.mjs'
import {pluginConsole, listInstalledPlugins} from './dify-client.mjs'

export async function uninstallDifyPlugin({productInstallationId, workspaceId, uniqueIdentifier}) {
  check(typeof productInstallationId === 'string' && productInstallationId && typeof uniqueIdentifier === 'string' && uniqueIdentifier,
    501, 'UPSTREAM_UNSUPPORTED', '缺少原生产品实例映射，不用平台台账 ID 猜测卸载对象')
  const before = await listInstalledPlugins(workspaceId)
  const current = before.find(item => item.id === productInstallationId)
  check(!current || current.plugin_unique_identifier === uniqueIdentifier, 409, 'PLUGIN_INSTALLATION_CHANGED', '原生实例版本已变化')
  check(current || !before.some(item => item.plugin_unique_identifier === uniqueIdentifier), 409, 'PLUGIN_INSTALLATION_CHANGED', '同版本原生实例已重新创建，需按新实例申请')
  if (current) {
    const result = await pluginConsole('/plugin/uninstall', {method: 'POST', body: {plugin_installation_id: productInstallationId}})
    check(result.success === true, 502, 'PLUGIN_UNINSTALL_FAILED', '原生产品没有确认卸载成功')
  }
  const after = await listInstalledPlugins(workspaceId)
  check(!after.some(item => item.id === productInstallationId || item.plugin_unique_identifier === uniqueIdentifier),
    502, 'PLUGIN_UNINSTALL_READBACK_FAILED', '产品实例仍存在，不能认定已卸载')
  return {productInstallationId, workspaceId, uninstalled: true}
}

export async function setDifyPluginState({productInstallationId, workspaceId, action}) {
  check(productInstallationId && workspaceId && ['disable_plugin', 'restore_plugin'].includes(action), 501, 'UPSTREAM_UNSUPPORTED', '缺少已核验的原生状态切换支持')
  check(false, 501, 'UPSTREAM_UNSUPPORTED', 'Dify 1.7.1 没有通用插件停用/恢复接口，实际调用阻断适配器尚未实现')
}
