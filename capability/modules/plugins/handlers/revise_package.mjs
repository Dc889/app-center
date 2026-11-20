import {check} from '../../../../runtime/http.mjs'
import {readPluginApprovedInput} from '../adapters/installations-store.mjs'

export async function execute(context) {
  const {command, state, plugin, clients, openLedger} = context
  const approved = await readPluginApprovedInput(clients, command)
  const pre = approved.preconditions.find(p => p && p.kind === 'plugin' && p.id === command.resourceId)
  check(pre && Number.isInteger(pre.revision), 409, 'STALE_SNAPSHOT', '缺少插件目录修订前置条件')

  const fields = approved.fields
  const intake = openLedger('intake').get(fields.intakeId)
  check(intake && intake.status === 'ready' && intake.scan?.verdict === 'passed' && intake.packageMetadata, 409, 'UPLOAD_NOT_APPROVED')
  if (fields['新版本指纹']) {
    check(intake.sha256 === fields['新版本指纹'], 409, 'STALE_SNAPSHOT')
  }

  const p = intake.packageMetadata
  const updated = await (
    await plugin('/plugins/' + encodeURIComponent(command.resourceId) + '/versions', 'PUT', {
      uniqueIdentifier: p.uniqueIdentifier,
      version: p.version,
      sha256: intake.sha256,
      contentBase64: intake.contentBase64,
      expectedRevision: pre.revision,
      upgradePolicy: fields['升级策略'],
    })
  ).json()

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: updated.resourceId,
    version: updated.version,
    sha256: updated.sha256,
    details: {
      resourceId: updated.resourceId,
      version: updated.version,
      revision: updated.revision,
      upgradePolicy: updated.upgradePolicy,
    },
  }
}
