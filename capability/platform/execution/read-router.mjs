import {json, check, prefix} from '../../../runtime/http.mjs'

const RESOURCE_KINDS = new Set(['dify_app', 'ragflow_dataset', 'dify_dataset', 'mcp_registration', 'model', 'skill', 'plugin'])
const CATALOG_KINDS = new Set(['skill', 'plugin', 'mcp', 'agent', 'knowledge', 'account'])

function decodeText(value, message = '参数编码无效') {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    check(false, 400, 'INVALID_REQUEST', message)
  }
}

export function extractIdentity(req) {
  return Object.freeze({
    account: typeof req.headers['x-account'] === 'string' ? req.headers['x-account'] : '',
    org: decodeText(typeof req.headers['x-org'] === 'string' ? req.headers['x-org'] : ''),
    role: typeof req.headers['x-role'] === 'string' ? req.headers['x-role'] : '',
    subjectId: typeof req.headers['x-subject-id'] === 'string' ? req.headers['x-subject-id'] : '',
  })
}

export async function routeReads(context) {
  const {registry, req, res, path, openModuleLedger} = context
  const query = new URL(req.url, 'http://localhost').searchParams
  const identity = extractIdentity(req)

  const matched = registry.matchRoute(req.method, path)
  if (matched) {
    await matched.handle({
      ...context,
      query,
      params: matched.params,
      identity,
      openLedger: name => openModuleLedger(matched.moduleId, name),
    })
    return true
  }

  if (req.method !== 'GET') return false

  if (path === prefix + '/resources') {
    const kind = query.get('kind')
    const provider = registry.resourceProvider(kind)
    if (!provider) {
      check(RESOURCE_KINDS.has(kind), 400, 'INVALID_RESOURCE_KIND')
      check(false, 501, 'UPSTREAM_UNSUPPORTED')
    }
    const moduleContext = {
      ...context,
      query,
      kind,
      identity,
      openLedger: name => openModuleLedger(provider.moduleId, name),
    }
    const q = (query.get('q') ?? '').trim().toLowerCase()
    if (provider.list) {
      const result = await provider.list(moduleContext)
      if (!res.headersSent) {
        if (Array.isArray(result)) {
          const items = q ? result.filter(r => (r.name + r.resourceId).toLowerCase().includes(q)) : result
          json(res, {items, nextCursor: null})
        } else {
          json(res, result)
        }
      }
      return true
    }
    if (provider.legacyList) {
      const ws = query.get('workspaceId') || null
      const raw = await provider.legacyList(ws, moduleContext)
      const items = q ? raw.filter(r => (r.name + r.resourceId).toLowerCase().includes(q)) : raw
      json(res, {items, nextCursor: null})
      return true
    }
    check(false, 501, 'UPSTREAM_UNSUPPORTED')
  }

  const resourceDetail = /^\/internal\/v1\/resources\/([^/]+)\/([^/]+)$/.exec(path)
  if (resourceDetail) {
    const kind = resourceDetail[1]
    const resourceId = decodeText(resourceDetail[2], '资源标识编码无效')
    const provider = registry.resourceProvider(kind)
    if (!provider) {
      check(RESOURCE_KINDS.has(kind), 400, 'INVALID_RESOURCE_KIND')
      check(false, 501, 'UPSTREAM_UNSUPPORTED')
    }
    check(provider.detail, 501, 'UPSTREAM_UNSUPPORTED')
    const result = await provider.detail({
      ...context,
      query,
      kind,
      resourceId,
      identity,
      openLedger: name => openModuleLedger(provider.moduleId, name),
    })
    if (!res.headersSent && result !== undefined) {
      json(res, result)
    }
    return true
  }

  if (path === prefix + '/catalog') {
    const kind = query.get('kind')
    const provider = registry.catalogProvider(kind)
    if (!provider?.list) {
      check(CATALOG_KINDS.has(kind), 400, 'INVALID_CATALOG_KIND')
      check(false, 501, 'UPSTREAM_UNSUPPORTED')
    }
    await provider.list({
      ...context,
      query,
      kind,
      identity,
      openLedger: name => openModuleLedger(provider.moduleId, name),
    })
    return true
  }

  const catalogVersions = /^\/internal\/v1\/catalog\/([^/]+)\/([^/]+)\/versions$/.exec(path)
  if (catalogVersions) {
    const kind = catalogVersions[1]
    const resourceId = decodeText(catalogVersions[2], '目录标识编码无效')
    const provider = registry.catalogProvider(kind)
    if (!provider?.versions) {
      check(CATALOG_KINDS.has(kind), 400, 'INVALID_CATALOG_KIND')
      check(false, 501, 'UPSTREAM_UNSUPPORTED')
    }
    await provider.versions({
      ...context,
      query,
      kind,
      resourceId,
      identity,
      openLedger: name => openModuleLedger(provider.moduleId, name),
    })
    return true
  }

  const catalogDetail = /^\/internal\/v1\/catalog\/([^/]+)\/([^/]+)$/.exec(path)
  if (catalogDetail) {
    const kind = catalogDetail[1]
    const resourceId = decodeText(catalogDetail[2], '目录标识编码无效')
    const provider = registry.catalogProvider(kind)
    if (!provider?.detail) {
      check(CATALOG_KINDS.has(kind), 400, 'INVALID_CATALOG_KIND')
      check(false, 501, 'UPSTREAM_UNSUPPORTED')
    }
    await provider.detail({
      ...context,
      query,
      kind,
      resourceId,
      identity,
      openLedger: name => openModuleLedger(provider.moduleId, name),
    })
    return true
  }

  return false
}
