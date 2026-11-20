import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'
import {rotateDifyApiKey} from '../adapters/rotateDifyApiKey.mjs'
import {registerKey, transitionRegistration} from '../adapters/registration-store.mjs'
import {expectedRegistrationRevision, readApprovedInput} from './approved-input.mjs'

export async function execute(context) {
  check(getDifyConfig().isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')
  const {command, state, clients, openLedger} = context
  const approved = await readApprovedInput(clients, command)
  const expectedRevision = expectedRegistrationRevision(approved, command.resourceId)
  const db = openLedger('registrations')
  const existing = db.get(command.resourceId)
  check(existing, 404, 'NOT_FOUND', '待轮换的密钥登记不存在')
  check(['active', 'expired'].includes(existing.status), 409, 'INVALID_KEY_STATE', '当前密钥状态不允许轮换')
  if (expectedRevision !== null) {
    check(existing.revision === expectedRevision, 409, 'STALE_SNAPSHOT', '密钥登记修订已变化，请重新读取')
  }

  const keyInfo = await rotateDifyApiKey({
    ...command,
    appId: existing.appId,
    oldKeyId: existing.keyId,
  })

  transitionRegistration(db, existing.registrationId, existing.revision, 'rotated')
  const {record: created, revealExpiresAt} = registerKey(
    db,
    {
      appId: existing.appId,
      workspaceId: existing.workspaceId,
      keyId: keyInfo.keyId,
      lastFour: keyInfo.lastFour,
      ownerAccount: command.account || existing.ownerAccount,
      ownerOrg: command.org || existing.ownerOrg,
      apiBase: keyInfo.apiBase,
      appName: existing.appName,
      callerName: existing.callerName,
      callerOrg: existing.callerOrg,
      environment: existing.environment,
      publicationTicketNo: existing.publicationTicketNo,
    },
    keyInfo.secret,
  )

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: created.registrationId,
    version: String(existing.revision + 1),
    sha256: '',
    details: {
      '新Dify密钥ID': keyInfo.keyId,
      '新密钥后四位': keyInfo.lastFour,
      '旧密钥撤销结果': keyInfo.oldKeyStatus,
      'Dify API地址': keyInfo.apiBase,
      '新密钥登记ID': created.registrationId,
      registrationId: created.registrationId,
      revealExpiresAt,
    },
  }
}
