import {randomUUID} from 'node:crypto'
import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'
export async function createDifyApiKey(command) {
  const { base, token, isReal } = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

  const appId = command.resourceId || command.payload?.appId || 'app'
  const response = await fetch(`${base}/console/api/apps/${encodeURIComponent(appId)}/api-keys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw Error(`Dify 接口调用失败: HTTP ${response.status}`)
  }

  const data = await response.json()
  const secret = data.token || data.key || ''
  const lastFour = secret.slice(-4) || '9999'

  return {
    keyId: data.id || `key-${randomUUID().slice(0, 8)}`,
    lastFour,
    secret,
    apiBase: `${base}/v1`,
  }
}

/**
 * KEY-02: 轮换 Dify API 密钥
 */
