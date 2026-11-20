import {check} from '../../../../runtime/http.mjs'
import {expectedSkillRevision, readSkillApprovedInput} from './approved-input.mjs'

export async function execute(context) {
  const {command, state, skill, clients, openLedger} = context
  const approved = await readSkillApprovedInput(clients, command)
  const expectedRevision = expectedSkillRevision(approved, command.resourceId)
  const fields = approved.fields
  const intakeId = fields.intakeId
  check(typeof intakeId === 'string' && intakeId, 409, 'MISSING_INTAKE_REF', '获准输入缺少新版本上传件引用')

  const intake = openLedger('intake').get(intakeId)
  check(intake && intake.status === 'ready' && intake.scan?.verdict === 'passed', 409, 'UPLOAD_NOT_APPROVED', '新版本上传件尚未通过扫描')
  if (fields['新文件SHA-256']) {
    check(intake.sha256 === fields['新文件SHA-256'], 409, 'STALE_SNAPSHOT', '新版本上传件摘要与审批指纹不一致')
  }

  const updated = await (
    await skill('/skills/' + encodeURIComponent(command.resourceId) + '/versions', 'PUT', {
      version: fields['新版本号'],
      sha256: intake.sha256,
      filename: intake.filename,
      contentType: intake.contentType,
      contentBase64: intake.contentBase64,
      expectedRevision,
      historyPolicy: fields['历史版本下载策略'] ?? '',
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
      historyPolicy: fields['历史版本下载策略'] ?? '',
    },
  }
}
