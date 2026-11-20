import assert from 'node:assert/strict'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {localStack} from './services.mjs'
import {liveProducts} from './live-verification/products.mjs'
import {ledger} from '../runtime/http.mjs'

const dataDir = resolve(process.env.APP_DATA_DIR ?? '.local-data')
const configFile = join(dataDir, 'local-products.json')
const evidenceFile = join(dataDir, 'capability-evidence.json')
if (!existsSync(configFile) || !existsSync(evidenceFile)) {
  console.error('缺少本地产品配置或部署核验证据文件')
  process.exit(1)
}

const creds = JSON.parse(readFileSync(configFile, 'utf8'))
process.env.DIFY_API_BASE = creds.dify.base
process.env.DIFY_CONSOLE_TOKEN = creds.dify.token
process.env.DIFY_WORKSPACE_ID = creds.dify.workspaceId
process.env.RAGFLOW_API_BASE = creds.ragflow.base
process.env.RAGFLOW_API_KEY = creds.ragflow.apiKey
process.env.RAGFLOW_TENANT_ID = creds.ragflow.tenantId
process.env.CAPABILITY_STRICT_UPSTREAM = '1'
process.env.CAPABILITY_EVIDENCE_FILE = evidenceFile

const wsId = creds.dify.workspaceId
const runDir = await mkdtemp(join(tmpdir(), 'app-center-accept-b2-'))
const products = liveProducts({dir: dataDir, credentials: creds})
let stack = null

const report = {
  batch: 'CAP-FIN-04-batch2-TOL-AG-EVT',
  generatedAt: new Date().toISOString(),
  workspaceId: wsId,
  evidenceFile: 'capability-evidence.json',
  tickets: {},
  ok: false,
}

async function reqApi(path, cookie, data, method) {
  return fetch(stack.management + path, {
    method: method ?? (data !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(cookie ? {cookie} : {}),
      ...(data !== undefined ? {'content-type': 'application/json'} : {}),
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  })
}

async function login(account) {
  const res = await reqApi('/api/demo-session', '', {account})
  assert.equal(res.status, 200, `login ${account} failed`)
  return res.headers.get('set-cookie').split(';')[0]
}

async function waitApp(ticketNo, cookie, view = 'query') {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const res = await reqApi(`/api/applications?view=${view}`, cookie)
    assert.equal(res.status, 200)
    const row = (await res.json()).items.find(r => r.ticketNo === ticketNo)
    if (row && (['待结果确认', '已完成', '执行失败', '已驳回', '已撤回', '已终止'].includes(row.status) || ['succeeded', 'failed', 'cancelled'].includes(row.execution?.status))) return row
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error(`timeout waiting for ${ticketNo}`)
}

async function confirmResult(ticketNo, cookie, view = 'query') {
  const row = await waitApp(ticketNo, cookie, view)
  if (row.status === '已完成') return row
  assert.equal(row.status, '待结果确认', `${ticketNo} expected 待结果确认, got ${row.status}`)
  const res = await reqApi('/api/applications/transition', cookie, {
    ticketNo,
    revision: row.revision,
    action: '确认结果',
    note: '整单验收确认结果',
  })
  assert.equal(res.status, 200, `confirm ${ticketNo} failed: ${await res.clone().text()}`)
  const done = await res.json()
  assert.equal(done.status, '已完成')
  return done
}

async function repoAgent(appId) {
  const res = await fetch(`${stack.agent}/internal/v1/agents/${encodeURIComponent(appId)}`, {
    headers: {authorization: `Bearer ${stack.token}`},
  })
  assert.equal(res.status, 200)
  return res.json()
}

function modRecords(module, name) {
  const file = join(runDir, `mod_${module}_${name}.sqlite`)
  if (!existsSync(file)) return []
  const db = new DatabaseSync(file, {readOnly: true})
  try {return db.prepare('SELECT body FROM records').all().map(r => JSON.parse(r.body))}
  finally {db.close()}
}

async function restartStack() {
  await stack.close()
  stack = await localStack(runDir)
}

try {
  await products.api('dify', '/console/api/workspaces/current')
  const app1 = await products.app()
  const app2 = await products.app()
  process.env.DIFY_OWNER_ACCOUNT_MAP = JSON.stringify({[app1.created_by]: 'chen.yu'})

  stack = await localStack(runDir)

  // Verify live capability evidence is loaded and verified for TOL-01 & AG-01~05
  const wsCapRes = await fetch(`${stack.executor}/internal/v1/capabilities?workspaceId=${encodeURIComponent(wsId)}`, {
    headers: {authorization: `Bearer ${stack.token}`},
  })
  assert.equal(wsCapRes.status, 200)
  const wsCapList = (await wsCapRes.json()).items ?? []
  for (const [tt, act] of [
    ['TOL-01', 'set_tool_approval'],
    ['AG-01', 'sync_app'],
    ['AG-02', 'publish'],
    ['AG-03', 'grant_app_access'],
    ['AG-04', 'republish'],
    ['AG-05', 'withdraw_app'],
  ]) {
    const entry = wsCapList.find(a => a.ticketType === tt && a.action === act)
    assert.equal(entry?.state, 'verified', `${tt}/${act} must be verified in workspace scope`)
  }

  let userCookie = await login('chen.yu')
  let opCookie = await login('zhou.min')
  let op2Cookie = await login('wang.ning')
  let adminCookie = await login('li.qiang')

  // ==================== 1. TOL-01 (live Dify 1.7.1 custom API tools) ====================
  const tolCands = await (await reqApi(`/api/execution-candidates?ticketType=TOL-01&action=set_tool_approval&workspaceId=${wsId}&operation=` + encodeURIComponent('首次批准'), opCookie)).json()
  assert.ok(tolCands.items?.length > 0, 'no Dify 1.7.1 tools discovered')
  const toolId = tolCands.items[0].resourceId
  const tolFields = {
    operation: '首次批准',
    description: '整单验收工具审批',
    purpose: '供智能体检索',
    permissions: ['只读检索'],
    targetOrgs: ['业务一部'],
    classification: '内部',
    businessLine: '法制研判',
  }
  // Reject branch
  const tolRej = await (await reqApi('/api/applications', opCookie, {ticketNo: 'TOL-01-acc-rej', ticketType: 'TOL-01', resourceId: toolId, workspaceId: wsId, fields: tolFields})).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'TOL-01-acc-rej', revision: tolRej.revision, action: '驳回', note: '暂不批准'})).status, 200)

  // Normal approve + role boundary + missing security verdict rejected
  const tolOk = await (await reqApi('/api/applications', opCookie, {ticketNo: 'TOL-01-acc-ok', ticketType: 'TOL-01', resourceId: toolId, workspaceId: wsId, fields: tolFields})).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'TOL-01-acc-ok', revision: tolOk.revision, action: '批准', note: '越权', securityVerdict: '通过', securityNote: 'x', externalAllowed: '允许'})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'TOL-01-acc-ok', revision: tolOk.revision, action: '批准', note: '缺安全意见'})).status, 400)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'TOL-01-acc-ok', revision: tolOk.revision, action: '批准', note: '同意批准', securityVerdict: '通过', securityNote: 'schema 核验通过', externalAllowed: '允许'})).status, 200)
  const tolDone = await waitApp('TOL-01-acc-ok', opCookie)
  assert.equal(tolDone.execution?.status, 'succeeded')
  await confirmResult('TOL-01-acc-ok', opCookie)

  // Revoke approval branch
  const tolRev = await (await reqApi('/api/applications', opCookie, {ticketNo: 'TOL-01-acc-rev', ticketType: 'TOL-01', resourceId: toolId, workspaceId: wsId, fields: {...tolFields, operation: '撤销批准'}})).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'TOL-01-acc-rev', revision: tolRev.revision, action: '批准', note: '撤销批准', securityVerdict: '通过', securityNote: '验收后撤销', externalAllowed: '禁止'})).status, 200)
  const tolRevDone = await waitApp('TOL-01-acc-rev', opCookie)
  assert.equal(tolRevDone.execution?.status, 'succeeded')
  await confirmResult('TOL-01-acc-rev', opCookie)
  report.tickets['TOL-01'] = {passed: true, checks: ['live_dify_tool_discovery', 'reject', 'role_403', 'security_verdict_400', 'approve_readback', 'revoke_readback', 'confirm_done'], toolId}
  console.log('[ACCEPT PASS] TOL-01')

  // ==================== 2. AG-01 (live Dify 1.7.1 sync_app) ====================
  const ag01Sub = await reqApi('/api/applications', userCookie, {ticketNo: 'AG-01-acc-ok', ticketType: 'AG-01', resourceId: app2.id, workspaceId: wsId, fields: {}})
  assert.equal(ag01Sub.status, 201)
  const ag01Dup = await reqApi('/api/applications', userCookie, {ticketNo: 'AG-01-acc-ok', ticketType: 'AG-01', resourceId: app2.id, workspaceId: wsId, fields: {}})
  assert.equal(ag01Dup.status, 200)
  const ag01Done = await waitApp('AG-01-acc-ok', userCookie, 'mine')
  assert.equal(ag01Done.execution?.status, 'succeeded')
  assert.ok(modRecords('agents', 'synced-apps').some(r => r.resourceId === app2.id))
  await confirmResult('AG-01-acc-ok', userCookie, 'mine')
  report.tickets['AG-01'] = {passed: true, checks: ['idempotency', 'self_service_sync', 'live_dify_readback', 'confirm_done'], appId: app2.id}
  console.log('[ACCEPT PASS] AG-01')

  // ==================== 3. AG-02 (live Dify 1.7.1 publish) ====================
  const ag02Fields = {
    scenario: '整单验收摘要研判',
    instructions: '输入文本生成摘要',
    businessLine: '法制研判',
    classification: '内部',
    scope: 'orgs',
    targetOrgs: ['业务一部'],
    boundaryOrgs: ['业务一部'],
    usages: ['run', 'api'],
  }
  const ag02Wd = await (await reqApi('/api/applications', userCookie, {ticketNo: 'AG-02-acc-wd', ticketType: 'AG-02', resourceId: app1.id, workspaceId: wsId, fields: ag02Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'AG-02-acc-wd', revision: ag02Wd.revision, action: '撤回', note: '申请人撤回'})).status, 200)

  const ag02Rej = await (await reqApi('/api/applications', userCookie, {ticketNo: 'AG-02-acc-rej', ticketType: 'AG-02', resourceId: app1.id, workspaceId: wsId, fields: ag02Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'AG-02-acc-rej', revision: ag02Rej.revision, action: '驳回', note: '材料不全'})).status, 200)

  const ag02Row = await (await reqApi('/api/applications', userCookie, {ticketNo: 'AG-02-acc-ok', ticketType: 'AG-02', resourceId: app1.id, workspaceId: wsId, fields: ag02Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'AG-02-acc-ok', revision: ag02Row.revision, action: '批准', note: '越权'})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'AG-02-acc-ok', revision: ag02Row.revision + 5, action: '批准', note: '旧版本'})).status, 409)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'AG-02-acc-ok', revision: ag02Row.revision, action: '批准', note: '同意发布'})).status, 200)
  const ag02Done = await waitApp('AG-02-acc-ok', opCookie)
  assert.equal(ag02Done.execution?.status, 'succeeded')
  const pubRepo = await repoAgent(app1.id)
  assert.equal(pubRepo.status, 'active')
  assert.equal(pubRepo.publicationVersionId, app1.workflow.id)
  await confirmResult('AG-02-acc-ok', userCookie, 'mine')
  report.tickets['AG-02'] = {passed: true, checks: ['withdraw', 'reject', 'role_403', 'stale_revision_409', 'live_publish_readback', 'confirm_done'], appId: app1.id}
  console.log('[ACCEPT PASS] AG-02')

  // ==================== 4. AG-03 (live Dify 1.7.1 grant_app_access) ====================
  const ag03Fields = {
    purpose: '整单验收申请调用',
    startsAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    usages: ['run'],
  }
  const ag03Sub = await reqApi('/api/applications', userCookie, {ticketNo: 'AG-03-acc-ok', ticketType: 'AG-03', resourceId: app1.id, workspaceId: wsId, fields: ag03Fields})
  assert.equal(ag03Sub.status, 201)
  const ag03Row = await ag03Sub.json()
  if (ag03Row.status === '待受理') {
    assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'AG-03-acc-ok', revision: ag03Row.revision, action: '批准', note: '越权'})).status, 403)
    assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'AG-03-acc-ok', revision: ag03Row.revision, action: '批准', note: '同意授权'})).status, 200)
  }
  const ag03Done = await waitApp('AG-03-acc-ok', opCookie)
  assert.equal(ag03Done.execution?.status, 'succeeded')
  await confirmResult('AG-03-acc-ok', userCookie, 'mine')
  report.tickets['AG-03'] = {passed: true, checks: ['grant_access_readback', 'confirm_done'], appId: app1.id}
  console.log('[ACCEPT PASS] AG-03')

  // ==================== 5. AG-04 (live Dify 1.7.1 republish) ====================
  const ag04Rej = await (await reqApi('/api/applications', userCookie, {ticketNo: 'AG-04-acc-rej', ticketType: 'AG-04', resourceId: app1.id, workspaceId: wsId, fields: {changeDescription: '驳回测试'}})).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'AG-04-acc-rej', revision: ag04Rej.revision, action: '驳回', note: '变更说明不足'})).status, 200)

  const ag04Row = await (await reqApi('/api/applications', userCookie, {ticketNo: 'AG-04-acc-ok', ticketType: 'AG-04', resourceId: app1.id, workspaceId: wsId, fields: {changeDescription: '整单验收变更再发布'}})).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'AG-04-acc-ok', revision: ag04Row.revision, action: '批准', note: '越权', riskDecision: 'continue'})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'AG-04-acc-ok', revision: ag04Row.revision, action: '批准', note: '同意再发布', riskDecision: 'continue'})).status, 200)
  const ag04Done = await waitApp('AG-04-acc-ok', opCookie)
  assert.equal(ag04Done.execution?.status, 'succeeded')
  const repubRepo = await repoAgent(app1.id)
  assert.equal(repubRepo.status, 'active')
  assert.ok(repubRepo.revision >= 2)
  await confirmResult('AG-04-acc-ok', userCookie, 'mine')
  report.tickets['AG-04'] = {passed: true, checks: ['reject', 'role_403', 'live_republish_readback', 'confirm_done'], appId: app1.id}
  console.log('[ACCEPT PASS] AG-04')

  // ==================== 6. AG-05 (live Dify 1.7.1 withdraw_app) ====================
  const ag05Fields = {reason: '主动下架', explanation: '整单验收下架', effectiveAt: new Date(Date.now() - 1000).toISOString()}
  const ag05Rej = await (await reqApi('/api/applications', opCookie, {ticketNo: 'AG-05-acc-rej', ticketType: 'AG-05', resourceId: app1.id, workspaceId: wsId, fields: ag05Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'AG-05-acc-rej', revision: ag05Rej.revision, action: '驳回', note: '暂缓下架'})).status, 200)

  const ag05Row = await (await reqApi('/api/applications', opCookie, {ticketNo: 'AG-05-acc-ok', ticketType: 'AG-05', resourceId: app1.id, workspaceId: wsId, fields: ag05Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'AG-05-acc-ok', revision: ag05Row.revision, action: '批准', note: '越权', disposalScope: ['仓库下架', '撤销访问授权'], riskDecision: 'continue'})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'AG-05-acc-ok', revision: ag05Row.revision, action: '批准', note: '同意下架', disposalScope: ['仓库下架', '撤销访问授权'], riskDecision: 'continue'})).status, 200)
  const ag05Done = await waitApp('AG-05-acc-ok', opCookie)
  assert.equal(ag05Done.execution?.status, 'succeeded')
  const wdRepo = await repoAgent(app1.id)
  assert.equal(wdRepo.status, 'withdrawn')
  await confirmResult('AG-05-acc-ok', opCookie)
  report.tickets['AG-05'] = {passed: true, checks: ['reject', 'role_403', 'live_withdraw_readback', 'confirm_done'], appId: app1.id}
  console.log('[ACCEPT PASS] AG-05')

  // ==================== 7. EVT-01 (manual lifecycle + independent review + 0 capability writes) ====================
  const execCount = () => {
    const db = ledger(runDir, 'executions')
    try {return db.all().length} finally {db.close()}
  }
  const beforeEvtExecs = execCount()
  const ev1 = await reqApi('/api/events', userCookie, {ticketNo: 'EVT-01-acc-ok', resourceId: app1.id, objectType: '智能体', facts: '整单验收人工上报事件'})
  assert.equal(ev1.status, 201)
  let evRow = await ev1.json()
  // Admin cannot handle event
  assert.equal((await reqApi('/api/events/transition', adminCookie, {ticketNo: 'EVT-01-acc-ok', revision: evRow.revision, action: '开始处置', note: '越权'})).status, 403)
  const evStart = await reqApi('/api/events/transition', opCookie, {ticketNo: 'EVT-01-acc-ok', revision: evRow.revision, action: '开始处置', note: '开始核查', assessment: {severity: '一般', conclusion: '真实故障', cause: '产品服务', impact: '单工作区'}})
  assert.equal(evStart.status, 200)
  evRow = await evStart.json()
  const evSub = await reqApi('/api/events/transition', opCookie, {ticketNo: 'EVT-01-acc-ok', revision: evRow.revision, action: '提交复核', note: '已完成观察', disposition: {actions: ['观察'], result: '服务恢复正常', recovered: true, recoveredAt: new Date().toISOString()}})
  assert.equal(evSub.status, 200)
  evRow = await evSub.json()
  // Self-review denied
  assert.equal((await reqApi('/api/events/transition', opCookie, {ticketNo: 'EVT-01-acc-ok', revision: evRow.revision, action: '确认关闭', note: '自复核'})).status, 403)
  const evClose = await reqApi('/api/events/transition', op2Cookie, {ticketNo: 'EVT-01-acc-ok', revision: evRow.revision, action: '确认关闭', note: '独立复核确认关闭'})
  assert.equal(evClose.status, 200)
  evRow = await evClose.json()
  assert.equal(evRow.status, '已关闭')
  assert.equal(execCount(), beforeEvtExecs, 'EVT-01 must not trigger unexpected capability executions')

  // Restart persistence across TOL-01, AG-01~05, EVT-01
  await restartStack()
  opCookie = await login('zhou.min')
  userCookie = await login('chen.yu')
  assert.equal((await waitApp('TOL-01-acc-rev', opCookie)).status, '已完成')
  assert.equal((await waitApp('AG-05-acc-ok', opCookie)).status, '已完成')
  const eventsAfterRestart = await (await reqApi('/api/events?view=mine', userCookie)).json()
  assert.equal(eventsAfterRestart.items.find(r => r.ticketNo === 'EVT-01-acc-ok')?.status, '已关闭')
  report.tickets['EVT-01'] = {passed: true, checks: ['admin_403', 'assess', 'dispose', 'self_review_403', 'independent_close', 'zero_capability_executions', 'restart_persistence']}
  console.log('[ACCEPT PASS] EVT-01')

  report.ok = true
} catch (err) {
  report.error = {code: err.code ?? 'ACCEPT_FAILED', message: err.message}
  console.error('ACCEPT BATCH2 FAILED:', err)
  process.exitCode = 1
} finally {
  await stack?.close()
  await rm(runDir, {recursive: true, force: true})
  report.cleanupOk = await products.close()
  report.ok = report.ok && report.cleanupOk
  report.finishedAt = new Date().toISOString()
  const out = JSON.stringify(report, null, 2) + '\n'
  writeFileSync(resolve(dataDir, 'accept-batch2-report.json'), out)
}

console.log(`Batch 2 acceptance: ${Object.values(report.tickets).filter(t => t.passed).length}/7 passed; cleanup ${report.cleanupOk ? 'PASS' : 'FAIL'}; overall ${report.ok ? 'PASS' : 'FAIL'}`)
if (!report.ok) process.exitCode = 1
