import {liveProducts} from '../../dev/live-verification/products.mjs'
import {listen, json, body} from '../../runtime/http.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createProofJournal} from '../../dev/live-verification/proofs.mjs'
import {capabilityModules} from '../../capability/app/modules.mjs'
import {createRegistry} from '../../capability/platform/registry/public.mjs'

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'live-evidence-'))
  t.after(() => rm(dir, {recursive: true, force: true}))
  return {dir, journal: createProofJournal({dir, modules: capabilityModules, workspaceId: 'real-ws'})}
}
const meta = {ticketType: 'KEY-01', ticketTypeVersion: '1', action: 'create_key', variant: null, workspaceId: 'real-ws'}
const witnesses = [{source: 'Dify key list readback', resourceId: 'actual-app-id', assertion: 'created key present', passed: true}]

test('部署日志初始化覆盖35分支，未执行的动作不可继承旧通过状态', async t => {
  const {dir, journal} = await setup(t)
  assert.equal(journal.evidence().length, 35)
  assert.ok(journal.evidence().every(row => row.state === 'unverified' && row.reasonCode === 'NOT_RUN'))
  const persisted = JSON.parse(await readFile(join(dir, 'capability-evidence.json'), 'utf8'))
  assert.deepEqual(persisted, journal.evidence())
})

test('仅执行成功不能生成verified，缺少或失败的状态读回必须保持未核验', async t => {
  const {journal} = await setup(t)
  for (const invalid of [[], [{...witnesses[0], passed: false}], [{passed: true}]]) {
    journal.record(meta, {ok: true, witnesses: invalid})
    const row = journal.evidence().find(row => row.action === 'create_key')
    assert.equal(row.state, 'unverified')
    assert.equal(row.reasonCode, 'MISSING_STATE_READBACK')
  }
})

test('指定工作区证据不可自动扩展至全局或其他工作区，错误范围禁止写入', async t => {
  const {journal} = await setup(t)
  assert.throws(() => journal.record({...meta, workspaceId: null}, {ok: true, witnesses}), error => error.code === 'WRONG_PROOF_WORKSPACE')
  journal.record(meta, {ok: true, witnesses})
  const registry = createRegistry(capabilityModules, {evidence: journal.evidence})
  for (const [workspaceId, expected] of [['real-ws', 'verified'], ['other-ws', 'unverified'], [null, 'unverified']]) {
    assert.equal(registry.capabilities(workspaceId).items.find(row => row.action === 'create_key').state, expected)
  }
  assert.equal(journal.evidence().filter(row => row.action === 'create_key').length, 1)
})

test('每步保存报告及证据，复跑失败覆盖原通过而不产生重复分支', async t => {
  const {dir, journal} = await setup(t)
  journal.record(meta, {ok: true, witnesses})
  journal.record(meta, {reasonCode: 'UPSTREAM_ERROR', detail: 'live readback failed'})
  const report = JSON.parse(await readFile(join(dir, 'live-verification-report.json'), 'utf8'))
  assert.equal(report.report.length, 2)
  assert.equal(report.verified, 0)
  assert.equal(journal.evidence().find(row => row.action === 'create_key').reasonCode, 'UPSTREAM_ERROR')
  assert.equal(journal.evidence().length, 35)
  assert.ok((await readFile(join(dir, `live-verification-${journal.runId}.json`), 'utf8')).includes('UPSTREAM_ERROR'))
})

test('EVT人工办理不进入执行证据，未知动作拒绝；清理失败撤回本轮资格', async t => {
  const {journal} = await setup(t)
  journal.record({ticketType: 'EVT-01', action: 'manual_lifecycle'}, {ok: true})
  assert.ok(!journal.evidence().some(row => row.ticketType === 'EVT-01'))
  assert.throws(() => journal.record({...meta, action: 'unknown'}), error => error.code === 'UNKNOWN_PROOF_BRANCH')
  journal.record(meta, {ok: true, witnesses})
  journal.invalidate('CLEANUP_FAILED')
  assert.ok(journal.evidence().every(row => row.state === 'unverified' && row.reasonCode === 'CLEANUP_FAILED'))
})


test('真机核验凭证过期只刷新一次，不将401当成产品成功，明文不写入资源日志', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'live-auth-'))
  const before = process.env.DIFY_CONSOLE_TOKEN
  let attempts = 0, logins = 0
  const server = await listen(async (req, res, path) => {
    if (path === '/console/api/login') {
      logins++
      assert.deepEqual(await body(req), {email: 'local@test.invalid', password: 'test-password-123', remember_me: true})
      return json(res, {result: 'success', data: {access_token: 'fresh-test-token'}})
    }
    attempts++
    if (req.headers.authorization !== 'Bearer fresh-test-token') return json(res, {code: 'unauthorized'}, 401)
    return json(res, {id: 'new-owned-resource'})
  })
  t.after(async () => {
    await server.close(); await rm(dir, {recursive: true, force: true})
    if (before === undefined) delete process.env.DIFY_CONSOLE_TOKEN
    else process.env.DIFY_CONSOLE_TOKEN = before
  })
  const products = liveProducts({dir, credentials: {dify: {base: server.url, email: 'local@test.invalid', password: 'test-password-123', token: 'expired'}}})
  assert.equal((await products.api('dify', '/write', {method: 'POST', body: {safe: true}})).id, 'new-owned-resource')
  assert.equal(attempts, 2); assert.equal(logins, 1)
  const journal = await readFile(join(dir, `live-resources-${products.runId}.json`), 'utf8')
  assert.ok(!journal.includes('fresh-test-token') && !journal.includes('test-password-123'))
})
