import {readFileSync} from 'node:fs'
import {body, check, client, json, ledger, listen, prefix, same} from '../../../runtime/http.mjs'
import {extractIdentity, routeReads} from './read-router.mjs'
import {handleDownloadRoute} from './delivery.mjs'

const actions = JSON.parse(readFileSync(new URL('../../../contracts/capability-api/actions.json', import.meta.url), 'utf8'))
const stamp = () => new Date().toISOString()

function failure(code, message) {
  return {ok: false, failureCode: code, failureReason: message, retryable: false, resultId: '', version: '', sha256: '', details: {}}
}

function makeServiceClient(urlOrGetter, token, name) {
  if (typeof urlOrGetter === 'function') {
    return async (...args) => {
      const resolved = urlOrGetter()
      check(resolved, 503, 'REPOSITORY_UNCONFIGURED', `未配置 ${name} 服务地址`)
      return client(resolved, token)(...args)
    }
  }
  if (urlOrGetter) return client(urlOrGetter, token)
  return async () => {
    check(false, 503, 'REPOSITORY_UNCONFIGURED', `未配置 ${name} 服务地址`)
  }
}

export async function startExecutionServer(options, registry) {
  const store = ledger(options.dir, 'executions')
  const clients = Object.freeze({
    skill: makeServiceClient(options.skill, options.token, 'skill'),
    plugin: makeServiceClient(options.plugin, options.token, 'plugin'),
    mcp: makeServiceClient(options.mcp, options.token, 'mcp'),
    agent: makeServiceClient(options.agent, options.token, 'agent'),
    management: makeServiceClient(options.management, options.token, 'management'),
  })

  const moduleLedgers = new Map()
  const cleanups = []
  const openModuleLedger = (moduleId, name) => {
    check(typeof name === 'string' && /^[\w-]+$/.test(name), 500, 'INVALID_LEDGER_NAME')
    const key = `${moduleId}:${name}`
    if (!moduleLedgers.has(key)) {
      moduleLedgers.set(key, ledger(options.dir, `mod_${moduleId}_${name}`))
    }
    return moduleLedgers.get(key)
  }

  const getExecution = executionId => {
    const row = store.get(executionId)
    return row ? structuredClone(row) : null
  }

  let closed = false
  function closeAll() {
    if (closed) return
    closed = true
    const pending = []
    for (const cleanup of cleanups.reverse()) {
      const result = cleanup?.()
      if (result && typeof result.then === 'function') pending.push(result)
    }
    for (const db of moduleLedgers.values()) {
      db.close()
    }
    store.close()
    if (pending.length) return Promise.all(pending)
  }

  try {
    for (const {id, init} of registry.moduleInits ?? []) {
      const cleanup = await init({
        dir: options.dir,
        clients,
        openLedger: name => openModuleLedger(id, name),
        getExecution,
      })
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    }
  } catch (err) {
    await closeAll()
    throw err
  }

  const busy = new Set()
  async function advance(row) {
    const {command, state} = row
    if (busy.has(command.executionId)) return
    const spec = registry.actionSpec(command)
    if (state.status === 'reconciling') {
      await registry.reconcile(row, {
        store,
        stamp,
        clients,
        skill: clients.skill,
        plugin: clients.plugin,
        openLedger: name => openModuleLedger(spec.moduleId, name),
        getExecution,
      })
      return
    }
    if (state.status !== 'queued') return
    busy.add(command.executionId)
    try {
      const execute = registry.handler(command)
      if (execute) {
        await execute({
          command,
          state,
          row,
          skill: clients.skill,
          plugin: clients.plugin,
          clients,
          store,
          stamp,
          openLedger: name => openModuleLedger(spec.moduleId, name),
          getExecution,
        })
      } else {
        state.status = 'failed'
        state.result = failure('UPSTREAM_UNSUPPORTED', '无法自动执行：此动作尚未接入')
      }
    } catch (err) {
      if ((err.status && err.status < 500) || err.status === 501) {
        state.status = 'failed'
        state.result = failure(err.code, err.message)
      } else if (spec?.retryOnServerError) {
        throw err
      }
    } finally {
      busy.delete(command.executionId)
      state.updatedAt = stamp()
      store.put(command.executionId, row)
    }
  }

  return listen(
    async (req, res, path) => {
      if (req.method === 'GET' && path === prefix + '/capabilities') {
        return json(res, registry.capabilities(new URL(req.url, 'http://localhost').searchParams.get('workspaceId')))
      }
      if (
        await routeReads({
          registry,
          req,
          res,
          path,
          skill: clients.skill,
          plugin: clients.plugin,
          clients,
          openModuleLedger,
          getExecution,
        })
      ) {
        return
      }
      if (req.method === 'POST' && path === prefix + '/executions') {
        const c = await body(req)
        check(
          c &&
            ['executionId', 'ticketNo', 'ticketType', 'ticketTypeVersion', 'action', 'resourceId', 'account', 'org'].every(
              k => typeof c[k] === 'string' && c[k].length > 0 && c[k].length <= 160,
            ) &&
            /^[\w-]+$/.test(c.executionId),
          400,
          'INVALID_REQUEST',
        )
        check(c.ticketTypeVersion === '1', 400, 'UNKNOWN_TYPE_VERSION')
        check(Object.hasOwn(actions, c.ticketType) && actions[c.ticketType].includes(c.action), 400, 'UNSUPPORTED_ACTION')
        check(c.payload && typeof c.payload === 'object' && !Array.isArray(c.payload), 400, 'INVALID_REQUEST')
        registry.validatePayload(c)
        const prior = store.get(c.executionId)
        if (!prior) {
          check(
            !store.all().some(r => r.command.ticketNo === c.ticketNo && r.command.action === c.action && !r.state.result),
            409,
            'ACTIVE_EXECUTION',
          )
        }
        if (prior) check(same(prior.command, c), 409, 'EXECUTION_CONFLICT')
        const row =
          prior ??
          store.put(c.executionId, {
            command: c,
            state: {executionId: c.executionId, ticketNo: c.ticketNo, status: 'queued', delivery: null, result: null, updatedAt: stamp()},
          })
        await advance(row)
        return json(res, store.get(c.executionId).state, prior ? 200 : 202)
      }

      const item = /^\/internal\/v1\/executions\/([\w-]+)$/.exec(path)
      if (req.method === 'GET' && item) {
        const row = store.get(item[1])
        check(row, 404, 'NOT_FOUND')
        await advance(row)
        return json(res, store.get(item[1]).state)
      }

      const cancelMatch = /^\/internal\/v1\/executions\/([\w-]+)\/cancel$/.exec(path)
      if (req.method === 'POST' && cancelMatch) {
        const row = store.get(cancelMatch[1])
        check(row, 404, 'NOT_FOUND')
        check(
          !['succeeded', 'failed', 'cancelled'].includes(row.state.status),
          409,
          'EXECUTION_TERMINAL',
          '执行已处于终态，不可取消',
        )
        const cancelHandler = registry.cancelHandler(row.command)
        check(cancelHandler, 501, 'UPSTREAM_UNSUPPORTED', '此动作尚未实现取消处理')
        const spec = registry.actionSpec(row.command)
        await cancelHandler({
          command: row.command,
          state: row.state,
          row,
          store,
          stamp,
          clients,
          skill: clients.skill,
          plugin: clients.plugin,
          openLedger: name => openModuleLedger(spec.moduleId, name),
          getExecution,
          identity: extractIdentity(req),
        })
        row.state.updatedAt = stamp()
        store.put(row.command.executionId, row)
        return json(res, row.state)
      }

      if (await handleDownloadRoute({req, res, path, store, skill: clients.skill})) return

      check(false, 404, 'NOT_FOUND')
    },
    {...options, close: closeAll},
  )
}
