import {check} from '../../../../runtime/http.mjs'
import {setDifyPluginState} from '../adapters/dify-uninstall.mjs'
import {findInstallation, readPluginApprovedInput, upsertInstallation} from '../adapters/installations-store.mjs'

export async function execute(context) {
  const {command, state, clients, openLedger} = context
  const approved = await readPluginApprovedInput(clients, command)
  const fields = approved.fields
  const installationId = fields['安装实例ID']
  const workspaceId = fields['workspace ID']
  check(installationId && workspaceId, 409, 'MISSING_PLUGIN_INSTANCE')

  const instPre = approved.preconditions.find(p => p && p.kind === 'plugin_installation' && p.id === installationId)
  check(instPre && Number.isInteger(instPre.revision), 409, 'STALE_SNAPSHOT')

  const instDb = openLedger('installations')
  const existing = findInstallation(instDb, {installationId, resourceId: command.resourceId, workspaceId})
  check(existing && existing.status !== '已卸载', 404, 'NOT_FOUND')
  check(existing.revision === instPre.revision, 409, 'STALE_SNAPSHOT', '插件安装实例修订已变化')

  const result = await setDifyPluginState({productInstallationId: existing.productInstallationId, workspaceId, action: command.action})
  const updated = upsertInstallation(instDb, {
    ...existing,
    status: result.state,
  })

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: updated.installationId,
    version: updated.version,
    sha256: updated.sha256,
    details: {
      values: {
        '安装实例ID': updated.installationId,
        '插件状态': updated.status,
      },
      revision: updated.revision,
    },
  }
}
