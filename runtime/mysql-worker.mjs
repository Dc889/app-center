import {parentPort, workerData} from 'node:worker_threads'
import mysql from 'mysql2/promise'

const signal = new Int32Array(workerData.signalBuf)
const dataView = new Uint8Array(workerData.dataBuf)
const CHUNK_SIZE = dataView.byteLength

const pools = new Map()
const initializedPools = new Set()
const transactions = new Map()

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ledger_records (
  ledger_name VARCHAR(128) NOT NULL,
  record_id VARCHAR(255) NOT NULL,
  body LONGTEXT NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (ledger_name, record_id),
  KEY idx_ledger_updated (ledger_name, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`

async function getPool(uri) {
  let pool = pools.get(uri)
  if (!pool) {
    pool = mysql.createPool({
      uri,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
      maxIdle: 5,
      idleTimeout: 60000,
      enableKeepAlive: true,
      charset: 'utf8mb4',
    })
    pools.set(uri, pool)
  }
  if (!initializedPools.has(uri)) {
    await pool.query(CREATE_TABLE_SQL)
    initializedPools.add(uri)
  }
  return pool
}

function sendResponse(payload, isError = false) {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8')
  if (bytes.length <= CHUNK_SIZE) {
    dataView.set(bytes, 0)
    Atomics.store(signal, 1, bytes.length)
    Atomics.store(signal, 2, isError ? 1 : 0)
    Atomics.store(signal, 0, 1)
    Atomics.notify(signal, 0)
    return
  }
  let offset = 0
  while (offset < bytes.length) {
    const end = Math.min(offset + CHUNK_SIZE, bytes.length)
    const slice = bytes.subarray(offset, end)
    dataView.set(slice, 0)
    const hasMore = end < bytes.length
    Atomics.store(signal, 3, 0)
    Atomics.store(signal, 1, slice.length)
    Atomics.store(signal, 2, isError ? 1 : 0)
    Atomics.store(signal, 0, hasMore ? 2 : 1)
    Atomics.notify(signal, 0)
    if (hasMore) {
      Atomics.wait(signal, 3, 0)
    }
    offset = end
  }
}

async function handle(msg) {
  const {op, url, clientId, ledgerName, key, body} = msg
  if (op === 'open') {
    await getPool(url)
    return {ok: true}
  }
  if (op === 'ping') {
    const pool = await getPool(url)
    await pool.query('SELECT 1 AS ok')
    return {ok: true}
  }
  if (op === 'begin') {
    const pool = await getPool(url)
    const existing = transactions.get(clientId)
    if (!existing) {
      const conn = await pool.getConnection()
      await conn.beginTransaction()
      transactions.set(clientId, {conn, depth: 1})
    } else {
      existing.depth += 1
      await existing.conn.query(`SAVEPOINT sp_${existing.depth}`)
    }
    return {ok: true}
  }
  if (op === 'commit') {
    const tx = transactions.get(clientId)
    if (!tx) return {ok: true}
    if (tx.depth > 1) {
      await tx.conn.query(`RELEASE SAVEPOINT sp_${tx.depth}`)
      tx.depth -= 1
    } else {
      try {
        await tx.conn.commit()
      } finally {
        tx.conn.release()
        transactions.delete(clientId)
      }
    }
    return {ok: true}
  }
  if (op === 'rollback') {
    const tx = transactions.get(clientId)
    if (!tx) return {ok: true}
    if (tx.depth > 1) {
      await tx.conn.query(`ROLLBACK TO SAVEPOINT sp_${tx.depth}`)
      tx.depth -= 1
    } else {
      try {
        await tx.conn.rollback()
      } finally {
        tx.conn.release()
        transactions.delete(clientId)
      }
    }
    return {ok: true}
  }
  if (op === 'get') {
    const pool = await getPool(url)
    const tx = transactions.get(clientId)
    const runner = tx ? tx.conn : pool
    const sql = tx && msg.forUpdate
      ? 'SELECT body FROM ledger_records WHERE ledger_name = ? AND record_id = ? FOR UPDATE'
      : 'SELECT body FROM ledger_records WHERE ledger_name = ? AND record_id = ?'
    const [rows] = await runner.query(sql, [ledgerName, key])
    return {body: rows.length ? rows[0].body : null}
  }
  if (op === 'put') {
    const pool = await getPool(url)
    const tx = transactions.get(clientId)
    const runner = tx ? tx.conn : pool
    await runner.query(
      'INSERT INTO ledger_records (ledger_name, record_id, body) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE body = VALUES(body)',
      [ledgerName, key, body],
    )
    return {ok: true}
  }
  if (op === 'all') {
    const pool = await getPool(url)
    const tx = transactions.get(clientId)
    const runner = tx ? tx.conn : pool
    const [rows] = await runner.query(
      'SELECT body FROM ledger_records WHERE ledger_name = ? ORDER BY record_id ASC',
      [ledgerName],
    )
    return {rows: rows.map(r => r.body)}
  }
  if (op === 'closeClient') {
    const tx = transactions.get(clientId)
    if (tx) {
      try { await tx.conn.rollback() } catch { /* ignore */ }
      try { tx.conn.release() } catch { /* ignore */ }
      transactions.delete(clientId)
    }
    return {ok: true}
  }
  if (op === 'shutdown') {
    for (const tx of transactions.values()) {
      try { await tx.conn.rollback() } catch { /* ignore */ }
      try { tx.conn.release() } catch { /* ignore */ }
    }
    transactions.clear()
    for (const pool of pools.values()) {
      try { await pool.end() } catch { /* ignore */ }
    }
    pools.clear()
    initializedPools.clear()
    return {ok: true}
  }
  throw new Error(`Unsupported MySQL worker op: ${op}`)
}

parentPort.on('message', async msg => {
  try {
    const result = await handle(msg)
    sendResponse(result, false)
  } catch (err) {
    sendResponse({
      message: err?.message ?? 'MySQL operation failed',
      code: err?.code ?? 'MYSQL_ERROR',
    }, true)
  }
})
