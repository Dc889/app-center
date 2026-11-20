import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {localStack} from './services.mjs'
import {liveProducts, skillArchive} from './live-verification/products.mjs'

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
const runDir = await mkdtemp(join(tmpdir(), 'app-center-accept-b1-'))
const products = liveProducts({dir: dataDir, credentials: creds})
let stack = null

const report = {
  batch: 'CAP-FIN-04-batch1-SKL-KEY',
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
    if (row && (['待结果确认', '待领取', '已完成', '执行失败', '已驳回', '已撤回', '已终止'].includes(row.status) || ['succeeded', 'failed', 'cancelled'].includes(row.execution?.status))) return row
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

async function uploadSkill(cookie, content, filename, key) {
  const form = new FormData()
  form.append('file', new Blob([content], {type: 'application/octet-stream'}), filename)
  const up = await fetch(stack.management + '/api/intake/skill', {
    method: 'POST',
    headers: {cookie, 'idempotency-key': key},
    body: form,
  })
  assert.ok([200, 201].includes(up.status), `intake ${filename} failed: ${up.status} ${await up.clone().text()}`)
  return up.json()
}

async function repoSkill(skillId, suffix = '') {
  const res = await fetch(`${stack.skill}/internal/v1/skills/${encodeURIComponent(skillId)}${suffix}`, {
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
  // Ensure fresh Dify token + isolated Dify app
  await products.api('dify', '/console/api/workspaces/current')
  const appFixture = await products.app()
  process.env.DIFY_OWNER_ACCOUNT_MAP = JSON.stringify({[appFixture.created_by]: 'chen.yu'})

  stack = await localStack(runDir)

  // Verify live capability evidence is loaded and verified for global (SKL) and workspace (KEY) scopes
  const globalCapRes = await fetch(`${stack.executor}/internal/v1/capabilities`, {
    headers: {authorization: `Bearer ${stack.token}`},
  })
  assert.equal(globalCapRes.status, 200)
  const globalCapList = (await globalCapRes.json()).items ?? []
  for (const [tt, act] of [
    ['SKL-01', 'publish_skill'],
    ['SKL-02', 'revise_skill'],
    ['SKL-03', 'download'],
    ['SKL-04', 'withdraw_skill'],
  ]) {
    const entry = globalCapList.find(a => a.ticketType === tt && a.action === act)
    assert.equal(entry?.state, 'verified', `${tt}/${act} must be verified in global scope`)
  }
  const wsCapRes = await fetch(`${stack.executor}/internal/v1/capabilities?workspaceId=${encodeURIComponent(wsId)}`, {
    headers: {authorization: `Bearer ${stack.token}`},
  })
  assert.equal(wsCapRes.status, 200)
  const wsCapList = (await wsCapRes.json()).items ?? []
  for (const [tt, act] of [
    ['KEY-01', 'create_key'],
    ['KEY-02', 'rotate_key'],
    ['KEY-02', 'revoke_key'],
  ]) {
    const entry = wsCapList.find(a => a.ticketType === tt && a.action === act)
    assert.equal(entry?.state, 'verified', `${tt}/${act} must be verified in workspace scope`)
  }

  let userCookie = await login('chen.yu')
  let opCookie = await login('zhou.min')
  let adminCookie = await login('li.qiang')

  // ==================== 1. SKL-01 ====================
  const skillId = 'skl-accept-b1'
  const v1Bytes = skillArchive('b1-v1')
  const v1Sha = createHash('sha256').update(v1Bytes).digest('hex')
  const intake1 = await uploadSkill(userCookie, v1Bytes, 'accept-v1.tar.gz', 'accept-skl-v1')
  const intake1Dup = await uploadSkill(userCookie, v1Bytes, 'accept-v1.tar.gz', 'accept-skl-v1')
  assert.equal(intake1Dup.intakeId, intake1.intakeId, 'idempotency-key must dedup upload')

  const skl01Fields = {
    intakeId: intake1.intakeId,
    name: '整单验收 Skill',
    version: 'v1.0.0',
    description: 'CAP-FIN-04 整单验收',
    instructions: '本地校验运行',
    license: '内部开源',
    tags: ['验收'],
    scope: '全网段公开',
  }

  // Withdraw branch
  const skl01Wd = await (await reqApi('/api/applications', userCookie, {ticketNo: 'SKL-01-acc-wd', ticketType: 'SKL-01', resourceId: skillId, workspaceId: '', fields: skl01Fields})).json()
  const wdRes = await reqApi('/api/applications/transition', userCookie, {ticketNo: 'SKL-01-acc-wd', revision: skl01Wd.revision, action: '撤回', note: '申请人撤回'})
  assert.equal(wdRes.status, 200)
  assert.equal((await wdRes.json()).status, '已撤回')

  // Reject branch
  const skl01Rej = await (await reqApi('/api/applications', userCookie, {ticketNo: 'SKL-01-acc-rej', ticketType: 'SKL-01', resourceId: skillId, workspaceId: '', fields: skl01Fields})).json()
  const rejRes = await reqApi('/api/applications/transition', opCookie, {ticketNo: 'SKL-01-acc-rej', revision: skl01Rej.revision, action: '驳回', note: '材料不全驳回'})
  assert.equal(rejRes.status, 200)
  assert.equal((await rejRes.json()).status, '已驳回')

  // Normal + idempotency + conflict + role boundary + stale revision + restart + confirm
  const skl01Sub = await reqApi('/api/applications', userCookie, {ticketNo: 'SKL-01-acc-ok', ticketType: 'SKL-01', resourceId: skillId, workspaceId: '', fields: skl01Fields})
  assert.equal(skl01Sub.status, 201)
  const skl01Row = await skl01Sub.json()
  const skl01Idem = await reqApi('/api/applications', userCookie, {ticketNo: 'SKL-01-acc-ok', ticketType: 'SKL-01', resourceId: skillId, workspaceId: '', fields: skl01Fields})
  assert.equal(skl01Idem.status, 200)
  assert.equal((await skl01Idem.json()).ticketNo, skl01Row.ticketNo)
  const skl01Conflict = await reqApi('/api/applications', userCookie, {ticketNo: 'SKL-01-acc-ok', ticketType: 'SKL-01', resourceId: skillId, workspaceId: '', fields: {...skl01Fields, description: '篡改'}})
  assert.equal(skl01Conflict.status, 409)

  // Role boundaries
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'SKL-01-acc-ok', revision: skl01Row.revision, action: '批准', note: '越权'})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', adminCookie, {ticketNo: 'SKL-01-acc-ok', revision: skl01Row.revision, action: '批准', note: '越权'})).status, 403)
  // Stale revision
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'SKL-01-acc-ok', revision: skl01Row.revision + 9, action: '批准', note: '旧版本'})).status, 409)
  // Approve
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'SKL-01-acc-ok', revision: skl01Row.revision, action: '批准', note: '同意上架'})).status, 200)
  const skl01Exec = await waitApp('SKL-01-acc-ok', opCookie)
  assert.equal(skl01Exec.execution?.status, 'succeeded')
  const repoV1 = await repoSkill(skillId)
  assert.equal(repoV1.status, 'available')
  assert.equal(repoV1.version, 'v1.0.0')
  assert.equal(repoV1.sha256, v1Sha)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'SKL-01-acc-ok', revision: skl01Exec.revision, action: '确认结果', note: '非申请人越权确认'})).status, 403)
  await confirmResult('SKL-01-acc-ok', userCookie, 'mine')
  report.tickets['SKL-01'] = {passed: true, checks: ['upload_dedup', 'withdraw', 'reject', 'idempotency', 'conflict_409', 'role_403', 'stale_revision_409', 'repo_readback', 'confirm_done']}
  console.log('[ACCEPT PASS] SKL-01')

  // ==================== 2. SKL-02 ====================
  const v2Bytes = skillArchive('b1-v2')
  const v2Sha = createHash('sha256').update(v2Bytes).digest('hex')
  const intake2 = await uploadSkill(userCookie, v2Bytes, 'accept-v2.tar.gz', 'accept-skl-v2')

  // Reject branch
  const skl02Rej = await (await reqApi('/api/applications', userCookie, {
    ticketNo: 'SKL-02-acc-rej', ticketType: 'SKL-02', resourceId: skillId, workspaceId: '',
    fields: {intakeId: intake2.intakeId, newVersion: 'v2.0.0', changeDescription: '驳回测试', compatibility: '向后兼容'},
  })).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'SKL-02-acc-rej', revision: skl02Rej.revision, action: '驳回', note: '版本说明不足'})).status, 200)

  // Normal branch 1: 继续可下载
  const skl02Row = await (await reqApi('/api/applications', userCookie, {
    ticketNo: 'SKL-02-acc-v2', ticketType: 'SKL-02', resourceId: skillId, workspaceId: '',
    fields: {intakeId: intake2.intakeId, newVersion: 'v2.0.0', changeDescription: '升级 v2', compatibility: '向后兼容'},
  })).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'SKL-02-acc-v2', revision: skl02Row.revision, action: '批准', note: '越权', historyPolicy: '继续可下载'})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'SKL-02-acc-v2', revision: skl02Row.revision, action: '批准', note: '同意升级', historyPolicy: '继续可下载'})).status, 200)
  const skl02Exec = await waitApp('SKL-02-acc-v2', opCookie)
  assert.equal(skl02Exec.execution?.status, 'succeeded')
  const repoV2 = await repoSkill(skillId)
  assert.equal(repoV2.version, 'v2.0.0')
  assert.equal(repoV2.sha256, v2Sha)
  await confirmResult('SKL-02-acc-v2', userCookie, 'mine')

  // Normal branch 2: 禁止新增下载
  const v3Bytes = skillArchive('b1-v3')
  const v3Sha = createHash('sha256').update(v3Bytes).digest('hex')
  const intake3 = await uploadSkill(userCookie, v3Bytes, 'accept-v3.tar.gz', 'accept-skl-v3')
  const skl02V3 = await (await reqApi('/api/applications', userCookie, {
    ticketNo: 'SKL-02-acc-v3', ticketType: 'SKL-02', resourceId: skillId, workspaceId: '',
    fields: {intakeId: intake3.intakeId, newVersion: 'v3.0.0', changeDescription: '不兼容升级 v3', compatibility: '不兼容变更'},
  })).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'SKL-02-acc-v3', revision: skl02V3.revision, action: '批准', note: '禁止历史新增下载', historyPolicy: '保留且不可新增下载'})).status, 200)
  await waitApp('SKL-02-acc-v3', opCookie)
  const repoV3 = await repoSkill(skillId)
  assert.equal(repoV3.version, 'v3.0.0')
  assert.equal(repoV3.sha256, v3Sha)
  assert.equal((await repoSkill(skillId, '/versions')).versions.length, 3)
  await confirmResult('SKL-02-acc-v3', userCookie, 'mine')
  report.tickets['SKL-02'] = {passed: true, checks: ['reject', 'role_403', 'history_allow', 'history_forbid', 'versions_readback', 'confirm_done']}
  console.log('[ACCEPT PASS] SKL-02')

  // ==================== 3. SKL-03 ====================
  const tOkRes = await reqApi('/api/tickets', userCookie, {ticketNo: 'SKL-03-acc-ok', ticketType: 'SKL-03', action: 'download', account: 'chen.yu', resourceId: skillId})
  assert.equal(tOkRes.status, 200)
  const tOk = await tOkRes.json()
  assert.equal(tOk.status, 'awaiting_delivery')
  // Idempotent ticket creation
  const tOkDup = await (await reqApi('/api/tickets', userCookie, {ticketNo: 'SKL-03-acc-ok', ticketType: 'SKL-03', action: 'download', account: 'chen.yu', resourceId: skillId})).json()
  assert.equal(tOkDup.resultId, tOk.resultId)
  // Unauthorized & foreign user blocked
  assert.equal((await reqApi('/api/tickets/SKL-03-acc-ok/file', '')).status, 404)
  assert.equal((await reqApi('/api/tickets/SKL-03-acc-ok/file', opCookie)).status, 404)
  // Authorized download twice (idempotent settlement + exact sha256)
  for (let i = 0; i < 2; i++) {
    const fRes = await reqApi('/api/tickets/SKL-03-acc-ok/file', userCookie)
    assert.equal(fRes.status, 200)
    const buf = Buffer.from(await fRes.arrayBuffer())
    assert.ok(buf.equals(v3Bytes))
    assert.equal(fRes.headers.get('x-content-sha256'), v3Sha)
    const stateRow = await (await reqApi('/api/tickets/SKL-03-acc-ok', userCookie)).json()
    assert.equal(stateRow.status, 'succeeded')
    assert.equal(stateRow.resultId, tOk.resultId)
  }

  // Cancel branch
  const tCan = await (await reqApi('/api/tickets', userCookie, {ticketNo: 'SKL-03-acc-can', ticketType: 'SKL-03', action: 'download', account: 'chen.yu', resourceId: skillId})).json()
  const canRes = await reqApi('/api/tickets/SKL-03-acc-can/cancel', opCookie, {executionId: tCan.executionId ?? tCan.resultId.slice(3), note: '整单验收取消交付'})
  assert.equal(canRes.status, 200)
  assert.equal((await canRes.json()).status, 'cancelled')
  const afterCanFile = await reqApi('/api/tickets/SKL-03-acc-can/file', userCookie)
  assert.ok([404, 409].includes(afterCanFile.status), `cancelled file download should fail, got ${afterCanFile.status}`)

  // Restart persistence check for SKL-01~03
  await restartStack()
  userCookie = await login('chen.yu')
  opCookie = await login('zhou.min')
  adminCookie = await login('li.qiang')
  assert.equal((await (await reqApi('/api/tickets/SKL-03-acc-ok', userCookie)).json()).status, 'succeeded')
  assert.equal((await (await reqApi('/api/tickets/SKL-03-acc-can', userCookie)).json()).status, 'cancelled')
  report.tickets['SKL-03'] = {passed: true, checks: ['idempotency', 'anon_404', 'foreign_404', 'sha256_match', 'repeat_download', 'cancel_delivery', 'post_cancel_blocked', 'restart_persistence']}
  console.log('[ACCEPT PASS] SKL-03')

  // ==================== 4. SKL-04 ====================
  const skl04Fields = {reason: '主动下架', explanation: '整单验收下架并保留审计副本', effectiveAt: new Date(Date.now() - 1000).toISOString()}
  const skl04Rej = await (await reqApi('/api/applications', opCookie, {ticketNo: 'SKL-04-acc-rej', ticketType: 'SKL-04', resourceId: skillId, workspaceId: '', fields: skl04Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'SKL-04-acc-rej', revision: skl04Rej.revision, action: '驳回', note: '暂缓下架'})).status, 200)

  const skl04Ok = await (await reqApi('/api/applications', opCookie, {ticketNo: 'SKL-04-acc-ok', ticketType: 'SKL-04', resourceId: skillId, workspaceId: '', fields: skl04Fields})).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'SKL-04-acc-ok', revision: skl04Ok.revision, action: '批准', note: '越权'})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'SKL-04-acc-ok', revision: skl04Ok.revision, action: '批准', note: '同意下架'})).status, 200)
  const skl04Exec = await waitApp('SKL-04-acc-ok', opCookie)
  assert.equal(skl04Exec.execution?.status, 'succeeded')
  const repoWithdrawn = await repoSkill(skillId)
  assert.equal(repoWithdrawn.status, 'withdrawn')
  await confirmResult('SKL-04-acc-ok', opCookie)

  // Post-withdrawal new download blocked
  const postWdDl = await reqApi('/api/tickets', userCookie, {ticketNo: 'SKL-03-after-wd', ticketType: 'SKL-03', action: 'download', account: 'chen.yu', resourceId: skillId})
  assert.notEqual(postWdDl.status, 200, 'withdrawn skill must block new downloads')
  await restartStack()
  userCookie = await login('chen.yu')
  opCookie = await login('zhou.min')
  adminCookie = await login('li.qiang')
  assert.equal((await repoSkill(skillId)).status, 'withdrawn')
  report.tickets['SKL-04'] = {passed: true, checks: ['reject', 'role_403', 'withdraw_readback', 'post_withdraw_blocked', 'restart_persistence', 'confirm_done']}
  console.log('[ACCEPT PASS] SKL-04')

  // ==================== 5. KEY-01 (live Dify 1.7.1) ====================
  const beforeKeys = (await products.api('dify', `/console/api/apps/${appFixture.id}/api-keys`)).data.map(k => k.id)
  const key01Fields = {
    purpose: '本人调试',
    callerName: 'accept-b1',
    callerOrg: '业务一部',
    environment: '开发',
    allowedCidrs: ['127.0.0.1/32'],
    peakQps: 10,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  }
  // Invalid CIDR rejected
  const badCidr = await reqApi('/api/applications', userCookie, {ticketNo: 'KEY-01-acc-bad', ticketType: 'KEY-01', resourceId: appFixture.id, workspaceId: wsId, fields: {...key01Fields, allowedCidrs: ['not-a-cidr']}})
  assert.equal(badCidr.status, 400)

  // Normal self-service debug create_key + idempotency + one-time reveal + foreign denial + live Dify readback
  const key01Sub = await reqApi('/api/applications', userCookie, {ticketNo: 'KEY-01-acc-ok', ticketType: 'KEY-01', resourceId: appFixture.id, workspaceId: wsId, fields: key01Fields})
  assert.equal(key01Sub.status, 201)
  const key01Done = await waitApp('KEY-01-acc-ok', userCookie, 'mine')
  assert.equal(key01Done.execution?.status, 'succeeded')
  const regId = key01Done.execution.result.details.registrationId
  assert.ok(regId && !JSON.stringify(key01Done).includes('app-'), 'secret must not leak in ticket record')
  const afterCreateKeys = (await products.api('dify', `/console/api/apps/${appFixture.id}/api-keys`)).data.map(k => k.id)
  assert.equal(afterCreateKeys.filter(id => !beforeKeys.includes(id)).length, 1)

  // One-time reveal: foreign user denied, applicant succeeds once, second reveal fails
  assert.ok([403, 404].includes((await reqApi('/api/applications/reveal', opCookie, {ticketNo: 'KEY-01-acc-ok'})).status))
  const reveal1 = await reqApi('/api/applications/reveal', userCookie, {ticketNo: 'KEY-01-acc-ok'})
  assert.equal(reveal1.status, 200)
  const revealedBody = await reveal1.json()
  assert.ok(typeof revealedBody.secret === 'string' && revealedBody.secret.startsWith('app-'))
  const reveal2 = await reqApi('/api/applications/reveal', userCookie, {ticketNo: 'KEY-01-acc-ok'})
  assert.notEqual(reveal2.status, 200)
  await confirmResult('KEY-01-acc-ok', userCookie, 'mine')
  report.tickets['KEY-01'] = {passed: true, checks: ['invalid_cidr_400', 'live_dify_key_created', 'no_secret_in_record', 'foreign_reveal_denied', 'one_time_reveal', 'confirm_done'], registrationId: regId}
  console.log('[ACCEPT PASS] KEY-01')

  // ==================== 6. KEY-02 (live Dify 1.7.1) ====================
  // Reject branch
  const key02Rej = await (await reqApi('/api/applications', userCookie, {
    ticketNo: 'KEY-02-acc-rej', ticketType: 'KEY-02', resourceId: regId, workspaceId: wsId,
    fields: {operation: '轮换', reason: '驳回测试', effectiveAt: new Date(Date.now() - 1000).toISOString(), newExpiresAt: new Date(Date.now() + 86400000).toISOString()},
  })).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'KEY-02-acc-rej', revision: key02Rej.revision, action: '驳回', note: '无需轮换'})).status, 200)

  // Rotate branch
  const key02Rot = await (await reqApi('/api/applications', userCookie, {
    ticketNo: 'KEY-02-acc-rot', ticketType: 'KEY-02', resourceId: regId, workspaceId: wsId,
    fields: {operation: '轮换', reason: '定期轮换', effectiveAt: new Date(Date.now() - 1000).toISOString(), newExpiresAt: new Date(Date.now() + 2 * 86400000).toISOString()},
  })).json()
  assert.equal((await reqApi('/api/applications/transition', userCookie, {ticketNo: 'KEY-02-acc-rot', revision: key02Rot.revision, action: '批准', note: '越权'})).status, 403)
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'KEY-02-acc-rot', revision: key02Rot.revision, action: '批准', note: '同意轮换'})).status, 200)
  const rotDone = await waitApp('KEY-02-acc-rot', opCookie)
  assert.equal(rotDone.execution?.status, 'succeeded')
  const rotatedRegId = rotDone.execution.result.details.registrationId
  const afterRotKeys = (await products.api('dify', `/console/api/apps/${appFixture.id}/api-keys`)).data.map(k => k.id)
  assert.equal(afterCreateKeys.filter(id => !afterRotKeys.includes(id)).length, 1, 'old key must be removed on Dify')
  assert.equal(afterRotKeys.filter(id => !afterCreateKeys.includes(id)).length, 1, 'new key must exist on Dify')
  const rotReveal = await reqApi('/api/applications/reveal', userCookie, {ticketNo: 'KEY-02-acc-rot'})
  assert.equal(rotReveal.status, 200)
  assert.ok((await rotReveal.json()).secret?.startsWith('app-'))
  assert.notEqual((await reqApi('/api/applications/reveal', userCookie, {ticketNo: 'KEY-02-acc-rot'})).status, 200)
  await confirmResult('KEY-02-acc-rot', userCookie, 'mine')

  // Revoke branch
  const key02Rev = await (await reqApi('/api/applications', userCookie, {
    ticketNo: 'KEY-02-acc-rev', ticketType: 'KEY-02', resourceId: rotatedRegId, workspaceId: wsId,
    fields: {operation: '撤销', reason: '验收结束撤销', effectiveAt: new Date(Date.now() - 1000).toISOString()},
  })).json()
  assert.equal((await reqApi('/api/applications/transition', opCookie, {ticketNo: 'KEY-02-acc-rev', revision: key02Rev.revision, action: '批准', note: '同意撤销'})).status, 200)
  const revDone = await waitApp('KEY-02-acc-rev', opCookie)
  assert.equal(revDone.execution?.status, 'succeeded')
  const afterRevKeys = (await products.api('dify', `/console/api/apps/${appFixture.id}/api-keys`)).data.map(k => k.id)
  assert.equal(afterRevKeys.length, 0, 'all keys must be revoked on Dify')
  await confirmResult('KEY-02-acc-rev', userCookie, 'mine')

  // Restart persistence check for KEY-01 & KEY-02
  await restartStack()
  opCookie = await login('zhou.min')
  assert.equal((await waitApp('KEY-02-acc-rev', opCookie)).status, '已完成')
  report.tickets['KEY-02'] = {passed: true, checks: ['reject', 'role_403', 'rotate_dify_readback', 'revoke_dify_readback', 'restart_persistence', 'confirm_done']}
  console.log('[ACCEPT PASS] KEY-02')

  report.ok = true
} catch (err) {
  report.error = {code: err.code ?? 'ACCEPT_FAILED', message: err.message}
  console.error('ACCEPT BATCH1 FAILED:', err)
  process.exitCode = 1
} finally {
  await stack?.close()
  await rm(runDir, {recursive: true, force: true})
  report.cleanupOk = await products.close()
  report.ok = report.ok && report.cleanupOk
  report.finishedAt = new Date().toISOString()
  const out = JSON.stringify(report, null, 2) + '\n'
  writeFileSync(resolve(dataDir, 'accept-batch1-report.json'), out)
}

console.log(`Batch 1 acceptance: ${Object.values(report.tickets).filter(t => t.passed).length}/6 passed; cleanup ${report.cleanupOk ? 'PASS' : 'FAIL'}; overall ${report.ok ? 'PASS' : 'FAIL'}`)
if (!report.ok) process.exitCode = 1
