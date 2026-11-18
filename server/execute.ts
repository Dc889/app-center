import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const ledgerPath = path.join(root, 'data', 'downloads.json')

type CatalogItem = {
  name: string
  status: string
  orgs: string[]
  sourceId: string
  version: string
  file: string
}

type ExecuteRequest = {
  ticketNo?: string
  ticketType?: string
  action?: string
  resourceId?: string
  account?: string
  org?: string
}

export type ExecuteResult = {
  ok: boolean
  failureReason: string
  resultId: string
  version: string
  sha256: string
}

const catalog: CatalogItem[] = [
  { name: '公文摘要 Skill', status: '可下载', orgs: [], sourceId: 'skl_doc', version: 'v2.1.0', file: 'skl_doc.txt' },
  { name: '表格分析 Skill', status: '可下载', orgs: ['业务一部'], sourceId: 'skl_sheet', version: 'v1.8.2', file: 'skl_sheet.txt' },
]

const pluginPackages = [
  { name: 'document-parser', version: 'v2.4.1', file: 'document-parser.txt' },
]

function cannotExecute(reason = '无法自动执行'): ExecuteResult {
  return { ok: false, failureReason: reason, resultId: '', version: '', sha256: '' }
}

function readLedger(): Array<Record<string, string>> {
  try {
    return JSON.parse(readFileSync(ledgerPath, 'utf8')) as Array<Record<string, string>>
  } catch {
    return []
  }
}

async function executePluginInstall(request: ExecuteRequest): Promise<ExecuteResult> {
  const pack = pluginPackages.find((entry) => entry.name === request.resourceId)
  if (!pack) return cannotExecute('内网插件包目录中没有这个包')
  const bytes = readFileSync(path.join(root, 'plugin-packages', pack.file))
  const base = process.env.DIFY_API_BASE
  const token = process.env.DIFY_CONSOLE_TOKEN
  if (!base || !token) return cannotExecute('无法自动执行：Dify 控制台地址或登录凭证未配置')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const headers = { Authorization: `Bearer ${token}` }
  const upload = new FormData()
  upload.append('pkg', new Blob([bytes]), pack.file)
  const uploadedResponse = await fetch(new URL('/console/api/workspaces/current/plugin/upload/pkg', base), {
    method: 'POST',
    headers,
    body: upload,
  })
  if (!uploadedResponse.ok) return cannotExecute(`无法自动执行：上传内网包失败 ${uploadedResponse.status}`)
  const uploaded = await uploadedResponse.json() as { unique_identifier?: string }
  if (!uploaded.unique_identifier) return cannotExecute('无法自动执行：上传结果没有插件标识')
  const installedResponse = await fetch(new URL('/console/api/workspaces/current/plugin/install/pkg', base), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ plugin_unique_identifiers: [uploaded.unique_identifier] }),
  })
  if (!installedResponse.ok) return cannotExecute(`无法自动执行：安装内网包失败 ${installedResponse.status}`)
  return { ok: true, failureReason: '', resultId: uploaded.unique_identifier, version: pack.version, sha256 }
}

export async function executeTicket(request: ExecuteRequest): Promise<ExecuteResult> {
  if (request?.ticketType === 'PLG-03' && request.action === 'install') return executePluginInstall(request)
  if (!request || request.ticketType !== 'SKL-03' || request.action !== 'download') return cannotExecute()
  const item = catalog.find((entry) => entry.name === request.resourceId)
  if (!item || item.status !== '可下载') return cannotExecute('目录中没有可下载的 Skill')
  if (item.orgs.length > 0 && !item.orgs.includes(request.org ?? '')) return cannotExecute('不在下载范围内')
  const bytes = readFileSync(path.join(root, 'skill-objects', item.file))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const resultId = `DL-${Date.now()}`
  const ledger = readLedger()
  ledger.push({
    resultId,
    ticketNo: request.ticketNo ?? '',
    account: request.account ?? '',
    org: request.org ?? '',
    name: item.name,
    version: item.version,
    sha256,
    at: new Date().toISOString(),
  })
  mkdirSync(path.dirname(ledgerPath), { recursive: true })
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2))
  return { ok: true, failureReason: '', resultId, version: item.version, sha256 }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  const allowed = await executeTicket({ ticketNo: 'SKL-TEST-1', ticketType: 'SKL-03', action: 'download', resourceId: '公文摘要 Skill', account: 'chen.yu', org: '业务一部' })
  const denied = await executeTicket({ ticketNo: 'SKL-TEST-2', ticketType: 'SKL-03', action: 'download', resourceId: '表格分析 Skill', account: 'zhou.min', org: '平台运营组' })
  const other = await executeTicket({ ticketNo: 'KEY-TEST', ticketType: 'KEY-01', action: 'create', resourceId: '调试密钥', account: 'chen.yu', org: '业务一部' })
  const plugin = await executeTicket({ ticketNo: 'PLG-TEST', ticketType: 'PLG-03', action: 'install', resourceId: 'document-parser', account: 'chen.yu', org: '业务一部' })
  if (!allowed.ok || denied.ok || denied.failureReason !== '不在下载范围内' || other.failureReason !== '无法自动执行' || !plugin.failureReason.includes('无法自动执行')) {
    console.error(JSON.stringify({ allowed, denied, other }))
    process.exit(1)
  }
  console.log(JSON.stringify({ allowed: allowed.resultId, denied: denied.failureReason, other: other.failureReason }))
}
