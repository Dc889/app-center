import {check, json, listen} from '../../runtime/http.mjs'

function parseOwnerMap(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function readDifyUpstreamConfig() {
  const base = (process.env.DIFY_API_BASE ?? process.env.DIFY_API_URL ?? '').replace(/\/$/, '')
  const token = process.env.DIFY_CONSOLE_TOKEN ?? process.env.DIFY_API_KEY ?? ''
  const workspaceId = process.env.DIFY_WORKSPACE_ID ?? null
  const adapterVersion = process.env.DIFY_ADAPTER_VERSION ?? process.env.DIFY_VERSION ?? '1.7.1'
  const daemonBase = (process.env.DIFY_PLUGIN_DAEMON_BASE ?? process.env.DIFY_PLUGIN_DAEMON_URL ?? '').replace(/\/$/, '')
  const daemonKey = process.env.DIFY_PLUGIN_DAEMON_KEY ?? ''
  const email = process.env.DIFY_CONSOLE_EMAIL ?? ''
  const password = process.env.DIFY_CONSOLE_PASSWORD ?? ''
  return {
    base,
    token,
    workspaceId,
    adapterVersion,
    configured: Boolean(base && (token || (email && password))),
    daemonBase,
    daemonKey,
    pluginDaemonConfigured: Boolean(daemonBase && daemonKey),
    ownerMap: parseOwnerMap(process.env.DIFY_OWNER_ACCOUNT_MAP),
  }
}

let refreshInFlight = null
const tenantTokens = new Map()
const TENANT_EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || 'kpw.com'
const TENANT_DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'Kpw@2026!'

async function resolveTenantToken(base, account, forceRefresh = false) {
  const clean = String(account || '').trim()
  if (!clean || ['system', 'system_event'].includes(clean)) return null
  const email = clean.includes('@') ? clean.toLowerCase() : `${clean.toLowerCase()}@${TENANT_EMAIL_DOMAIN}`
  if (!forceRefresh && tenantTokens.has(email)) return tenantTokens.get(email)
  try {
    const res = await fetch(`${base}/console/api/login`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email, password: TENANT_DEFAULT_PASSWORD, remember_me: true}),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.result === 'success' && typeof data?.data?.access_token === 'string') {
      tenantTokens.set(email, data.data.access_token)
      return data.data.access_token
    }
  } catch {
    // Fall back to default admin token if tenant login fails
  }
  return null
}
async function refreshConsoleToken(base) {
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
        // Ignore refresh error; upstream 401 will be surfaced to caller.
      } finally {
        refreshInFlight = null
      }
      return null
    })()
  }
  return refreshInFlight
}

async function readRawBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return chunks.length ? Buffer.concat(chunks) : undefined
}

async function forwardResponse(upstream, res) {
  const headers = {}
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers['content-type'] = contentType
  headers['cache-control'] = 'no-store'
  res.writeHead(upstream.status, headers)
  const buf = Buffer.from(await upstream.arrayBuffer())
  res.end(buf)
}

export function startDifyConnector({token, port = 0, host} = {}) {
  return listen(
    async (req, res, path) => {
      const cfg = readDifyUpstreamConfig()

      if (req.method === 'GET' && path === '/connector/v1/meta') {
        return json(res, {
          product: 'dify',
          adapterVersion: cfg.adapterVersion,
          workspaceId: cfg.workspaceId,
          configured: cfg.configured,
          pluginDaemonConfigured: cfg.pluginDaemonConfigured,
          ownerMap: cfg.ownerMap,
        })
      }

      if (req.method === 'GET' && path === '/connector/v1/health') {
        check(cfg.configured, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 连接凭证')
        const started = Date.now()
        let lastRes = null
        let lastData = null
        for (const probePath of ['/console/api/setup', '/health']) {
          try {
            lastRes = await fetch(`${cfg.base}${probePath}`, {
              headers: {Authorization: `Bearer ${cfg.token}`},
              signal: AbortSignal.timeout(4000),
            })
            lastData = await lastRes.json().catch(() => null)
            if (lastRes.ok) break
            if (lastRes.status !== 404) break
          } catch {
            lastRes = null
          }
        }
        const ok = Boolean(lastRes?.ok)
        const version = typeof lastData?.version === 'string' && lastData.version.trim()
          ? lastData.version.slice(0, 64)
          : `dify-${cfg.adapterVersion}`
        return json(res, {ok, version, adapterVersion: cfg.adapterVersion, latencyMs: Date.now() - started}, ok ? 200 : 502)
      }

      if (req.method === 'GET' && path === '/connector/v1/plugin-daemon/health') {
        check(cfg.daemonBase, 501, 'UPSTREAM_UNSUPPORTED', '未配置 Dify Plugin Daemon 地址')
        const started = Date.now()
        try {
          const upstream = await fetch(`${cfg.daemonBase}/health/check`, {
            headers: cfg.daemonKey ? {'X-Api-Key': cfg.daemonKey} : {},
            signal: AbortSignal.timeout(4000),
          })
          const data = await upstream.json().catch(() => null)
          return json(
            res,
            {
              ok: upstream.ok,
              version: typeof data?.version === 'string' ? data.version : 'daemon',
              latencyMs: Date.now() - started,
            },
            upstream.ok ? 200 : 502,
          )
        } catch {
          return json(res, {ok: false, version: 'daemon', latencyMs: Date.now() - started}, 502)
        }
      }

      if (path.startsWith('/connector/v1/console/')) {
        check(cfg.configured, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 连接凭证')
        const fullUrl = new URL(req.url, 'http://localhost')
        const upstreamPath = path.slice('/connector/v1/console'.length) + fullUrl.search
        const rawBody = await readRawBody(req)
        const passthroughHeaders = {}
        for (const h of ['content-type', 'accept']) {
          if (req.headers[h]) passthroughHeaders[h] = String(req.headers[h])
        }
        const buildInit = currentToken => ({
          method: req.method,
          headers: {
            ...passthroughHeaders,
            Authorization: `Bearer ${currentToken}`,
          },
          ...(rawBody !== undefined ? {body: rawBody} : {}),
          signal: AbortSignal.timeout(25000),
        })
        const requestedAccount = String(req.headers['x-dify-account'] ?? '').trim()
        const tenantToken = requestedAccount ? await resolveTenantToken(cfg.base, requestedAccount) : null
        const initialToken = tenantToken || cfg.token
        let upstream = await fetch(`${cfg.base}${upstreamPath}`, buildInit(initialToken))
        if (upstream.status === 401) {
          const refreshed = tenantToken
            ? await resolveTenantToken(cfg.base, requestedAccount, true)
            : await refreshConsoleToken(cfg.base)
          if (refreshed) {
            upstream = await fetch(`${cfg.base}${upstreamPath}`, buildInit(refreshed))
          }
        }
        return forwardResponse(upstream, res)
      }

      if (path.startsWith('/connector/v1/plugin-daemon/')) {
        check(cfg.pluginDaemonConfigured, 501, 'UPSTREAM_UNSUPPORTED', '未配置 Dify Plugin Daemon 连接凭证')
        const fullUrl = new URL(req.url, 'http://localhost')
        const upstreamPath = path.slice('/connector/v1/plugin-daemon'.length) + fullUrl.search
        const rawBody = await readRawBody(req)
        const passthroughHeaders = {}
        for (const h of ['content-type', 'accept']) {
          if (req.headers[h]) passthroughHeaders[h] = String(req.headers[h])
        }
        const upstream = await fetch(`${cfg.daemonBase}${upstreamPath}`, {
          method: req.method,
          headers: {
            ...passthroughHeaders,
            'X-Api-Key': cfg.daemonKey,
          },
          ...(rawBody !== undefined ? {body: rawBody} : {}),
          signal: AbortSignal.timeout(25000),
        })
        return forwardResponse(upstream, res)
      }

      return json(res, {error: {code: 'NOT_FOUND', message: '未知 Dify Connector 接口'}}, 404)
    },
    {
      token,
      port,
      host,
      health: () => ({
        service: 'connector-dify',
        adapterVersion: readDifyUpstreamConfig().adapterVersion,
        configured: readDifyUpstreamConfig().configured,
      }),
    },
  )
}
