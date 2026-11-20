function parseOwnerMap(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function getDifyConfig() {
  const base = process.env.DIFY_API_BASE ?? process.env.DIFY_API_URL
  const token = process.env.DIFY_CONSOLE_TOKEN ?? process.env.DIFY_API_KEY
  const workspaceId = process.env.DIFY_WORKSPACE_ID ?? null
  const isReal = Boolean(base && token)
  return {base, token, workspaceId, isReal}
}

let refreshInFlight = null
export async function refreshDifyConsoleToken() {
  const base = process.env.DIFY_API_BASE ?? process.env.DIFY_API_URL
  const email = process.env.DIFY_CONSOLE_EMAIL
  const password = process.env.DIFY_CONSOLE_PASSWORD
  if (!base || !email || !password) return null
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${base}/console/api/login`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({email, password, remember_me: true}),
          signal: AbortSignal.timeout(10000),
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.result === 'success' && typeof data?.data?.access_token === 'string') {
          process.env.DIFY_CONSOLE_TOKEN = data.data.access_token
          return data.data.access_token
        }
      } catch {
        // Ignore refresh error; caller will report original 401.
      } finally {
        refreshInFlight = null
      }
      return null
    })()
  }
  return refreshInFlight
}

export async function difyConsoleFetch(path, {method = 'GET', headers = {}, body, timeoutMs = 15000} = {}) {
  const {base, token, isReal} = getDifyConfig()
  if (!isReal) throw Object.assign(new Error('未配置真实 Dify 连接凭证'), {status: 501, code: 'UPSTREAM_UNSUPPORTED'})
  const url = path.startsWith('http://') || path.startsWith('https://') ? path : `${base}${path}`
  const buildInit = currentToken => ({
    method,
    headers: {
      Authorization: `Bearer ${currentToken}`,
      ...headers,
    },
    ...(body !== undefined ? {body} : {}),
    signal: AbortSignal.timeout(timeoutMs),
  })
  let res = await fetch(url, buildInit(token))
  if (res.status === 401) {
    const refreshed = await refreshDifyConsoleToken()
    if (refreshed) res = await fetch(url, buildInit(refreshed))
  }
  return res
}

// 部署级所有者映射：真实 Dify/RAGFlow 只有 created_by(UUID/邮箱)，需显式映射到平台账号名。
// DIFY_OWNER_ACCOUNT_MAP='{"<created_by或邮箱>":"chen.yu"}'；未映射时保留产品原始身份，不假定平台所有者。
export function resolveProductOwner(candidates, {product = 'DIFY'} = {}) {
  const map = parseOwnerMap(process.env[`${product}_OWNER_ACCOUNT_MAP`])
  for (const c of candidates) {
    if (typeof c === 'string' && c && Object.hasOwn(map, c)) return String(map[c])
  }
  return candidates.find(c => typeof c === 'string' && c) ?? ''
}


export function getDifyPluginDaemonConfig() {
  const base = process.env.DIFY_PLUGIN_DAEMON_BASE
  const token = process.env.DIFY_PLUGIN_DAEMON_KEY
  return {base, token, isReal: Boolean(base && token)}
}
