import {getDifyConfig, difyConsoleFetch, difyRequestContext} from '../../../platform/dify/public.mjs'

async function difyJsonFetch(path, {method = 'GET', body} = {}) {
  const res = await difyConsoleFetch(path, {
    method,
    headers: body !== undefined ? {'content-type': 'application/json'} : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = {raw: text}
    }
  }
  if (!res.ok) {
    const err = Object.assign(new Error(data?.message ?? `Dify MCP 接口错误 (${res.status})`), {
      status: res.status >= 500 ? 502 : res.status,
      code: data?.code ?? 'DIFY_MCP_ERROR',
    })
    throw err
  }
  return data
}

function normalizeServerUrlForDify(rawUrl, difyBase) {
  const trimmed = String(rawUrl ?? '').trim()
  if (!trimmed) return ''
  const isContainerDify = difyBase && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(String(difyBase))
  if (isContainerDify && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(trimmed)) {
    return trimmed.replace(/127\.0\.0\.1|localhost/i, 'host.docker.internal')
  }
  return trimmed
}

function sanitizeIdentifier(raw) {
  const cleaned = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return cleaned || 'app_center_mcp'
}

export async function bindMcpToDifyWorkspace({account, serverUrl, name, serverIdentifier}) {
  const cfg = getDifyConfig()
  if (!cfg.isReal) {
    return {synced: false, skipped: 'mock_mode', difyProviderId: '', serverIdentifier: sanitizeIdentifier(serverIdentifier)}
  }
  const effectiveUrl = normalizeServerUrlForDify(serverUrl, cfg.base)
  if (!effectiveUrl) {
    return {synced: false, skipped: 'missing_endpoint', difyProviderId: '', serverIdentifier: sanitizeIdentifier(serverIdentifier)}
  }
  const identifier = sanitizeIdentifier(serverIdentifier)
  const displayName = String(name ?? identifier).trim().slice(0, 80)

  const run = async () => {
    const existingRaw = await difyJsonFetch('/console/api/workspaces/current/tools/mcp')
    const existingList = Array.isArray(existingRaw) ? existingRaw : (Array.isArray(existingRaw?.data) ? existingRaw.data : [])
    const matched = existingList.find(
      m => m && (m.server_identifier === identifier || m.server_url === effectiveUrl),
    )
    let providerId = matched?.id ?? ''
    if (!providerId) {
      const created = await difyJsonFetch('/console/api/workspaces/current/tool-provider/mcp', {
        method: 'POST',
        body: {
          server_url: effectiveUrl,
          name: displayName,
          icon: '🔌',
          icon_type: 'emoji',
          icon_background: '#E0F2FE',
          server_identifier: identifier,
        },
      })
      providerId = String(created?.id ?? '')
    }
    if (providerId) {
      await difyJsonFetch(`/console/api/workspaces/current/tool-provider/mcp/update/${encodeURIComponent(providerId)}`, {
        method: 'GET',
      }).catch(() => null)
    }
    return {synced: true, difyProviderId: providerId, serverIdentifier: identifier, serverUrl: effectiveUrl}
  }

  return account ? difyRequestContext.run({account}, run) : run()
}

export async function unbindMcpFromDifyWorkspace({account, difyProviderId = '', serverIdentifier = ''}) {
  const cfg = getDifyConfig()
  if (!cfg.isReal) {
    return {synced: false, skipped: 'mock_mode', removed: false}
  }
  const identifier = serverIdentifier ? sanitizeIdentifier(serverIdentifier) : ''

  const run = async () => {
    let targetId = String(difyProviderId ?? '').trim()
    if (!targetId && identifier) {
      const existingRaw = await difyJsonFetch('/console/api/workspaces/current/tools/mcp').catch(() => [])
      const existingList = Array.isArray(existingRaw) ? existingRaw : (Array.isArray(existingRaw?.data) ? existingRaw.data : [])
      const matched = existingList.find(m => m && m.server_identifier === identifier)
      targetId = String(matched?.id ?? '')
    }
    if (!targetId) {
      return {synced: true, removed: false, reason: 'not_found_in_workspace'}
    }
    await difyJsonFetch('/console/api/workspaces/current/tool-provider/mcp', {
      method: 'DELETE',
      body: {provider_id: targetId},
    })
    return {synced: true, removed: true, difyProviderId: targetId}
  }

  return account ? difyRequestContext.run({account}, run) : run()
}
