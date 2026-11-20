import {existsSync, readFileSync} from 'node:fs'
import {resolve, dirname} from 'node:path'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {startLocalDaemonProxy} from './live-verification/daemon-proxy.mjs'

const configFile = resolve(process.env.APP_DATA_DIR ?? '.local-data', 'local-products.json')
if (!existsSync(configFile)) {
  console.error(`未找到本地产品配置文件：${configFile}`)
  console.error('请先初始化本地 Dify 与 RAGFlow 并生成该文件，或手动设置 DIFY_API_BASE / RAGFLOW_API_BASE 环境变量。')
  process.exit(1)
}

const creds = JSON.parse(readFileSync(configFile, 'utf8'))

const env = {
  ...process.env,
  DIFY_API_BASE: process.env.DIFY_API_BASE ?? creds.dify?.base ?? '',
  DIFY_CONSOLE_TOKEN: process.env.DIFY_CONSOLE_TOKEN ?? creds.dify?.token ?? '',
  DIFY_WORKSPACE_ID: process.env.DIFY_WORKSPACE_ID ?? creds.dify?.workspaceId ?? '',
  DIFY_INSTALL_ACCOUNT: process.env.DIFY_INSTALL_ACCOUNT ?? creds.dify?.installAccount ?? '',
  DIFY_PLUGIN_DAEMON_BASE: process.env.DIFY_PLUGIN_DAEMON_BASE ?? creds.dify?.pluginDaemon?.base ?? '',
  DIFY_PLUGIN_DAEMON_KEY: process.env.DIFY_PLUGIN_DAEMON_KEY ?? creds.dify?.pluginDaemon?.key ?? '',
  RAGFLOW_API_BASE: process.env.RAGFLOW_API_BASE ?? creds.ragflow?.base ?? '',
  RAGFLOW_API_KEY: process.env.RAGFLOW_API_KEY ?? creds.ragflow?.apiKey ?? '',
  RAGFLOW_TENANT_ID: process.env.RAGFLOW_TENANT_ID ?? creds.ragflow?.tenantId ?? '',
  CAPABILITY_STRICT_UPSTREAM: process.env.CAPABILITY_STRICT_UPSTREAM ?? '1',
}

let daemonProxy
if (process.env.DIFY_LOCAL_DAEMON_PROXY === '1' || creds.dify?.pluginDaemon?.mode === 'local-docker-proxy') {
  daemonProxy = await startLocalDaemonProxy({dir: dirname(configFile), difyBase: env.DIFY_API_BASE})
  env.DIFY_PLUGIN_DAEMON_BASE = daemonProxy.base
  env.DIFY_PLUGIN_DAEMON_KEY = daemonProxy.token
}

console.log('Starting App Center (live mode):')
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
