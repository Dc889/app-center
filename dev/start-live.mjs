import {existsSync, readFileSync} from 'node:fs'
import {resolve, dirname} from 'node:path'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {createConnection} from 'node:net'
import {startLocalDaemonProxy} from './live-verification/daemon-proxy.mjs'

function parseDotEnv(filePath) {
  if (!existsSync(filePath)) return {}
  const map = {}
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    map[key] = value
  }
  return map
}

function canConnectTcp(host, port, timeoutMs = 1000) {
  return new Promise(done => {
    const socket = createConnection({host, port})
    const finish = ok => {
      socket.removeAllListeners()
      socket.destroy()
      done(ok)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function resolveMysqlEnv() {
  if (process.env.STORAGE_DRIVER === 'sqlite') {
    return {env: {}, label: 'SQLite (forced via STORAGE_DRIVER=sqlite)'}
  }
  if (process.env.MYSQL_URL || process.env.MYSQL_MGMT_URL) {
    return {env: {}, label: 'MySQL 8.0 (explicit MYSQL_* env)'}
  }
  const dockerEnv = parseDotEnv(resolve('docker/.env'))
  const host = process.env.MYSQL_HOST || '127.0.0.1'
  const port = Number(process.env.MYSQL_HOST_PORT || dockerEnv.MYSQL_HOST_PORT || 13306)
  if (!(await canConnectTcp(host, port))) {
    return {env: {}, label: `SQLite (${resolve(process.env.APP_DATA_DIR ?? '.local-data')}, Docker MySQL ${host}:${port} unreachable)`}
  }
  const mgmtPass = encodeURIComponent(dockerEnv.MYSQL_MGMT_PASSWORD || 'ac_mgmt_change_me')
  const execPass = encodeURIComponent(dockerEnv.MYSQL_EXEC_PASSWORD || 'ac_exec_change_me')
  const repoPass = encodeURIComponent(dockerEnv.MYSQL_REPO_PASSWORD || 'ac_repo_change_me')
  return {
    env: {
      STORAGE_DRIVER: 'mysql',
      MYSQL_MGMT_URL: `mysql://ac_mgmt:${mgmtPass}@${host}:${port}/app_center_mgmt`,
      MYSQL_EXEC_URL: `mysql://ac_exec:${execPass}@${host}:${port}/app_center_exec`,
      MYSQL_REPO_URL: `mysql://ac_repo:${repoPass}@${host}:${port}/app_center_repo`,
    },
    label: `MySQL 8.0 (${host}:${port} -> app_center_{mgmt,exec,repo}, shared with Docker)`,
  }
}

const configFile = resolve(process.env.APP_DATA_DIR ?? '.local-data', 'local-products.json')
if (!existsSync(configFile)) {
  console.error(`未找到本地产品配置文件：${configFile}`)
  console.error('请先初始化本地 Dify 与 RAGFlow 并生成该文件，或手动设置 DIFY_API_BASE / RAGFLOW_API_BASE 环境变量。')
  process.exit(1)
}

const creds = JSON.parse(readFileSync(configFile, 'utf8'))

async function resolveDifyToken() {
  if (process.env.DIFY_CONSOLE_TOKEN) return process.env.DIFY_CONSOLE_TOKEN
  const base = process.env.DIFY_API_BASE ?? creds.dify?.base ?? ''
  const token = creds.dify?.token ?? ''
  if (base && token) {
    try {
      const probe = await fetch(`${base}/console/api/workspaces/current`, {
        headers: {authorization: `Bearer ${token}`},
        signal: AbortSignal.timeout(8000),
      })
      if (probe.ok) return token
    } catch {
      // Fall through to login refresh.
    }
  }
  if (base && creds.dify?.email && creds.dify?.password) {
    const loginRes = await fetch(`${base}/console/api/login`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email: creds.dify.email, password: creds.dify.password, remember_me: true}),
      signal: AbortSignal.timeout(10000),
    })
    const loginBody = await loginRes.json().catch(() => null)
    if (loginRes.ok && loginBody?.result === 'success' && typeof loginBody?.data?.access_token === 'string') {
      console.log('Refreshed expired Dify console token via local credentials.')
      return loginBody.data.access_token
    }
  }
  return token
}

const freshDifyToken = await resolveDifyToken()
const mysqlConfig = await resolveMysqlEnv()
const defaultEvidenceFile = resolve(dirname(configFile), 'capability-evidence.json')

const env = {
  ...process.env,
  ...mysqlConfig.env,
  DIFY_API_BASE: process.env.DIFY_API_BASE ?? creds.dify?.base ?? '',
  DIFY_CONSOLE_TOKEN: freshDifyToken,
  ...(process.env.DIFY_CONSOLE_EMAIL || !creds.dify?.email ? {} : {DIFY_CONSOLE_EMAIL: creds.dify.email}),
  ...(process.env.DIFY_CONSOLE_PASSWORD || !creds.dify?.password ? {} : {DIFY_CONSOLE_PASSWORD: creds.dify.password}),
  DIFY_WORKSPACE_ID: process.env.DIFY_WORKSPACE_ID ?? creds.dify?.workspaceId ?? '',
  DIFY_INSTALL_ACCOUNT: process.env.DIFY_INSTALL_ACCOUNT ?? creds.dify?.installAccount ?? '',
  DIFY_PLUGIN_DAEMON_BASE: process.env.DIFY_PLUGIN_DAEMON_BASE ?? creds.dify?.pluginDaemon?.base ?? '',
  DIFY_PLUGIN_DAEMON_KEY: process.env.DIFY_PLUGIN_DAEMON_KEY ?? creds.dify?.pluginDaemon?.key ?? '',
  RAGFLOW_API_BASE: process.env.RAGFLOW_API_BASE ?? creds.ragflow?.base ?? '',
  RAGFLOW_API_KEY: process.env.RAGFLOW_API_KEY ?? creds.ragflow?.apiKey ?? '',
  RAGFLOW_TENANT_ID: process.env.RAGFLOW_TENANT_ID ?? creds.ragflow?.tenantId ?? '',
  CAPABILITY_STRICT_UPSTREAM: process.env.CAPABILITY_STRICT_UPSTREAM ?? '1',
  ...(process.env.CAPABILITY_EVIDENCE_FILE ? {} : existsSync(defaultEvidenceFile) ? {CAPABILITY_EVIDENCE_FILE: defaultEvidenceFile} : {}),
}

let daemonProxy
if (process.env.DIFY_LOCAL_DAEMON_PROXY === '1' || creds.dify?.pluginDaemon?.mode === 'local-docker-proxy') {
  daemonProxy = await startLocalDaemonProxy({dir: dirname(configFile), difyBase: env.DIFY_API_BASE})
  env.DIFY_PLUGIN_DAEMON_BASE = daemonProxy.base
  env.DIFY_PLUGIN_DAEMON_KEY = daemonProxy.token
}

console.log('Starting App Center (live mode):')
console.log(`  Storage: ${mysqlConfig.label}`)
console.log(`  Dify:    ${env.DIFY_API_BASE} (workspace=${env.DIFY_WORKSPACE_ID})`)
console.log(`  RAGFlow: ${env.RAGFLOW_API_BASE} (tenant=${env.RAGFLOW_TENANT_ID})`)
console.log(`  Strict:  CAPABILITY_STRICT_UPSTREAM=${env.CAPABILITY_STRICT_UPSTREAM}`)
if (env.CAPABILITY_EVIDENCE_FILE) console.log(`  Evidence: ${env.CAPABILITY_EVIDENCE_FILE}`)

const require = createRequire(import.meta.url)
const viteCli = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js')
const child = spawn(process.execPath, [viteCli, ...process.argv.slice(2)], {
  windowsHide: true,
  stdio: 'inherit',
  env,
})
child.on('error', () => {
  console.error('Vite 启动失败，请检查本地依赖。')
  process.exitCode = 1
  void daemonProxy?.close()
})
child.on('exit', async (code, signal) => {
  try {await daemonProxy?.close()} catch {console.error('本次 Daemon 代理清理失败，请查证本地代理日志。'); process.exitCode = 1}
  process.exitCode ||= code ?? (signal ? 1 : 0)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
