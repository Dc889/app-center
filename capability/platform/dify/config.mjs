function parseOwnerMap(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

let difyConnectorMeta = null

export function setDifyConnectorMeta(meta) {
  difyConnectorMeta = meta ?? null
}

export async function hydrateDifyConnector(token = process.env.DIFY_CONNECTOR_TOKEN ?? process.env.INTERNAL_TOKEN ?? '') {
  const connectorUrl = (process.env.DIFY_CONNECTOR_URL ?? '').replace(/\/$/, '')
  if (!connectorUrl) {
    difyConnectorMeta = null
    return null
  }
  try {
    const res = await fetch(`${connectorUrl}/connector/v1/meta`, {
      headers: token ? {Authorization: `Bearer ${token}`} : {},
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      difyConnectorMeta = await res.json()
      return difyConnectorMeta
    }
  } catch {
    // Keep prior meta if transient failure.
  }
  return difyConnectorMeta
}

export function getDifyConfig() {
  const connectorUrl = (process.env.DIFY_CONNECTOR_URL ?? '').replace(/\/$/, '')
  if (connectorUrl) {
    const token = process.env.DIFY_CONNECTOR_TOKEN ?? process.env.INTERNAL_TOKEN ?? ''
    const workspaceId = process.env.DIFY_WORKSPACE_ID ?? difyConnectorMeta?.workspaceId ?? null
    const configured = difyConnectorMeta ? Boolean(difyConnectorMeta.configured) : true
    return {
      mode: 'connector',
      connectorUrl,
      base: `${connectorUrl}/connector/v1/console`,
      token,
      workspaceId,
      adapterVersion: difyConnectorMeta?.adapterVersion ?? process.env.DIFY_VERSION ?? '1.7.1',
      isReal: configured,
    }
  }
  const base = (process.env.DIFY_API_BASE ?? process.env.DIFY_API_URL ?? '').replace(/\/$/, '') || undefined
  const token = process.env.DIFY_CONSOLE_TOKEN ?? process.env.DIFY_API_KEY
  const workspaceId = process.env.DIFY_WORKSPACE_ID ?? null
  const isReal = Boolean(base && token)
  return {mode: 'direct', connectorUrl: null, base, token, workspaceId, adapterVersion: process.env.DIFY_VERSION ?? '1.7.1', isReal}
}

let refreshInFlight = null
export async function refreshDifyConsoleToken() {
  if (process.env.DIFY_CONNECTOR_URL) return null
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
  const cfg = getDifyConfig()
  if (!cfg.isReal) throw Object.assign(new Error('未配置真实 Dify 连接凭证'), {status: 501, code: 'UPSTREAM_UNSUPPORTED'})
  const url = path.startsWith('http://') || path.startsWith('https://') ? path : `${cfg.base}${path}`
  const buildInit = currentToken => ({
    method,
    headers: {
      ...(currentToken ? {Authorization: `Bearer ${currentToken}`} : {}),
      ...headers,
    },
    ...(body !== undefined ? {body} : {}),
    signal: AbortSignal.timeout(timeoutMs),
  })
  let res = await fetch(url, buildInit(cfg.token))
  if (cfg.mode === 'direct' && res.status === 401) {
    const refreshed = await refreshDifyConsoleToken()
    if (refreshed) res = await fetch(url, buildInit(refreshed))
  }
  return res
}

// 部署级所有者映射：真实 Dify/RAGFlow 只有 created_by(UUID/邮箱)，需显式映射到平台账号名。
export function resolveProductOwner(candidates, {product = 'DIFY'} = {}) {
  const envMap = parseOwnerMap(process.env[`${product}_OWNER_ACCOUNT_MAP`])
  const connectorMap = product === 'DIFY' && difyConnectorMeta?.ownerMap ? difyConnectorMeta.ownerMap : {}
  const map = {...connectorMap, ...envMap}
  for (const c of candidates) {
    if (typeof c === 'string' && c && Object.hasOwn(map, c)) return String(map[c])
  }
  return candidates.find(c => typeof c === 'string' && c) ?? ''
}

export function getDifyPluginDaemonConfig() {
  const connectorUrl = (process.env.DIFY_CONNECTOR_URL ?? '').replace(/\/$/, '')
  if (connectorUrl && difyConnectorMeta?.pluginDaemonConfigured) {
    const token = process.env.DIFY_CONNECTOR_TOKEN ?? process.env.INTERNAL_TOKEN ?? ''
    return {
      mode: 'connector',
      connectorUrl,
      base: `${connectorUrl}/connector/v1/plugin-daemon`,
      token,
      isReal: true,
    }
  }
  const base = process.env.DIFY_PLUGIN_DAEMON_BASE
  const token = process.env.DIFY_PLUGIN_DAEMON_KEY
  return {mode: 'direct', connectorUrl: null, base, token, isReal: Boolean(base && token)}
}

export async function difyPluginDaemonFetch(path, {method = 'GET', headers = {}, body, timeoutMs = 15000} = {}) {
  const daemon = getDifyPluginDaemonConfig()
  if (!daemon.isReal) throw Object.assign(new Error('未配置 Dify Plugin Daemon 管理连接'), {status: 501, code: 'UPSTREAM_UNSUPPORTED'})
  const rel = path.startsWith('/') ? path : `/${path}`
  const url = `${daemon.base.replace(/\/$/, '')}${rel}`
  const authHeader = daemon.mode === 'connector'
    ? (daemon.token ? {Authorization: `Bearer ${daemon.token}`} : {})
    : {'X-Api-Key': daemon.token}
  return fetch(url, {
    method,
    headers: {...authHeader, ...headers},
    ...(body !== undefined ? {body} : {}),
    signal: AbortSignal.timeout(timeoutMs),
  })
}
