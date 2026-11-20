import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {localStack} from './services.mjs'
import {liveProducts} from './live-verification/products.mjs'
import {buildLivePlugin, loadLivePluginName} from './live-verification/plugin-package.mjs'
import {startLocalDaemonProxy} from './live-verification/daemon-proxy.mjs'
import {inspectPluginArchive} from '../capability/modules/plugins/adapters/package-archive.mjs'
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
process.env.DIFY_INSTALL_ACCOUNT = 'chen.yu'

const wsId = creds.dify.workspaceId
const runDir = await mkdtemp(join(tmpdir(), 'app-center-accept-b3-'))
const typeFixture = ledger(runDir, 'ticket-types')
typeFixture.put('PLG-03/1', {
  code: 'PLG-03', version: '1', name: '插件操作整单验收配置', workspaceId: wsId,
  status: 'published', revision: 1, branchFlows: {upgrade: 'approval', uninstall: 'approval'}, enabledOrgs: [],
})
typeFixture.close()

const products = liveProducts({dir: dataDir, credentials: creds})
const livePluginName = loadLivePluginName(dataDir)
let stack = null
let daemonProxy = null

const report = {
  batch: 'CAP-FIN-04-batch3-KB-PLG',
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

async function waitApp(ticketNo, cookie, view = 'query', timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await reqApi(`/api/applications?view=${view}`, cookie)
    assert.equal(res.status, 200)
    const row = (await res.json()).items.find(r => r.ticketNo === ticketNo)
    if (row && (['待结果确认', '待运维确认', '已完成', '执行失败', '已驳回', '已撤回', '已终止'].includes(row.status) || ['succeeded', 'failed', 'cancelled'].includes(row.execution?.status))) return row
    await new Promise(r => setTimeout(r, 200))
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

function modRecords(module, name) {
  const file = join(runDir, `mod_${module}_${name}.sqlite`)
  if (!existsSync(file)) return []
  const db = new DatabaseSync(file, {readOnly: true})
  try {return db.prepare('SELECT body FROM records').all().map(r => JSON.parse(r.body))}
  finally {db.close()}
}

async function uploadPlugin(cookie, bytes, filename, key) {
  const form = new FormData()
  form.append('file', new Blob([bytes], {type: 'application/octet-stream'}), filename)
  const up = await fetch(stack.management + '/api/intake/plugin', {
    method: 'POST',
    headers: {cookie, 'idempotency-key': key},
    body: form,
  })
  assert.ok([200, 201].includes(up.status), `plugin intake ${filename} failed: ${up.status} ${await up.clone().text()}`)
  return up.json()
}

async function repoPlugin(resourceId, suffix = '') {
  const res = await fetch(`${stack.plugin}/internal/v1/plugins/${encodeURIComponent(resourceId)}${suffix}`, {
    headers: {authorization: `Bearer ${stack.token}`},
  })
  assert.equal(res.status, 200)
  return res.json()
}

async function restartStack() {
  await stack.close()
  stack = await localStack(runDir)
}

try {
  await products.api('dify', '/console/api/workspaces/current')
  daemonProxy = await startLocalDaemonProxy({dir: dataDir, difyBase: creds.dify.base})
  process.env.DIFY_PLUGIN_DAEMON_BASE = daemonProxy.base
  process.env.DIFY_PLUGIN_DAEMON_KEY = daemonProxy.token

  const difyDatasetId = await products.dataset('dify')
  const ragDatasetId = await products.dataset('ragflow')
  const difyDs = await products.api('dify', `/console/api/datasets/${difyDatasetId}`)
  const ragDs = await products.api('ragflow', `/api/v1/datasets?id=${ragDatasetId}`)
  process.env.DIFY_OWNER_ACCOUNT_MAP = JSON.stringify({[difyDs.created_by]: 'chen.yu'})
  process.env.RAGFLOW_OWNER_ACCOUNT_MAP = JSON.stringify({[ragDs.data[0].created_by]: 'chen.yu'})

  stack = await localStack(runDir)

  // Verify live capability evidence is verified for KB-01/02/04/05 and PLG-01/02/03
  const globalCap = (await (await fetch(`${stack.executor}/internal/v1/capabilities`, {headers: {authorization: `Bearer ${stack.token}`}})).json()).items ?? []
  for (const [tt, act] of [['PLG-01', 'publish_package'], ['PLG-02', 'revise_package']]) {
    assert.equal(globalCap.find(a => a.ticketType === tt && a.action === act)?.state, 'verified', `${tt}/${act} must be verified`)
  }
  const wsCap = (await (await fetch(`${stack.executor}/internal/v1/capabilities?workspaceId=${encodeURIComponent(wsId)}`, {headers: {authorization: `Bearer ${stack.token}`}})).json()).items ?? []
  for (const [tt, act] of [
    ['KB-01', 'sync_dataset'], ['KB-02', 'publish_dataset'],
    ['KB-04', 'review_dataset_changes'], ['KB-05', 'pause_share'], ['KB-05', 'dispose_dataset'],
    ['PLG-03', 'install'], ['PLG-03', 'upgrade'], ['PLG-03', 'uninstall'],
  ]) {
    assert.equal(wsCap.find(a => a.ticketType === tt && a.action === act)?.state, 'verified', `${tt}/${act} must be verified`)
  }

  let userCookie = await login('chen.yu')
  let opCookie = await login('zhou.min')

  // ==================== 1. KB-01 (live Dify 1.7.1 + RAGFlow 0.22.1) ====================
  const kb1DifySub = await reqApi('/api/applications', userCookie, {ticketNo: 'KB-01-acc-dify', ticketType: 'KB-01', resourceId: difyDatasetId, workspaceId: wsId, fields: {sourceSystem: 'Dify'}})
  assert.equal(kb1DifySub.status, 201)
  const kb1DifyDup = await reqApi('/api/applications', userCookie, {ticketNo: 'KB-01-acc-dify', ticketType: 'KB-01', resourceId: difyDatasetId, workspaceId: wsId, fields: {sourceSystem: 'Dify'}})
  assert.equal(kb1DifyDup.status, 200)
  const kb1DifyDone = await waitApp('KB-01-acc-dify', userCookie, 'mine')
  assert.equal(kb1DifyDone.execution?.status, 'succeeded')
  const difyKbId = kb1DifyDone.execution.result.resultId
  await confirmResult('KB-01-acc-dify', userCookie, 'mine')

  const kb1RagSub = await reqApi('/api/applications', userCookie, {ticketNo: 'KB-01-acc-rag', ticketType: 'KB-01', resourceId: ragDatasetId, workspaceId: creds.ragflow.tenantId, fields: {sourceSystem: 'RAGFlow'}})
  assert.equal(kb1RagSub.status, 201)
  const kb1RagDone = await waitApp('KB-01-acc-rag', userCookie, 'mine')
  assert.equal(kb1RagDone.execution?.status, 'succeeded')
  await confirmResult('KB-01-acc-rag', userCookie, 'mine')
  report.tickets['KB-01'] = {passed: true, checks: ['idempotency', 'dify_sync_readback', 'ragflow_sync_readback', 'confirm_done'], difyKbId}
  console.log('[ACCEPT PASS] KB-01')

  // ==================== 2. KB-02 (live Dify 1.7.1 publish_dataset) ====================
  const kb02Fields = {
    sourceSystem: 'Dify', shareMode: '共享目录', purpose: '整单验收知识库发布',
    name: '整单验收法规知识库', description: 'CAP-FIN-04 发布验证', tags: ['验收'],
    boundaryOrgs: ['业务一部'], classification: '内部', businessLine: '法制研判',
  }
  const kb02Wd = await (await reqApi('/api/applications', userCookie, {ticketNo: 'KB-02-acc-wd', ticketType: 'KB-02', resourceId: difyKbId, workspaceId: wsId, fields: kb02Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'KB-02-acc-wd', revision: kb02Wd.revision, action: '撤回', note: '申请人撤回'})).status, 200)

  const kb02Rej = await (await reqApi('/api/applications', userCookie, {ticketNo: 'KB-02-acc-rej', ticketType: 'KB-02', resourceId: difyKbId, workspaceId: wsId, fields: kb02Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'KB-02-acc-rej', revision: kb02Rej.revision, action: '驳回', note: '暂不发布'})).status, 200)

  const kb02Row = await (await reqApi('/api/applications', userCookie, {ticketNo: 'KB-02-acc-ok', ticketType: 'KB-02', resourceId: difyKbId, workspaceId: wsId, fields: kb02Fields})).json()
  const kb02Confs = (kb02Row.snapshot?.fields?.['文档审查明细'] ?? []).map(d => ({documentId: d.documentId, sha256: d.sha256, verdict: '通过'}))
  assert.ok(kb02Confs.length >= 1)
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'KB-02-acc-ok', revision: kb02Row.revision, action: '批准', note: '越权', confirmations: kb02Confs})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'KB-02-acc-ok', revision: kb02Row.revision, action: '批准', note: '缺逐文档确认'})).status, 400)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'KB-02-acc-ok', revision: kb02Row.revision, action: '批准', note: '逐文档复核通过', confirmations: kb02Confs})).status, 200)
  const kb02Done = await waitApp('KB-02-acc-ok', opCookie)
  assert.equal(kb02Done.execution?.status, 'succeeded')
  assert.equal(modRecords('knowledge', 'datasets').find(r => r.resourceId === difyKbId)?.status, '已发布')
  await confirmResult('KB-02-acc-ok', userCookie, 'mine')
  report.tickets['KB-02'] = {passed: true, checks: ['withdraw', 'reject', 'role_403', 'missing_confirmations_400', 'per_doc_sha256_publish', 'confirm_done']}
  console.log('[ACCEPT PASS] KB-02')

  // ==================== 3. KB-04 (live Dify 1.7.1 review_dataset_changes) ====================
  await products.addDifyDocument(difyDatasetId, 'accept-b3-change')
  const chgRes = await fetch(stack.management + '/internal/v1/dataset-changes', {
    method: 'POST', headers: {authorization: `Bearer ${stack.token}`, 'content-type': 'application/json'},
    body: JSON.stringify({sourceEventId: `chg-acc-${products.runId}`, resourceId: difyKbId}),
  })
  assert.equal(chgRes.status, 201)
  let kb04Row = await chgRes.json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: kb04Row.ticketNo, revision: kb04Row.revision, action: '提交变更审查', note: '非所有者越权'})).status, 403)
  const kb04Sub = await reqApi('/api/applications/transition', userCookie, {ticketNo: kb04Row.ticketNo, revision: kb04Row.revision, action: '提交变更审查', note: '整单验收新增文档补正'})
  assert.equal(kb04Sub.status, 200)
  kb04Row = await kb04Sub.json()
  const kb04Confs = kb04Row.snapshot.fields['文档审查明细'].map(d => ({documentId: d.documentId, sha256: d.sha256, verdict: '通过'}))
  assert.equal(kb04Confs.length, 1)
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: kb04Row.ticketNo, revision: kb04Row.revision, action: '确认审查', note: '越权', reviewVerdict: '通过', confirmations: kb04Confs})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: kb04Row.ticketNo, revision: kb04Row.revision, action: '确认审查', note: '复核新增文档通过', reviewVerdict: '通过', confirmations: kb04Confs})).status, 200)
  const kb04Done = await waitApp(kb04Row.ticketNo, opCookie)
  assert.equal(kb04Done.execution?.status, 'succeeded')
  assert.equal(kb04Done.execution.result.details.values['新目录状态'], '保持发布')
  await confirmResult(kb04Row.ticketNo, userCookie, 'mine')
  report.tickets['KB-04'] = {passed: true, checks: ['live_dify_doc_added', 'trusted_change_event', 'owner_403', 'operator_403', 'per_doc_review_keep_published', 'confirm_done']}
  console.log('[ACCEPT PASS] KB-04')

  // ==================== 4. KB-05 (live Dify 1.7.1 pause_share + dispose_dataset) ====================
  const alertEventId = kb04Row.snapshot.fields['处置证据事件ID']
  assert.ok(alertEventId)
  const alertRes = await fetch(stack.management + '/internal/v1/dataset-alerts', {
    method: 'POST', headers: {authorization: `Bearer ${stack.token}`, 'content-type': 'application/json'},
    body: JSON.stringify({sourceEventId: alertEventId, resourceId: difyKbId, fields: {target: '整库', documentIds: [], reason: '内容违规', facts: '整单验收处置停用真实文档'}}),
  })
  assert.equal(alertRes.status, 201)
  const kb05Init = await alertRes.json()
  const kb05Paused = await waitApp(kb05Init.ticketNo, opCookie)
  assert.equal(kb05Paused.status, '待运维确认')
  // Native Dify documents must still be enabled during pause_share
  const docsWhilePaused = (await products.api('dify', `/console/api/datasets/${difyDatasetId}/documents`)).data
  assert.equal(docsWhilePaused.length, 2)
  assert.ok(docsWhilePaused.every(d => d.enabled === true))

  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: kb05Paused.ticketNo, revision: kb05Paused.revision, action: '批准', note: '越权', dispositionActions: ['目录下架', '停用文档'], recoveryCondition: '重审'})).status, 403)
  const kb05Ap = await reqApi('/api/applications/transition', opCookie, {ticketNo: kb05Paused.ticketNo, revision: kb05Paused.revision, action: '批准', note: '同意整库下架并停用全部真实文档', dispositionActions: ['目录下架', '停用文档'], recoveryCondition: '重新核验后另行发布'})
  assert.equal(kb05Ap.status, 200)
  // Wait for second execution (dispose_dataset) to complete
  const kb05Deadline = Date.now() + 20000
  let kb05Done = null
  while (Date.now() < kb05Deadline) {
    const row = (await (await reqApi('/api/applications?view=query', opCookie)).json()).items.find(r => r.ticketNo === kb05Paused.ticketNo)
    if (row && ['待结果确认', '已完成'].includes(row.status)) {kb05Done = row; break}
    await new Promise(r => setTimeout(r, 150))
  }
  assert.ok(kb05Done && kb05Done.execution?.status === 'succeeded')
  const docsAfterDispose = (await products.api('dify', `/console/api/datasets/${difyDatasetId}/documents`)).data
  assert.ok(docsAfterDispose.every(d => d.enabled === false), 'all Dify documents must be disabled after dispose_dataset')
  assert.equal(modRecords('knowledge', 'datasets').find(r => r.resourceId === difyKbId)?.status, '已下架')
  await confirmResult(kb05Paused.ticketNo, opCookie)
  report.tickets['KB-05'] = {passed: true, checks: ['trusted_alert_pause', 'pause_keeps_docs_enabled', 'role_403', 'dispose_disables_real_docs', 'catalog_withdrawn', 'confirm_done']}
  console.log('[ACCEPT PASS] KB-05')

  // ==================== 5. PLG-01 (real .difypkg + Dify validation) ====================
  const plgV1Bytes = buildLivePlugin(livePluginName, '1.0.0')
  const plgIn1 = await uploadPlugin(userCookie, plgV1Bytes, 'acc-plg-1.0.0.difypkg', 'acc-plg-v1')
  const plg01Fields = {
    intakeId: plgIn1.intakeId, description: '整单验收插件包', instructions: '安装后使用',
    permissions: ['本地计算'], accessMode: '公开免审安装', installationMethod: '本地包', networkAccess: [],
  }
  const plg01Wd = await (await reqApi('/api/applications', userCookie, {ticketNo: 'PLG-01-acc-wd', ticketType: 'PLG-01', resourceId: plgIn1.intakeId, workspaceId: '', fields: plg01Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'PLG-01-acc-wd', revision: plg01Wd.revision, action: '撤回', note: '撤回'})).status, 200)

  const plg01Rej = await (await reqApi('/api/applications', userCookie, {ticketNo: 'PLG-01-acc-rej', ticketType: 'PLG-01', resourceId: plgIn1.intakeId, workspaceId: '', fields: plg01Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'PLG-01-acc-rej', revision: plg01Rej.revision, action: '驳回', note: '驳回'})).status, 200)

  const plg01Row = await (await reqApi('/api/applications', userCookie, {ticketNo: 'PLG-01-acc-ok', ticketType: 'PLG-01', resourceId: plgIn1.intakeId, workspaceId: '', fields: plg01Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'PLG-01-acc-ok', revision: plg01Row.revision, action: '批准', note: '越权', externalAllowed: '允许'})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'PLG-01-acc-ok', revision: plg01Row.revision, action: '批准', note: '同意上架', externalAllowed: '允许'})).status, 200)
  const plg01Done = await waitApp('PLG-01-acc-ok', opCookie)
  assert.equal(plg01Done.execution?.status, 'succeeded')
  const pluginCatalogId = plg01Done.execution.result.resultId
  const plgRepo1 = await repoPlugin(pluginCatalogId)
  assert.equal(plgRepo1.version, '1.0.0')
  assert.equal(inspectPluginArchive(plgV1Bytes).version, '1.0.0')
  assert.equal(plgRepo1.sha256, createHash('sha256').update(plgV1Bytes).digest('hex'))
  await confirmResult('PLG-01-acc-ok', userCookie, 'mine')
  report.tickets['PLG-01'] = {passed: true, checks: ['real_difypkg_manifest', 'withdraw', 'reject', 'role_403', 'repo_sha256_readback', 'confirm_done'], pluginCatalogId}
  console.log('[ACCEPT PASS] PLG-01')

  // ==================== 6. PLG-03 install (1.0.0) + PLG-02 revise (1.1.0) + PLG-03 upgrade & uninstall ====================
  async function runPluginOp(action, operation, version, installationId = '') {
    if (action !== 'uninstall') {
      const bytes = buildLivePlugin(livePluginName, version)
      const form = new FormData(); form.append('pkg', new Blob([bytes]), 'acc.difypkg')
      const up = await products.api('dify', '/console/api/workspaces/current/plugin/upload/pkg', {method: 'POST', body: form})
      products.own('dify', 'plugin', up.unique_identifier)
    }
    const no = `PLG-03-acc-${action}`
    const sub = await reqApi('/api/applications', userCookie, {ticketNo: no, ticketType: 'PLG-03', resourceId: pluginCatalogId, workspaceId: wsId, fields: {operation, purpose: '整单验收真实插件生命周期', installationId}})
    assert.equal(sub.status, 201, `${no} submit failed: ${await sub.clone().text()}`)
    const row = await sub.json()
    if (row.status === '待受理') {
      assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: no, revision: row.revision, action: '批准', note: '越权'})).status, 403)
      assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: no, revision: row.revision, action: '批准', note: `同意${operation}`})).status, 200)
    }
    const done = await waitApp(no, userCookie, 'mine', 300000)
    assert.equal(done.execution?.status, 'succeeded', `${no} failed: ${JSON.stringify(done.execution)}`)
    await confirmResult(no, userCookie, 'mine')
    return done
  }

  const instDone = await runPluginOp('install', '安装', '1.0.0')
  const installationId = instDone.execution.result.details.installationId
  assert.ok(installationId)
  const invAfterInstall = await products.api('dify', '/console/api/workspaces/current/plugin/list?page=1&page_size=100')
  assert.ok(invAfterInstall.plugins.some(p => p.plugin_unique_identifier.startsWith(`appcenter/${livePluginName}:1.0.0@`)))

  // PLG-02 revise 1.1.0
  const plgV2Bytes = buildLivePlugin(livePluginName, '1.1.0')
  const plgIn2 = await uploadPlugin(userCookie, plgV2Bytes, 'acc-plg-1.1.0.difypkg', 'acc-plg-v2')
  const plg02Rej = await (await reqApi('/api/applications', userCookie, {ticketNo: 'PLG-02-acc-rej', ticketType: 'PLG-02', resourceId: pluginCatalogId, workspaceId: '', fields: {intakeId: plgIn2.intakeId, changeDescription: '驳回测试', upgradePolicy: '逐个工单升级'}})).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'PLG-02-acc-rej', revision: plg02Rej.revision, action: '驳回', note: '驳回'})).status, 200)

  const plg02Row = await (await reqApi('/api/applications', userCookie, {ticketNo: 'PLG-02-acc-ok', ticketType: 'PLG-02', resourceId: pluginCatalogId, workspaceId: '', fields: {intakeId: plgIn2.intakeId, changeDescription: '升级 1.1.0', upgradePolicy: '逐个工单升级'}})).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'PLG-02-acc-ok', revision: plg02Row.revision, action: '批准', note: '越权', externalAllowed: '允许'})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'PLG-02-acc-ok', revision: plg02Row.revision, action: '批准', note: '同意升级', externalAllowed: '允许'})).status, 200)
  const plg02Done = await waitApp('PLG-02-acc-ok', opCookie)
  assert.equal(plg02Done.execution?.status, 'succeeded')
  assert.equal((await repoPlugin(pluginCatalogId)).version, '1.1.0')
  await confirmResult('PLG-02-acc-ok', userCookie, 'mine')
  report.tickets['PLG-02'] = {passed: true, checks: ['reject', 'role_403', 'repo_v1_1_0_readback', 'confirm_done']}
  console.log('[ACCEPT PASS] PLG-02')

  // PLG-03 upgrade -> uninstall
  await runPluginOp('upgrade', '升级', '1.1.0', installationId)
  const invAfterUpgrade = await products.api('dify', '/console/api/workspaces/current/plugin/list?page=1&page_size=100')
  assert.ok(invAfterUpgrade.plugins.some(p => p.plugin_unique_identifier.startsWith(`appcenter/${livePluginName}:1.1.0@`)))

  await runPluginOp('uninstall', '卸载', null, installationId)
  const invAfterUninstall = await products.api('dify', '/console/api/workspaces/current/plugin/list?page=1&page_size=100')
  assert.ok(!invAfterUninstall.plugins.some(p => p.plugin_unique_identifier.startsWith(`appcenter/${livePluginName}:`)))

  // Restart persistence
  await restartStack()
  opCookie = await login('zhou.min')
  userCookie = await login('chen.yu')
  assert.equal((await waitApp('PLG-03-acc-uninstall', userCookie, 'mine')).status, '已完成')
  assert.equal((await waitApp(kb05Paused.ticketNo, opCookie)).status, '已完成')
  report.tickets['PLG-03'] = {passed: true, checks: ['native_install_1_0_0', 'native_upgrade_1_1_0', 'native_uninstall_removed', 'role_403', 'restart_persistence', 'confirm_done']}
  console.log('[ACCEPT PASS] PLG-03')

  report.ok = true
} catch (err) {
  report.error = {code: err.code ?? 'ACCEPT_FAILED', message: err.message}
  console.error('ACCEPT BATCH3 FAILED:', err)
  process.exitCode = 1
} finally {
  await stack?.close()
  await daemonProxy?.close()
  await rm(runDir, {recursive: true, force: true})
  report.cleanupOk = await products.close()
  report.ok = report.ok && report.cleanupOk
  report.finishedAt = new Date().toISOString()
  const out = JSON.stringify(report, null, 2) + '\n'
  writeFileSync(resolve(dataDir, 'accept-batch3-report.json'), out)
}

console.log(`Batch 3 acceptance: ${Object.values(report.tickets).filter(t => t.passed).length}/7 passed; cleanup ${report.cleanupOk ? 'PASS' : 'FAIL'}; overall ${report.ok ? 'PASS' : 'FAIL'}`)
if (!report.ok) process.exitCode = 1
