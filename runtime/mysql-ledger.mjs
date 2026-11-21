import {Worker} from 'node:worker_threads'
import {randomUUID} from 'node:crypto'

const CHUNK_BYTES = 4 * 1024 * 1024
let bridge = null

function getBridge() {
  if (bridge) return bridge
  const signalBuf = new SharedArrayBuffer(16)
  const dataBuf = new SharedArrayBuffer(CHUNK_BYTES)
  const signal = new Int32Array(signalBuf)
  const dataView = new Uint8Array(dataBuf)
  const worker = new Worker(new URL('./mysql-worker.mjs', import.meta.url), {
    workerData: {signalBuf, dataBuf},
  })
  worker.unref()
  bridge = {worker, signal, dataView}
  return bridge
}

function callWorker(msg) {
  const {worker, signal, dataView} = getBridge()
  Atomics.store(signal, 0, 0)
  Atomics.store(signal, 1, 0)
  Atomics.store(signal, 2, 0)
  Atomics.store(signal, 3, 0)
  worker.postMessage(msg)

  const chunks = []
  let isError = false
  while (true) {
    Atomics.wait(signal, 0, 0)
    const status = Atomics.load(signal, 0)
    const len = Atomics.load(signal, 1)
    isError = Atomics.load(signal, 2) === 1
    chunks.push(Buffer.from(dataView.subarray(0, len)))
    if (status === 1) break
    Atomics.store(signal, 0, 0)
    Atomics.store(signal, 3, 1)
    Atomics.notify(signal, 3)
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (isError) {
    const err = new Error(parsed.message ?? 'MySQL operation failed')
    err.code = parsed.code ?? 'MYSQL_ERROR'
    throw err
  }
  return parsed
}

export function resolveMysqlUrl() {
  if (process.env.STORAGE_DRIVER === 'sqlite') return null
  const url = process.env.MYSQL_URL?.trim()
  if (url) return url
  if (process.env.STORAGE_DRIVER === 'mysql') {
    const host = process.env.MYSQL_HOST || '127.0.0.1'
    const port = process.env.MYSQL_PORT || '3306'
    const user = encodeURIComponent(process.env.MYSQL_USER || 'root')
    const password = encodeURIComponent(process.env.MYSQL_PASSWORD || '')
    const database = process.env.MYSQL_DATABASE || 'app_center'
    return `mysql://${user}:${password}@${host}:${port}/${database}`
  }
  return null
}

export function pingMysql(url = resolveMysqlUrl()) {
  if (!url) return false
  callWorker({op: 'ping', url})
  return true
}

export function closeMysqlBridge() {
  if (!bridge) return
  try {
    callWorker({op: 'shutdown'})
  } catch { /* ignore */ }
  const current = bridge
  bridge = null
  current.worker.terminate().catch(() => {})
}

export function mysqlLedger(url, ledgerName, actorSnapshot, {check, same}) {
  const clientId = randomUUID()
  callWorker({op: 'open', url, clientId, ledgerName})

  const runTransaction = fn => {
    callWorker({op: 'begin', url, clientId, ledgerName})
    try {
      const value = fn()
      callWorker({op: 'commit', url, clientId, ledgerName})
      return value
    } catch (error) {
      try { callWorker({op: 'rollback', url, clientId, ledgerName}) } catch { /* ignore */ }
      throw error
    }
  }

  return {
    get(key) {
      const res = callWorker({op: 'get', url, clientId, ledgerName, key: String(key)})
      return res.body === null ? undefined : JSON.parse(res.body)
    },
    put(key, value) {
      const id = String(key)
      if (actorSnapshot && Array.isArray(value?.history)) {
        return runTransaction(() => {
          const prevRes = callWorker({op: 'get', url, clientId, ledgerName, key: id, forUpdate: true})
          const before = prevRes.body ? JSON.parse(prevRes.body) : null
          const history = before?.history ?? []
          check(
            value.history.length >= history.length && same(value.history.slice(0, history.length), history),
            409,
            'AUDIT_HISTORY_IMMUTABLE',
          )
          const summary = row => {
            const fields = Object.fromEntries(
              ['status', 'revision', 'version', 'draft', 'enabled']
                .filter(k => ['string', 'number', 'boolean'].includes(typeof row?.[k]))
                .map(k => [k, row[k]]),
            )
            return Object.keys(fields).length ? JSON.stringify(fields) : null
          }
          const enriched = {
            ...value,
            history: [
              ...history,
              ...value.history.slice(history.length).map(event => ({
                ...event,
                beforeSummary: summary(before),
                afterSummary: summary(value),
                ...actorSnapshot(event.actor),
              })),
            ],
          }
          callWorker({op: 'put', url, clientId, ledgerName, key: id, body: JSON.stringify(enriched)})
          return enriched
        })
      }
      callWorker({op: 'put', url, clientId, ledgerName, key: id, body: JSON.stringify(value)})
      return value
    },
    all() {
      const res = callWorker({op: 'all', url, clientId, ledgerName})
      return res.rows.map(raw => JSON.parse(raw))
    },
    transaction: runTransaction,
    close() {
      try {
        callWorker({op: 'closeClient', url, clientId, ledgerName})
      } catch { /* ignore */ }
    },
  }
}
