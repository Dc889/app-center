let ragflowConnectorMeta = null

export function setRagflowConnectorMeta(meta) {
  ragflowConnectorMeta = meta ?? null
}

export async function hydrateRagflowConnector(token = process.env.RAGFLOW_CONNECTOR_TOKEN ?? process.env.INTERNAL_TOKEN ?? '') {
  const connectorUrl = (process.env.RAGFLOW_CONNECTOR_URL ?? '').replace(/\/$/, '')
  if (!connectorUrl) {
    ragflowConnectorMeta = null
    return null
  }
  try {
    const res = await fetch(`${connectorUrl}/connector/v1/meta`, {
      headers: token ? {Authorization: `Bearer ${token}`} : {},
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      ragflowConnectorMeta = await res.json()
      return ragflowConnectorMeta
    }
  } catch {
    // Keep prior meta if transient failure.
  }
  return ragflowConnectorMeta
}

export function getRagflowConfig() {
  const connectorUrl = (process.env.RAGFLOW_CONNECTOR_URL ?? '').replace(/\/$/, '')
  if (connectorUrl) {
    const token = process.env.RAGFLOW_CONNECTOR_TOKEN ?? process.env.INTERNAL_TOKEN ?? ''
    const configured = ragflowConnectorMeta ? Boolean(ragflowConnectorMeta.configured) : true
    return {
      mode: 'connector',
      connectorUrl,
      base: `${connectorUrl}/connector/v1/api`,
      token,
      tenantId: process.env.RAGFLOW_TENANT_ID ?? ragflowConnectorMeta?.tenantId ?? null,
      externalEndpoint: process.env.RAGFLOW_EXTERNAL_ENDPOINT ?? ragflowConnectorMeta?.externalEndpoint ?? '',
      externalApiKey: process.env.RAGFLOW_API_KEY ?? ragflowConnectorMeta?.externalApiKey ?? '',
      adapterVersion: ragflowConnectorMeta?.adapterVersion ?? process.env.RAGFLOW_VERSION ?? '0.22.1',
      isReal: configured,
    }
  }
  const base = (process.env.RAGFLOW_API_BASE ?? process.env.RAGFLOW_API_URL ?? '').replace(/\/$/, '') || undefined
  const token = process.env.RAGFLOW_API_KEY ?? process.env.RAGFLOW_TOKEN
  const tenantId = process.env.RAGFLOW_TENANT_ID ?? null
  const externalEndpoint = (process.env.RAGFLOW_EXTERNAL_ENDPOINT ?? (base ? `${base}/api/v1/dify` : '')).replace(/\/$/, '')
  const isReal = Boolean(base && token)
  return {
    mode: 'direct',
    connectorUrl: null,
    base,
    token,
    tenantId,
    externalEndpoint,
    adapterVersion: process.env.RAGFLOW_VERSION ?? '0.22.1',
    isReal,
  }
}

export async function ragflowFetch(path, {method = 'GET', headers = {}, body, timeoutMs = 15000} = {}) {
  const cfg = getRagflowConfig()
  if (!cfg.isReal) throw Object.assign(new Error('未配置真实 RAGFlow 连接凭证'), {status: 501, code: 'UPSTREAM_UNSUPPORTED'})
  const url = path.startsWith('http://') || path.startsWith('https://') ? path : `${cfg.base}${path}`
  return fetch(url, {
    method,
    headers: {
      ...(cfg.token ? {Authorization: `Bearer ${cfg.token}`} : {}),
      ...headers,
    },
    ...(body !== undefined ? {body} : {}),
    signal: AbortSignal.timeout(timeoutMs),
  })
}
