import {check} from '../../../../runtime/http.mjs'
import {installPlugin, installed} from '../adapters/dify-install.mjs'
import {findInstallation, readPluginApprovedInput, upsertInstallation} from '../adapters/installations-store.mjs'

export async function execute(context) {
  const {command, state, row, plugin, clients, store, openLedger} = context
  const approved = await readPluginApprovedInput(clients, command)
  const fields = approved.fields
  const installationId = fields['安装实例ID']
  const workspaceId = fields['目标Dify workspace ID']
  const targetVersion = fields['批准版本号']
  const targetSha256 = fields['版本指纹']
  check(installationId && workspaceId && targetVersion && targetSha256, 409, 'INCOMPLETE_PLUGIN_OPERATION')

  const instPre = approved.preconditions.find(p => p && p.kind === 'plugin_installation' && p.id === installationId)
  check(instPre && Number.isInteger(instPre.revision), 409, 'STALE_SNAPSHOT')

  const instDb = openLedger('installations')
  const existing = findInstallation(instDb, {installationId, resourceId: command.resourceId, workspaceId})
  check(existing && existing.status !== '已卸载', 404, 'NOT_FOUND', '待升级的安装实例不存在')
  check(existing.revision === instPre.revision, 409, 'STALE_SNAPSHOT', '插件安装实例修订已变化')

  state.status = 'reconciling'
  store.put(command.executionId, row)
  const task = await installPlugin(
    {...command, payload: {workspaceId, version: targetVersion, sha256: targetSha256}},
    plugin,
  )
  row.productTask = {...task, installationId, version: targetVersion, sha256: targetSha256, pluginName: fields['插件名称'] || existing.pluginName}
}

export async function reconcileUpgrade({row, store, stamp, openLedger}) {
  if (!row.productTask) return
  if (await installed(row.productTask)) {
    const t = row.productTask
    if (openLedger) {
      upsertInstallation(openLedger('installations'), {
        installationId: t.installationId,
        resourceId: row.command.resourceId,
        pluginName: t.pluginName,
        workspaceId: t.workspaceId,
        version: t.version,
        sha256: t.sha256,
        uniqueIdentifier: t.pluginUniqueIdentifier,
        account: row.command.account,
        status: '已启用',
      })
    }
    row.state.status = 'succeeded'
    row.state.updatedAt = stamp()
    row.state.result = {
      ok: true,
      failureCode: '',
      failureReason: '',
      retryable: false,
      resultId: t.installationId || t.pluginUniqueIdentifier,
      version: t.version,
      sha256: t.sha256,
      details: t,
    }
    store.put(row.command.executionId, row)
  }
}
