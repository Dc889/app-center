import {check} from '../../../../runtime/http.mjs'
import {uninstallDifyPlugin} from '../adapters/dify-uninstall.mjs'
import {findInstallation, readPluginApprovedInput, upsertInstallation} from '../adapters/installations-store.mjs'

export async function execute(context) {
  const {command, state, clients, openLedger} = context
  const approved = await readPluginApprovedInput(clients, command)
  const fields = approved.fields
  const installationId = fields['安装实例ID']
  const workspaceId = fields['目标Dify workspace ID']
  check(installationId && workspaceId, 409, 'INCOMPLETE_PLUGIN_OPERATION')

  const instPre = approved.preconditions.find(p => p && p.kind === 'plugin_installation' && p.id === installationId)
  check(instPre && Number.isInteger(instPre.revision), 409, 'STALE_SNAPSHOT')

  const instDb = openLedger('installations')
  const existing = findInstallation(instDb, {installationId, resourceId: command.resourceId, workspaceId})
  check(existing && existing.status !== '已卸载', 404, 'NOT_FOUND', '待卸载的安装实例不存在')
  check(existing.revision === instPre.revision, 409, 'STALE_SNAPSHOT', '插件安装实例修订已变化')

  await uninstallDifyPlugin({productInstallationId: existing.productInstallationId, workspaceId, uniqueIdentifier: existing.uniqueIdentifier})
  const updated = upsertInstallation(instDb, {
    ...existing,
    status: '已卸载',
  })

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: updated.installationId,
    version: existing.version,
    sha256: existing.sha256,
    details: {
      installationId: updated.installationId,
      workspaceId: updated.workspaceId,
      status: updated.status,
      revision: updated.revision,
    },
  }
}
