import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawn} from 'node:child_process'

const configFile = resolve(process.env.APP_DATA_DIR ?? '.local-data', 'local-products.json')
if (!existsSync(configFile)) {
  console.error(`未找到本地产品配置文件：${configFile}`)
  console.error('请先初始化本地 Dify 与 RAGFlow 并生成该文件，或手动设置 DIFY_API_BASE / RAGFLOW_API_BASE 环境变量。')
  process.exit(1)
}

const creds = JSON.parse(readFileSync(configFile, 'utf8'))
const evidenceFile = resolve(process.env.APP_DATA_DIR ?? '.local-data', 'capability-evidence.json')

const env = {
  ...process.env,
  DIFY_API_BASE: process.env.DIFY_API_BASE ?? creds.dify?.base ?? '',
  DIFY_CONSOLE_TOKEN: process.env.DIFY_CONSOLE_TOKEN ?? creds.dify?.token ?? '',
  DIFY_WORKSPACE_ID: process.env.DIFY_WORKSPACE_ID ?? creds.dify?.workspaceId ?? '',
  RAGFLOW_API_BASE: process.env.RAGFLOW_API_BASE ?? creds.ragflow?.base ?? '',
  RAGFLOW_API_KEY: process.env.RAGFLOW_API_KEY ?? creds.ragflow?.apiKey ?? '',
  RAGFLOW_TENANT_ID: process.env.RAGFLOW_TENANT_ID ?? creds.ragflow?.tenantId ?? '',
  CAPABILITY_STRICT_UPSTREAM: process.env.CAPABILITY_STRICT_UPSTREAM ?? '1',
  ...(existsSync(evidenceFile) && !process.env.CAPABILITY_EVIDENCE_FILE ? {CAPABILITY_EVIDENCE_FILE: evidenceFile} : {}),
}

console.log('Starting App Center (live mode):')
console.log(`  Dify:    ${env.DIFY_API_BASE} (workspace=${env.DIFY_WORKSPACE_ID})`)
console.log(`  RAGFlow: ${env.RAGFLOW_API_BASE} (tenant=${env.RAGFLOW_TENANT_ID})`)
console.log(`  Strict:  CAPABILITY_STRICT_UPSTREAM=${env.CAPABILITY_STRICT_UPSTREAM}`)
if (env.CAPABILITY_EVIDENCE_FILE) console.log(`  Evidence: ${env.CAPABILITY_EVIDENCE_FILE}`)

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})
child.on('exit', code => process.exit(code ?? 0))
