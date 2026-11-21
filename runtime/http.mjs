import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mysqlLedger, resolveMysqlUrl, pingMysql, closeMysqlBridge } from './mysql-ledger.mjs'

export const prefix = '/internal/v1'
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export const id = () => randomUUID()
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
export function check(condition, status, code, message = code) {
  if (!condition) throw new ApiError(status, code, message)
}
export function storageBackend() {
  return resolveMysqlUrl() ? 'mysql' : 'sqlite'
}
export function checkStorageHealth() {
  const url = resolveMysqlUrl()
  if (!url) return { ok: true, backend: 'sqlite' }
  pingMysql(url)
  return { ok: true, backend: 'mysql' }
}
export function closeStorage() {
  closeMysqlBridge()
}
export function ledger(dir, name, actorSnapshot) {
  const mysqlUrl = resolveMysqlUrl()
  if (mysqlUrl) {
    return mysqlLedger(mysqlUrl, name, actorSnapshot, { check, same })
  }
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, name + '.sqlite'))
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
  const read = db.prepare('SELECT body FROM records WHERE id=?')
  const write = db.prepare('INSERT INTO records VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
  return {
    get(key) { const row = read.get(key); return row && JSON.parse(row.body) },
    put(key, value) {
      if(actorSnapshot && Array.isArray(value.history)) {
        const previous=read.get(key)
        const before=previous?JSON.parse(previous.body):null
        const history=before?.history ?? []
        check(value.history.length>=history.length && same(value.history.slice(0,history.length),history),409,'AUDIT_HISTORY_IMMUTABLE')
        const summary=row=>{
          const fields=Object.fromEntries(['status','revision','version','draft','enabled'].filter(k=>['string','number','boolean'].includes(typeof row?.[k])).map(k=>[k,row[k]]))
          return Object.keys(fields).length?JSON.stringify(fields):null
        }
        value={...value,history:[...history,...value.history.slice(history.length).map(event=>({...event,beforeSummary:summary(before),afterSummary:summary(value),...actorSnapshot(event.actor)}))]}
      }
      write.run(key, JSON.stringify(value));return value
    },
    all() { return db.prepare('SELECT body FROM records').all().map(row => JSON.parse(row.body)) },
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE')
      try {const value=fn();db.exec('COMMIT');return value}
      catch(error){db.exec('ROLLBACK');throw error}
    },
    close() { db.close() },
  }
}
const parsedBodies=new WeakMap()
export function body(req) {
  if(!parsedBodies.has(req))parsedBodies.set(req,readBody(req))
  return parsedBodies.get(req)
}
async function readBody(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    check(length <= 65536, 413, 'BODY_TOO_LARGE')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()) }
  catch { throw new ApiError(400, 'INVALID_REQUEST', '请求不是 JSON') }
}
export function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
export function listen(handler, { token, port = 0, host = process.env.HOST || '127.0.0.1', close, health } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname
      if (req.method === 'GET' && path === '/healthz') {
        const result = health ? await health() : checkStorageHealth()
        return json(res, { ok: true, ...result }, 200)
      }
      if (token) check(req.headers.authorization === 'Bearer ' + token, 403, 'ACCESS_DENIED')
      await handler(req, res, path)
    } catch (e) {
      if (res.headersSent) { res.destroy(); return }
      json(res, {error:{code:e.code && e.status ? e.code : 'SERVICE_UNAVAILABLE', message:e.status ? e.message : '服务暂不可用'}}, e.status ?? 503)
    }
  })
  return new Promise((resolve,reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const boundHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
      resolve({
        url: `http://${boundHost}:${server.address().port}`,
        close: () => new Promise(done => server.close(() => { close?.(); done() })),
      })
    })
  })
}
export function client(base, token) {
  return async (path, method = 'GET', value, headers = {}) => {
    const response = await fetch(base + prefix + path, { method, headers: {
      authorization: 'Bearer ' + token, 'content-type': 'application/json', ...headers,
    }, body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(15000) })
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}))
      throw new ApiError(response.status, problem.error?.code ?? 'UPSTREAM_ERROR', problem.error?.message ?? '下游请求失败')
    }
    return response
  }
}
export function same(a,b) {
  const sorted = obj => obj && typeof obj === 'object' && !Array.isArray(obj)
    ? Object.fromEntries(Object.keys(obj).sort().map(k => [k, sorted(obj[k])])) : obj
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
}
