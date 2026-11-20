import {readFileSync} from 'node:fs'
import {check} from '../../../runtime/http.mjs'
import {isUtcTimestamp} from '../../../runtime/execution-state.mjs'

const contract = JSON.parse(readFileSync(new URL('../../../contracts/capability-api/actions.json', import.meta.url), 'utf8'))
const actionKey = r => JSON.stringify([r.ticketType, r.ticketTypeVersion, r.action])
const proofKey = r => JSON.stringify([r.ticketType, r.ticketTypeVersion, r.action, r.variant, r.workspaceId])

function parseRoutePath(path) {
  check(
    typeof path === 'string' &&
      path.startsWith('/internal/v1/') &&
      !/[?#]/.test(path) &&
      !path.endsWith('/') &&
      !path.includes('//'),
    500,
    'INVALID_ROUTE',
  )
  const segments = path.slice('/internal/v1/'.length).split('/')
  check(segments.length > 0 && segments.every(s => s.length > 0), 500, 'INVALID_ROUTE')
  const paramNames = new Set()
  const normalizedSegments = []
  let hasParams = false
  for (const segment of segments) {
    if (segment.startsWith(':')) {
      check(/^:[a-zA-Z_]\w*$/.test(segment), 500, 'INVALID_ROUTE')
      const name = segment.slice(1)
      check(!paramNames.has(name), 500, 'INVALID_ROUTE')
      paramNames.add(name)
      normalizedSegments.push(':*')
      hasParams = true
    } else {
      normalizedSegments.push(segment)
    }
  }
  const normalizedPath = '/internal/v1/' + normalizedSegments.join('/')
  const isReserved =
    /^\/internal\/v1\/(?:capabilities|resources|catalog|downloads)(?:\/|$)/.test(normalizedPath) ||
    /^\/internal\/v1\/executions(?:\/:\*(?:\/cancel)?)?$/.test(normalizedPath)
  check(!isReserved, 500, 'RESERVED_ROUTE')
  return {segments, normalizedPath, hasParams}
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    check(false, 400, 'INVALID_REQUEST', '路径参数编码无效')
  }
}

function normalizeResourceProvider(provider) {
  if (typeof provider === 'function') {
    return Object.freeze({legacyList: provider})
  }
  check(provider && typeof provider === 'object' && !Array.isArray(provider), 500, 'INVALID_RESOURCE_PROVIDER')
  check(provider.list === undefined || typeof provider.list === 'function', 500, 'INVALID_RESOURCE_PROVIDER')
  check(provider.detail === undefined || typeof provider.detail === 'function', 500, 'INVALID_RESOURCE_PROVIDER')
  check(typeof provider.list === 'function' || typeof provider.detail === 'function', 500, 'INVALID_RESOURCE_PROVIDER')
  return Object.freeze({...provider})
}

function normalizeCatalogProvider(provider) {
  check(provider && typeof provider === 'object' && !Array.isArray(provider), 500, 'INVALID_CATALOG_PROVIDER')
  for (const key of ['list', 'detail', 'versions']) {
    check(provider[key] === undefined || typeof provider[key] === 'function', 500, 'INVALID_CATALOG_PROVIDER')
  }
  return Object.freeze({...provider})
}

function defaultValidatePayload(payload) {
  check(
    typeof payload.decisionRef === 'string' && payload.decisionRef && Object.keys(payload).length === 1,
    400,
    'INVALID_REQUEST',
  )
}

export function createRegistry(
  modules,
  {
    actions = contract,
    evidence = () =>
      process.env.CAPABILITY_EVIDENCE_FILE ? JSON.parse(readFileSync(process.env.CAPABILITY_EVIDENCE_FILE, 'utf8')) : [],
    now = Date.now,
  } = {},
) {
  const ids = new Set()
  const registered = new Map()
  const resources = new Map()
  const catalogs = new Map()
  const normalizedRouteKeys = new Set()
  const staticRoutes = new Map()
  const dynamicRoutes = []
  const moduleInits = []

  for (const module of modules) {
    check(module && typeof module.id === 'string' && module.id && !ids.has(module.id), 500, 'DUPLICATE_MODULE')
    ids.add(module.id)
    check(module.init === undefined || typeof module.init === 'function', 500, 'INVALID_MODULE_INIT')
    if (module.init) moduleInits.push(Object.freeze({id: module.id, init: module.init}))

    for (const raw of module.actions ?? []) {
      check(
        Object.hasOwn(actions, raw.ticketType) &&
          actions[raw.ticketType].includes(raw.action) &&
          typeof raw.ticketTypeVersion === 'string' &&
          raw.ticketTypeVersion.length > 0,
        500,
        'UNREGISTERED_ACTION',
      )
      const key = actionKey(raw)
      check(!registered.has(key), 500, 'DUPLICATE_HANDLER')
      check(
        Array.isArray(raw.variants) &&
          raw.variants.length > 0 &&
          raw.variants.every(v => v === null || (typeof v === 'string' && v.length > 0)) &&
          new Set(raw.variants).size === raw.variants.length,
        500,
        'INVALID_VARIANTS',
      )
      check(raw.execute === undefined || typeof raw.execute === 'function', 500, 'INVALID_HANDLER')
      check(raw.validatePayload === undefined || typeof raw.validatePayload === 'function', 500, 'INVALID_HANDLER')
      check(raw.reconcile === undefined || typeof raw.reconcile === 'function', 500, 'INVALID_HANDLER')
      check(raw.cancel === undefined || typeof raw.cancel === 'function', 500, 'INVALID_HANDLER')
      registered.set(
        key,
        Object.freeze({
          ...raw,
          variants: Object.freeze([...raw.variants]),
          moduleId: module.id,
          reconcile: raw.reconcile ?? module.reconcile,
          retryOnServerError: Boolean(raw.retryOnServerError),
        }),
      )
    }

    for (const [kind, provider] of Object.entries(module.resources ?? {})) {
      check(!resources.has(kind), 500, 'DUPLICATE_RESOURCE_PROVIDER')
      resources.set(kind, Object.freeze({...normalizeResourceProvider(provider), moduleId: module.id}))
    }

    for (const [kind, provider] of Object.entries(module.catalogs ?? {})) {
      check(!catalogs.has(kind), 500, 'DUPLICATE_CATALOG_PROVIDER')
      catalogs.set(kind, Object.freeze({...normalizeCatalogProvider(provider), moduleId: module.id}))
    }

    for (const route of module.routes ?? []) {
      check(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method), 500, 'INVALID_ROUTE')
      check(typeof route.handle === 'function', 500, 'INVALID_ROUTE')
      const parsed = parseRoutePath(route.path)
      const normalizedKey = route.method + ' ' + parsed.normalizedPath
      check(!normalizedRouteKeys.has(normalizedKey), 500, 'DUPLICATE_ROUTE')
      normalizedRouteKeys.add(normalizedKey)
      if (!parsed.hasParams) {
        staticRoutes.set(route.method + ' ' + route.path, Object.freeze({handle: route.handle, moduleId: module.id}))
      } else {
        dynamicRoutes.push(
          Object.freeze({
            method: route.method,
            segments: Object.freeze(parsed.segments),
            handle: route.handle,
            moduleId: module.id,
          }),
        )
      }
    }
  }

  // Every contract action must have an explicit owner, even when it is not implemented.
  for (const [ticketType, names] of Object.entries(actions)) {
    for (const action of names) {
      check([...registered.values()].some(r => r.ticketType === ticketType && r.action === action), 500, 'UNOWNED_ACTION')
    }
  }

  const ready = r => typeof r?.execute === 'function' && r.ready !== false

  function matchRoute(method, path) {
    const exact = staticRoutes.get(method + ' ' + path)
    if (exact) return {handle: exact.handle, params: {}, moduleId: exact.moduleId}
    if (!path.startsWith('/internal/v1/')) return null
    const incoming = path.slice('/internal/v1/'.length).split('/')
    for (const candidate of dynamicRoutes) {
      if (candidate.method !== method || candidate.segments.length !== incoming.length) continue
      const params = {}
      let matched = true
      for (let i = 0; i < candidate.segments.length; i++) {
        const expected = candidate.segments[i]
        const actual = incoming[i]
        if (expected.startsWith(':')) {
          if (!actual) {
            matched = false
            break
          }
          params[expected.slice(1)] = decodeSegment(actual)
        } else if (expected !== actual) {
          matched = false
          break
        }
      }
      if (matched) return {handle: candidate.handle, params, moduleId: candidate.moduleId}
    }
    return null
  }

  return Object.freeze({
    moduleIds: Object.freeze([...ids]),
    moduleInits: Object.freeze(moduleInits),
    actionSpec(command) {
      return registered.get(actionKey(command)) ?? null
    },
    handler(command) {
      const r = registered.get(actionKey(command))
      return ready(r) ? r.execute : null
    },
    cancelHandler(command) {
      const r = registered.get(actionKey(command))
      return ready(r) && typeof r.cancel === 'function' ? r.cancel : null
    },
    validatePayload(command) {
      const r = registered.get(actionKey(command))
      if (r?.validatePayload) {
        r.validatePayload(command.payload, command)
      } else {
        defaultValidatePayload(command.payload)
      }
    },
    async reconcile(row, services) {
      const r = registered.get(actionKey(row.command))
      if (ready(r) && typeof r.reconcile === 'function') {
        await r.reconcile({row, ...services})
      }
    },
    resourceProvider: kind => resources.get(kind),
    catalogProvider: kind => catalogs.get(kind),
    matchRoute,
    route: (method, path) => matchRoute(method, path)?.handle,
    capabilities(workspaceId = null) {
      const proofs = evidence()
      check(Array.isArray(proofs), 503, 'INVALID_CAPABILITY_EVIDENCE')
      const index = new Map()
      for (const proof of proofs) {
        check(proof && typeof proof === 'object', 503, 'INVALID_CAPABILITY_EVIDENCE')
        const key = proofKey(proof)
        check(!index.has(key), 503, 'AMBIGUOUS_EVIDENCE', '同一能力分支存在重复核验记录')
        index.set(key, proof)
      }
      const items = []
      for (const r of registered.values()) {
        for (const variant of r.variants) {
          const proof = index.get(proofKey({...r, variant, workspaceId}))
          const valid =
            proof &&
            ['verified', 'unverified', 'unsupported'].includes(proof.state) &&
            typeof proof.reasonCode === 'string' &&
            proof.reasonCode.length > 0 &&
            isUtcTimestamp(proof.checkedAt) &&
            Date.parse(proof.checkedAt) <= now() + 5000
          items.push({
            ticketType: r.ticketType,
            ticketTypeVersion: r.ticketTypeVersion,
            action: r.action,
            variant,
            state: ready(r) ? (valid ? proof.state : 'unverified') : 'unsupported',
            reasonCode: ready(r)
              ? valid
                ? proof.reasonCode
                : 'NO_DEPLOYMENT_EVIDENCE'
              : r.execute
                ? 'IMPLEMENTATION_INCOMPLETE'
                : 'NO_HANDLER',
            checkedAt: ready(r) && valid ? proof.checkedAt : null,
          })
        }
      }
      return {items, asOf: new Date(now()).toISOString()}
    },
  })
}
