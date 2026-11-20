import {createDifyApiKey} from './createDifyApiKey.mjs'
import {revokeDifyApiKey} from './revokeDifyApiKey.mjs'
import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'

export async function rotateDifyApiKey(command) {
  const {isReal} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

  const appId = command.appId || command.payload?.appId || command.resourceId
  const oldKeyId = command.oldKeyId || command.payload?.oldKeyId || command.payload?.keyId
  check(typeof appId === 'string' && appId.trim(), 400, 'INVALID_REQUEST', '缺少 Dify 应用 ID')
  check(typeof oldKeyId === 'string' && oldKeyId.trim(), 400, 'INVALID_REQUEST', '缺少待撤销的旧密钥 ID')

  const created = await createDifyApiKey({...command, resourceId: appId})
  await revokeDifyApiKey({appId, keyId: oldKeyId})

  return {
    ...created,
    appId,
    oldKeyId,
    oldKeyStatus: '成功撤销',
  }
}
