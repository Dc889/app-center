import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'
import {revokeDifyApiKey} from '../adapters/revokeDifyApiKey.mjs'
import {transitionRegistration} from '../adapters/registration-store.mjs'
import {expectedRegistrationRevision, readApprovedInput} from './approved-input.mjs'

export async function execute(context) {
  check(getDifyConfig().isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')
  const {command, state, clients, openLedger} = context
  const approved = await readApprovedInput(clients, command)
  const expectedRevision = expectedRegistrationRevision(approved, command.resourceId)
  const db = openLedger('registrations')
  const existing = db.get(command.resourceId)
  check(existing, 404, 'NOT_FOUND', '待撤销的密钥登记不存在')
  check(['active', 'expired'].includes(existing.status), 409, 'INVALID_KEY_STATE', '当前密钥状态不允许撤销')
  if (expectedRevision !== null) {
    check(existing.revision === expectedRevision, 409, 'STALE_SNAPSHOT', '密钥登记修订已变化，请重新读取')
  }

  await revokeDifyApiKey({
    ...command,
    appId: existing.appId,
    keyId: existing.keyId,
  })

  const updated = transitionRegistration(db, existing.registrationId, existing.revision, 'revoked')

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: updated.registrationId,
    version: String(updated.revision),
    sha256: '',
    details: {
      '密钥登记ID': updated.registrationId,
      'Dify密钥ID': existing.keyId,
      '旧密钥撤销结果': '成功撤销',
      status: '已撤销',
    },
  }
}
