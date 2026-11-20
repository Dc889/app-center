import {body, check, json, ledger, listen, prefix} from '../../../runtime/http.mjs'

export function startMcp(options) {
  const store = ledger(options.dir, 'mcps')

  function mergedItems() {
    const map = new Map()
    for (const row of store.all()) map.set(row.resourceId, row)
    return [...map.values()]
  }

  function findItem(resourceId) {
    return store.get(resourceId) ?? null
  }

  return listen(
    async (req, res, path) => {
      const root = prefix + '/mcps'
      if (req.method === 'GET' && path === root) {
        return json(res, {items: mergedItems(), nextCursor: null})
      }

      if (req.method === 'POST' && path === root) {
        const input = await body(req)
        check(
          input &&
            typeof input.resourceId === 'string' &&
            /^[\w-]+$/.test(input.resourceId) &&
            typeof input.name === 'string' &&
            input.name.trim() &&
            typeof input.transport === 'string' &&
            /^[a-f0-9]{64}$/.test(input.urlFingerprint) &&
            Array.isArray(input.toolNames),
          400,
          'INVALID_REQUEST',
        )
        check(!findItem(input.resourceId), 409, 'MCP_ALREADY_EXISTS', '该 MCP 目录 ID 已存在')
        const record = {
          resourceId: input.resourceId,
          name: input.name.trim(),
          status: 'active',
          revision: 1,
          transport: input.transport,
          toolNames: input.toolNames,
          urlFingerprint: input.urlFingerprint,
          registrationId: input.registrationId ?? null,
          bindingAccess: ['instant', 'approval'].includes(input.bindingAccess) ? input.bindingAccess : 'approval',
          provider: input.provider ?? `mcp-${input.resourceId}`,
          ownerAccount: input.ownerAccount ?? '',
          createdAt: new Date().toISOString(),
        }
        store.put(record.resourceId, record)
        return json(res, record, 201)
      }

      const sub = /^\/internal\/v1\/mcps\/([^/]+)(?:\/(status))?$/.exec(path)
      check(sub, 404, 'NOT_FOUND')
      const resourceId = decodeURIComponent(sub[1])
      const item = findItem(resourceId)
      check(item, 404, 'NOT_FOUND')

      if (!sub[2] && req.method === 'GET') {
        return json(res, item)
      }

      if (sub[2] === 'status' && req.method === 'POST') {
        const input = await body(req)
        check(['isolated', 'withdrawn', 'active'].includes(input?.status), 400, 'INVALID_STATUS')
        if (input.expectedRevision !== undefined && input.expectedRevision !== null) {
          check(item.revision === input.expectedRevision, 409, 'STALE_SNAPSHOT', 'MCP 目录修订已变化')
        }
        if (input.status === 'isolated') check(item.status === 'active', 409, 'INVALID_MCP_TRANSITION')
        if (input.status === 'withdrawn') check(['active', 'isolated'].includes(item.status), 409, 'INVALID_MCP_TRANSITION')
        const updated = {
          ...item,
          status: input.status,
          revision: item.revision + 1,
          updatedAt: new Date().toISOString(),
        }
        store.put(item.resourceId, updated)
        return json(res, updated)
      }

      check(false, 405, 'METHOD_NOT_ALLOWED')
    },
    {...options, close: store.close},
  )
}
