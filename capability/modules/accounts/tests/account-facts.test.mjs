import test from 'node:test'
import assert from 'node:assert/strict'
import {listen, json, body} from '../../../../runtime/http.mjs'
import {findMatchingAccount, buildBaselineFact, listDifyMembers, listRagflowUsers} from '../adapters/account-products.mjs'
import {extractPreconditionRevision, sealFailedAccountExecution, compensateProducts} from '../adapters/compensation.mjs'
import {productStep} from '../adapters/account-transaction.mjs'
import {getAccountConsistency} from '../queries/account-consistency.mjs'

const person = {accountId: 'native-person', subjectId: 'stable-person', account: 'person', active: true, permission: '个人'}
const difyPerson = {...person, workspaceId: 'ws', role: '成员'}
const baseline = () => buildBaselineFact({ragAccount: person, difyAccount: difyPerson, fallbackAccount: 'person', workspaceId: 'ws'})
const memory = () => {const rows = new Map(); return {get: k => structuredClone(rows.get(k)), put(k, v) {rows.set(k, structuredClone(v))}}}
async function upstream(t, handler) {
  const server = await listen(handler)
  const env = {DIFY_API_BASE: server.url, DIFY_CONSOLE_TOKEN: 'fixture', DIFY_WORKSPACE_ID: 'ws',
    RAGFLOW_API_BASE: server.url, RAGFLOW_API_KEY: 'fixture', DIFY_ACCOUNT_IDENTITY_MAP: '', RAGFLOW_ACCOUNT_IDENTITY_MAP: ''}
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]))
  Object.assign(process.env, env)
  t.after(async () => {await server.close(); for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v
  }})
  return server
}

test('已映射UUID丢失时不接管同名新账号，UUID对应人员漂移时拒绝', () => {
  assert.equal(findMatchingAccount([{...person, accountId: 'replacement'}], {accountId: 'missing', subjectId: person.subjectId, account: person.account}), null)
  assert.throws(() => findMatchingAccount([person], {accountId: person.accountId, subjectId: 'someone-else'}), {code: 'ACCOUNT_IDENTITY_CHANGED'})
})

test('无稳定映射的同名账号与重复稳定人员映射均不能自动选择', () => {
  assert.throws(() => findMatchingAccount([{...person, subjectId: null}], {subjectId: person.subjectId, account: 'PERSON'}), {code: 'UNMAPPED_ACCOUNT_IDENTITY'})
  assert.throws(() => findMatchingAccount([person, {...person, accountId: 'other'}], {subjectId: person.subjectId}), {code: 'AMBIGUOUS_ACCOUNT_IDENTITY'})
})

test('缺失状态/权限、所有者角色及工作区漂移均不能生成恢复基线', () => {
  for (const ragAccount of [{...person, active: null}, {...person, permission: null}, {...person, account: null}]) {
    assert.throws(() => buildBaselineFact({ragAccount, difyAccount: difyPerson, workspaceId: 'ws'}), {code: 'INCOMPLETE_ACCOUNT_FACTS'})
  }
  assert.throws(() => buildBaselineFact({difyAccount: {...difyPerson, productRole: 'owner'}, workspaceId: 'ws'}), {code: 'UPSTREAM_UNSUPPORTED'})
  assert.throws(() => buildBaselineFact({difyAccount: difyPerson, workspaceId: 'elsewhere'}), {code: 'ACCOUNT_WORKSPACE_CHANGED'})
  assert.equal(buildBaselineFact({ragAccount: person, fallbackAccount: 'approved-name', workspaceId: 'ws'}).dify.account, 'approved-name')
})

test('重复、负数或非安全整数的审批修订不被取第一个通过', () => {
  const p = {kind: 'identity_mapping', id: 'p', revision: 1}
  assert.equal(extractPreconditionRevision([p], p.kind, p.id), 1)
  for (const rows of [[p, p], [{...p, revision: -1}], [{...p, revision: 1.5}], [{...p, revision: Number.MAX_SAFE_INTEGER + 1}]]) {
    assert.equal(extractPreconditionRevision(rows, p.kind, p.id), null)
  }
})

test('RAGFlow HTTP200业务失败、缺失清单、重复ID及非JSON不能假报为空列表', async t => {
  let mode = 'error'
  await upstream(t, (_req, res) => {
    if (mode === 'text') {res.end('not JSON'); return}
    return json(res, mode === 'error' ? {code: 101, data: []} : mode === 'missing' ? {code: 0}
      : {code: 0, data: [person, person]})
  })
  for (mode of ['error', 'missing', 'duplicate', 'text']) await assert.rejects(() => listRagflowUsers(),
    error => error.status === 502, mode)
})

test('Dify必须GET核对实际工作区，不能把错误工作区参数盖在成员清单上', async t => {
  let actual = 'other', reads = 0
  await upstream(t, (req, res, path) => {
    if (path.endsWith('/current')) {assert.equal(req.method, 'GET'); return json(res, {id: actual})}
    reads++; return json(res, {accounts: []})
  })
  await assert.rejects(() => listDifyMembers('ws'), {code: 'ACCESS_DENIED'})
  await assert.rejects(() => listDifyMembers('other'), {code: 'ACCESS_DENIED'})
  assert.equal(reads, 0)
  actual = 'ws'; assert.deepEqual(await listDifyMembers('ws'), []); assert.equal(reads, 1)
})

test('原生登录邮箱作为产品登录标识；显示名与映射不能制造产品登录标识', async t => {
  let rows = [{id: 'native-person', name: 'display-name', email: 'login@example.invalid', status: 'active', role: 'normal'}]
  await upstream(t, (_req, res, path) => json(res, path.endsWith('/current') ? {id: 'ws'} : {accounts: rows}))
  process.env.DIFY_ACCOUNT_IDENTITY_MAP = JSON.stringify({'native-person': {subjectId: 'stable-person', account: 'fabricated'}})
  const [withEmail] = await listDifyMembers('ws')
  assert.equal(withEmail.subjectId, 'stable-person'); assert.equal(withEmail.account, 'login@example.invalid')
  assert.equal(withEmail.displayName, 'display-name'); assert.equal(withEmail.loginEmail, 'login@example.invalid')
  assert.equal(buildBaselineFact({difyAccount: withEmail, workspaceId: 'ws'}).dify.account, 'login@example.invalid')

  rows = [{id: 'native-person', name: 'display-name', status: 'active', role: 'normal'}]
  const [noEmail] = await listDifyMembers('ws')
  assert.equal(noEmail.subjectId, 'stable-person'); assert.equal(noEmail.account, null)
  assert.throws(() => buildBaselineFact({difyAccount: noEmail, workspaceId: 'ws'}), {code: 'INCOMPLETE_ACCOUNT_FACTS'})
})

test('可能已写入的超时/5xx不能因当前读回等于基线就自动补偿或封存', async t => {
  let writes = 0
  await upstream(t, (req, res, path) => {
    if (req.method !== 'GET') writes++
    return json(res, path.endsWith('/current') ? {id: 'ws'} : path.endsWith('/members') ? {accounts: [difyPerson]} : {code: 0, data: [person]})
  })
  const db = memory(), record = {executionId: 'ambiguous', baseline: baseline(), sealed: false}
  await assert.rejects(() => productStep(db, record, 'ragflow', 'rename', async () => {throw Object.assign(new Error('lost'), {status: 502})}))
  assert.equal(db.get('ambiguous').steps[0].state, 'unknown')
  const result = await sealFailedAccountExecution({recoveryLedger: db, record, subjectId: person.subjectId,
    baseline: record.baseline, ragMutated: true, difyMutated: true})
  assert.equal(result.sealed, false); assert.equal(result.restored, false); assert.equal(writes, 0)
})

test('产品不可读时一致性查证返回503，不生成虚构的空账户事实', async t => {
  await upstream(t, (_req, res) => json(res, {code: 'offline'}, 503))
  const db = memory(); db.put('e', {baseline: baseline(), subjectId: person.subjectId})
  await assert.rejects(() => getAccountConsistency({params: {executionId: 'e'}, getExecution: () =>
    ({command: {ticketType: 'ACC-02'}, state: {status: 'failed'}}), openLedger: () => db}), {code: 'ACCOUNT_FACTS_UNAVAILABLE'})
})

test('改名补偿只写本次账户名增量，不覆盖并发变化的权限和启停字段', async t => {
  const writes = []
  await upstream(t, async (req, res) => {
    if (req.method === 'GET') return json(res, {id: 'ws'})
    writes.push(await body(req))
    return json(res, {code: 0, data: {...person, permission: 'admin'}})
  })
  const errors = await compensateProducts({baseline: baseline(), ragMutated: true, difyMutated: false,
    steps: [{product: 'ragflow', operation: 'rename', state: 'acknowledged'}]})
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [{account: 'person'}])
})
