import {check} from '../../../../runtime/http.mjs'
import {readSkillApprovedInput} from './approved-input.mjs'

export async function execute(context) {
  const {command, state, skill, clients, openLedger} = context
  const approved = await readSkillApprovedInput(clients, command)
  const fields = approved.fields
  const intakeId = fields.intakeId
  check(typeof intakeId === 'string' && intakeId, 409, 'MISSING_INTAKE_REF', '获准输入缺少上传件引用')

  const intake = openLedger('intake').get(intakeId)
  check(intake && intake.status === 'ready' && intake.scan?.verdict === 'passed', 409, 'UPLOAD_NOT_APPROVED', '上传件尚未通过扫描')
  if (fields['审批文件指纹']) {
    check(intake.sha256 === fields['审批文件指纹'], 409, 'STALE_SNAPSHOT', '上传件摘要与审批指纹不一致')
  }

  const orgs = fields['公开方式'] === '全员公开' || fields['公开方式'] === 'public' ? [] : Array.isArray(fields['目标组织']) ? fields['目标组织'] : []
  const published = await (
    await skill('/skills', 'POST', {
      resourceId: command.resourceId,
      name: fields['Skill名称'] || command.resourceId,
      version: fields['版本号'] || 'v1.0.0',
      sha256: intake.sha256,
      filename: intake.filename,
      contentType: intake.contentType,
      contentBase64: intake.contentBase64,
      orgs,
      ownerAccount: fields['作者账户名'] || command.account,
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
      version: published.version,
      revision: published.revision,
      status: published.status,
    },
  }
}
