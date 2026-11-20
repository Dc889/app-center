import {check} from '../../../../runtime/http.mjs'
import {readPluginApprovedInput} from '../adapters/installations-store.mjs'

export async function execute(context) {
  const {command, state, plugin, clients, openLedger} = context
  const approved = await readPluginApprovedInput(clients, command)
  const fields = approved.fields
  const intakeId = fields.intakeId
  check(typeof intakeId === 'string' && intakeId, 409, 'MISSING_INTAKE_REF')

  const intake = openLedger('intake').get(intakeId)
  check(intake && intake.status === 'ready' && intake.scan?.verdict === 'passed' && intake.packageMetadata, 409, 'UPLOAD_NOT_APPROVED')
  if (fields['审批版本指纹']) {
    check(intake.sha256 === fields['审批版本指纹'], 409, 'STALE_SNAPSHOT')
  }

  const p = intake.packageMetadata
  const published = await (
    await plugin('/plugins', 'POST', {
      resourceId: command.resourceId,
      uniqueIdentifier: p.uniqueIdentifier,
      name: p.name,
      version: p.version,
      sha256: intake.sha256,
      contentBase64: intake.contentBase64,
      installAccess: fields['公开方式'] === '公开免审安装' ? 'instant' : 'approval',
      ownerAccount: fields['发布者账户名'] || command.account,
    })
  ).json()

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: published.resourceId,
    version: published.version,
    sha256: published.sha256,
    details: {
      resourceId: published.resourceId,
      uniqueIdentifier: published.uniqueIdentifier,
      version: published.version,
      revision: published.revision,
      status: published.status,
    },
  }
}
