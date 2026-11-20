import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'

export async function revokeDifyApiKey(command) {
  const {base, token, isReal} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

  const appId = command.appId || command.payload?.appId || command.resourceId
  const keyId = command.keyId || command.payload?.keyId
  check(typeof appId === 'string' && appId.trim(), 400, 'INVALID_REQUEST', '缺少 Dify 应用 ID')
  check(typeof keyId === 'string' && keyId.trim(), 400, 'INVALID_REQUEST', '缺少 Dify 密钥 ID')

  const response = await fetch(
    `${base}/console/api/apps/${encodeURIComponent(appId)}/api-keys/${encodeURIComponent(keyId)}`,
    {
      method: 'DELETE',
      headers: {Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) {
    throw Error(`Dify 撤销密钥失败: HTTP ${response.status}`)
  }

  return {
    appId,
    keyId,
    status: '已撤销',
  }
}
