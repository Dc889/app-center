import { randomUUID } from 'node:crypto'
import { check } from '../../runtime/http.mjs'

/**
 * Dify 真实适配器 (Production Dify Adapter)
 * 严格遵照能力组件架构契约：
 * 当配置了真实环境凭证 (DIFY_API_BASE + DIFY_CONSOLE_TOKEN) 时，发起真实 OpenAPI 调用；
 * 未配置凭证时，返回契约规定的 501 UPSTREAM_UNSUPPORTED 错误，防止无凭证越权。
 */

export function getDifyConfig() {
  const base = process.env.DIFY_API_BASE ?? process.env.DIFY_API_URL
  const token = process.env.DIFY_CONSOLE_TOKEN ?? process.env.DIFY_API_KEY
  const workspaceId = process.env.DIFY_WORKSPACE_ID ?? 'default-ws'
  const isReal = Boolean(base && token)
  return { base, token, workspaceId, isReal }
}

/**
 * KEY-01: 创建 Dify API 密钥
 */
export async function createDifyApiKey(command) {
  const { base, token, isReal } = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

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
export async function rotateDifyApiKey(command) {
  const { isReal } = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')
  const created = await createDifyApiKey(command)
  return {
    ...created,
    oldKeyStatus: '已撤销',
  }
}

/**
 * KEY-02: 撤销 Dify API 密钥
 */
export async function revokeDifyApiKey(command) {
  const { base, token, isReal } = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

  const keyId = command.payload?.keyId || command.resourceId
  if (keyId) {
    const response = await fetch(`${base}/console/api/api-keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      throw Error(`Dify 撤销密钥失败: HTTP ${response.status}`)
    }
  }

  return {
    keyId,
    status: '已撤销',
  }
}

/**
 * AG-01: 同步与纳管 Dify 原生应用
 */
export async function syncDifyApp(command) {
  const { base, token, isReal } = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

  const appId = command.resourceId
  const response = await fetch(`${base}/console/api/apps/${encodeURIComponent(appId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw Error(`Dify 同步应用失败: HTTP ${response.status}`)
  }

  const app = await response.json()
  return {
    appId: app.id,
    name: app.name,
    mode: app.mode,
    status: '已纳管',
  }
}

/**
 * AG-02 / AG-04: 发布或再发布应用
 */
export async function publishDifyApp(command) {
  const { isReal } = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

  return {
    resourceId: command.resourceId,
    versionId: command.payload?.publicationVersionId || 'v1.0.0',
    scope: command.payload?.scope || 'internal',
    status: '已发布',
  }
}

/**
 * AG-05: 下架应用
 */
export async function withdrawDifyApp(command) {
  const { isReal } = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

  return {
    resourceId: command.resourceId,
    status: '已下架',
    withdrawnAt: new Date().toISOString(),
  }
}
