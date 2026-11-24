import {testPluginArchive} from '../tests/fixtures/plugin-archive.mjs'

const BASE = process.env.APP_CENTER_URL || 'http://localhost:8088'
const PASSWORD = process.env.KPW_PASSWORD || 'Kpw@2026!'
const enc = s => new TextEncoder().encode(s)

async function login(account) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({account, password: PASSWORD}),
  })
  if (!res.ok) throw new Error(`登录失败 ${account}: HTTP ${res.status}`)
  const cookie = res.headers.get('set-cookie')?.split(';')[0] || ''
  return {
    get: p => fetch(`${BASE}${p}`, {headers: {cookie}}).then(async r => ({ok: r.ok, status: r.status, data: await r.json().catch(() => ({}))})),
    post: (p, b) =>
      fetch(`${BASE}${p}`, {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify(b),
      }).then(async r => ({ok: r.ok, status: r.status, data: await r.json().catch(() => ({}))})),
    upload: async (p, bytes, filename, key) => {
      const fd = new FormData()
      fd.append('file', new Blob([bytes], {type: 'application/octet-stream'}), filename)
      const r = await fetch(`${BASE}${p}`, {method: 'POST', headers: {cookie, 'idempotency-key': key}, body: fd})
      return {ok: r.ok, status: r.status, data: await r.json().catch(() => ({}))}
    },
  }
}

const results = []
async function checkCase(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({name, ok: true, ms: Date.now() - t0, detail})
  } catch (err) {
    results.push({name, ok: false, ms: Date.now() - t0, detail: err instanceof Error ? err.message : String(err)})
  }
}

const user = await login('chen.yu@kpw.com')
const admin = await login('li.qiang@kpw.com')
const runId = Date.now().toString(36)

// 1. AG-02 智能体内部组件依赖核验（正例：无依赖应用 + 反例：含外部 HTTP 节点）
await checkCase('1A. AG-02 组件核验（无外部依赖应用）', async () => {
  const res = await user.get('/api/resources/dify_app/394c2f37-1828-4332-8553-bd5175bd6f9c?workspaceId=bec29b57-9586-4dd6-9707-bdc82980ad3b')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const sum = res.data?.data?.dependencySummary
  if (!sum || sum.warnings !== 0) throw new Error(`预期 0 告警，实际 ${JSON.stringify(sum)}`)
  return `mode=${res.data.data.mode}, total=${sum.total}, warnings=0`
})

await checkCase('1B. AG-02 组件核验（含外部 HTTP 风险节点）', async () => {
  const res = await user.get('/api/resources/dify_app/683b2452-f13b-4957-b929-12ab23bae2e7?workspaceId=bec29b57-9586-4dd6-9707-bdc82980ad3b')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const sum = res.data?.data?.dependencySummary
  if (!sum || sum.warnings < 1) throw new Error(`预期检出风险告警，实际 ${JSON.stringify(sum)}`)
  return `检出 ${sum.warnings} 项未审风险组件（${res.data.data.dependencies[0]?.name}）`
})

// 2. KB-02 文档正文切片零留存扫描 + CFG-02 敏感词试扫正反例
await checkCase('2A. KB-02 真实 RAGFlow 正文切片流式扫描', async () => {
  const res = await user.get('/api/execution-contexts?ticketType=KB-02&action=publish_dataset&resourceId=88efbab2e49211f1b3faca129c6e00ef&workspaceId=889e9574e49211f1b3faca129c6e00ef')
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.data?.error?.message || ''}`)
  const f = res.data?.fields || {}
  const docs = f['文档审查明细'] || []
  const chunks = docs.reduce((s, d) => s + (d.scannedChunks || 0), 0)
  return `文档=${docs.length}, 扫描切片=${chunks}, 结论=${f['关键词扫描结论']}`
})

await checkCase('2B. CFG-02 敏感词试扫（反例：命中阻断词）', async () => {
  const res = await admin.post('/api/keyword-rules/dry-run', {text: '本文件属于内部涉密材料，严禁外传，password=Admin123'})
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (res.data.verdict === '通过' || !res.data.hits?.length) throw new Error(`未拦截敏感词：${JSON.stringify(res.data)}`)
  return `verdict=${res.data.verdict}, 命中 ${res.data.hits.length} 条规则`
})

// 3. PLG-01 .difypkg 本地静态 Python 代码扫描正反例
await checkCase('3A. PLG-01 代码扫描（正例：合规插件包）', async () => {
  const bytes = testPluginArchive({uniqueIdentifier: `kpw/hc-${runId}`, name: '巡检合规插件', version: '1.0.0'})
  const up = await user.upload('/api/intake/plugin', bytes, `hc-${runId}.difypkg`, `hc-ok-${runId}`)
  if (up.data?.status !== 'ready') throw new Error(`预期 ready，实际 ${up.status} ${JSON.stringify(up.data)}`)
  return `status=ready, intakeId=${up.data.intakeId}`
})

await checkCase('3B. PLG-01 代码扫描（反例：含 os.system 恶意包拦截）', async () => {
  const bytes = testPluginArchive({uniqueIdentifier: `kpw/hc-evil-${runId}`, name: '恶意插件', version: '1.0.0'}, {'evil.py': enc('import os\nos.system("id")\n')})
  const up = await user.upload('/api/intake/plugin', bytes, `hc-evil-${runId}.difypkg`, `hc-evil-${runId}`)
  if (up.data?.status !== 'rejected') throw new Error(`预期 rejected，实际 ${up.status} ${JSON.stringify(up.data)}`)
  return `成功拦截 status=rejected`
})

// 4. MCP-01 实时 tools/call 合规探测
await checkCase('4A. MCP-01 预设题库 + 实时 tools/call 探测', async () => {
  const res = await user.get('/api/resources/mcp_registration/reg-local-time-01')
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.data?.error?.message || ''}`)
  const rpt = res.data?.data?.complianceReport
  if (!rpt || rpt.executedCases < 1) throw new Error(`缺少合规探测报告`)
  return `执行=${rpt.executedCases} 题, 实时调用=${rpt.liveProbedCases} 题, 结论=${rpt.verdict}`
})

// 5. RBAC 权限边界（管理员可读写，普通用户 403 拦截）
await checkCase('5A. CFG-* 管理员访问放行（200）', async () => {
  const [o, k, m] = await Promise.all([admin.get('/api/organizations'), admin.get('/api/keyword-rules'), admin.get('/api/mcp-test-suites')])
  if (!o.ok || !k.ok || !m.ok) throw new Error(`HTTP ${o.status}/${k.status}/${m.status}`)
  return `orgs=${o.data.items.length}, kwRules=${k.data.items.length}, mcpCases=${m.data.items.length}`
})

await checkCase('5B. CFG-02 普通用户越权拦截（403）', async () => {
  const res = await user.get('/api/keyword-rules')
  if (res.status !== 403) throw new Error(`预期 403，实际 HTTP ${res.status}`)
  return `已拦截 HTTP 403 ACCESS_DENIED`
})

// 输出汇总报告
console.log('\n================ AI 应用中心 · 安全审查与核心接口巡检报告 ================')
let failed = 0
for (const r of results) {
  const icon = r.ok ? 'PASS' : 'FAIL'
  if (!r.ok) failed += 1
  console.log(`[${icon}] ${r.name.padEnd(36, ' ')} (${String(r.ms).padStart(4, ' ')}ms) | ${r.detail}`)
}
console.log('========================================================================')
console.log(`总计 ${results.length} 项：通过 ${results.length - failed} 项，失败 ${failed} 项\n`)
if (failed > 0) process.exit(1)
