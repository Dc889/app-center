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

export function readRagflowUpstreamConfig() {
  const base = (process.env.RAGFLOW_API_BASE ?? process.env.RAGFLOW_API_URL ?? '').replace(/\/$/, '')
  const token = process.env.RAGFLOW_API_KEY ?? process.env.RAGFLOW_TOKEN ?? ''
  const tenantId = process.env.RAGFLOW_TENANT_ID ?? null
  const adapterVersion = process.env.RAGFLOW_ADAPTER_VERSION ?? process.env.RAGFLOW_VERSION ?? '0.22.1'
  const externalEndpoint = (process.env.RAGFLOW_EXTERNAL_ENDPOINT ?? (base ? `${base}/api/v1/dify` : '')).replace(/\/$/, '')
  return {
    base,
    token,
    tenantId,
    adapterVersion,
    externalEndpoint,
    configured: Boolean(base && token),
    ownerMap: parseOwnerMap(process.env.RAGFLOW_OWNER_ACCOUNT_MAP),
  }
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

export function startRagflowConnector({token, port = 0, host} = {}) {
  return listen(
    async (req, res, path) => {
      const cfg = readRagflowUpstreamConfig()

      if (req.method === 'GET' && path === '/connector/v1/meta') {
        return json(res, {
          product: 'ragflow',
          adapterVersion: cfg.adapterVersion,
          tenantId: cfg.tenantId,
          externalEndpoint: cfg.externalEndpoint,
          configured: cfg.configured,
          ownerMap: cfg.ownerMap,
        })
      }

      if (req.method === 'GET' && path === '/connector/v1/health') {
        check(cfg.configured, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
        const started = Date.now()
        let lastRes = null
        let lastData = null
        for (const probePath of ['/v1/system/healthz', '/api/v1/system/health']) {
          try {
            lastRes = await fetch(`${cfg.base}${probePath}`, {
              headers: {Authorization: `Bearer ${cfg.token}`},
              signal: AbortSignal.timeout(4000),
            })
            lastData = await lastRes.json().catch(() => null)
            const ragErr = typeof lastData?.code === 'number' && lastData.code !== 0
            if (lastRes.ok && !ragErr) break
            if (lastRes.status !== 404 && !ragErr) break
          } catch {
            lastRes = null
          }
        }
        const ragFailed = typeof lastData?.code === 'number' && lastData.code !== 0
        const ok = Boolean(lastRes?.ok) && !ragFailed
        const version = typeof lastData?.version === 'string' && lastData.version.trim()
          ? lastData.version.slice(0, 64)
          : typeof lastData?.data?.version === 'string' && lastData.data.version.trim()
            ? lastData.data.version.slice(0, 64)
            : `ragflow-${cfg.adapterVersion}`
        return json(res, {ok, version, adapterVersion: cfg.adapterVersion, latencyMs: Date.now() - started}, ok ? 200 : 502)
      }

      if (path.startsWith('/connector/v1/api/')) {
        check(cfg.configured, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
        const fullUrl = new URL(req.url, 'http://localhost')
        const upstreamPath = path.slice('/connector/v1/api'.length) + fullUrl.search
        const rawBody = await readRawBody(req)
        const passthroughHeaders = {}
        for (const h of ['content-type', 'accept']) {
          if (req.headers[h]) passthroughHeaders[h] = String(req.headers[h])
        }
        const upstream = await fetch(`${cfg.base}${upstreamPath}`, {
          method: req.method,
          headers: {
            ...passthroughHeaders,
            Authorization: `Bearer ${cfg.token}`,
          },
          ...(rawBody !== undefined ? {body: rawBody} : {}),
          signal: AbortSignal.timeout(25000),
        })
        return forwardResponse(upstream, res)
      }

      return json(res, {error: {code: 'NOT_FOUND', message: '未知 RAGFlow Connector 接口'}}, 404)
    },
    {
      token,
      port,
      host,
      health: () => ({
        service: 'connector-ragflow',
        adapterVersion: readRagflowUpstreamConfig().adapterVersion,
        configured: readRagflowUpstreamConfig().configured,
      }),
    },
  )
}
