import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule, createDifyApiKey, rotateDifyApiKey, revokeDifyApiKey} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'
import {listen, json} from '../../../../runtime/http.mjs'

test('keys 模块导出结构契约、动作与全部动态路由登记', () => {
  assert.equal(capabilityModule.id, 'keys')
  assert.equal(typeof capabilityModule.init, 'function')
  assert.equal(capabilityModule.actions.length, 3)
  for (const [ticketType, action] of [
    ['KEY-01', 'create_key'],
    ['KEY-02', 'rotate_key'],
    ['KEY-02', 'revoke_key'],
  ]) {
    const entry = capabilityModule.actions.find(a => a.action === action)
    assert.ok(entry)
    assert.equal(entry.ticketType, ticketType)
    assert.notEqual(entry.ready, false)
    assert.equal(typeof entry.execute, 'function')
  }
  const routeKeys = capabilityModule.routes.map(r => `${r.method} ${r.path}`)
  for (const expected of [
    'GET /internal/v1/key-registrations',
    'GET /internal/v1/key-registrations/:registrationId',
    'POST /internal/v1/key-registrations/:registrationId/reveal',
    'GET /internal/v1/execution-contexts/KEY-01',
    'GET /internal/v1/execution-contexts/KEY-02',
  ]) {
    assert.ok(routeKeys.includes(expected), `缺少路由 ${expected}`)
  }
})

test('keys 未配置 Dify 环境时执行抛出 501 UPSTREAM_UNSUPPORTED', async () => {
  const prevBase = process.env.DIFY_API_BASE
  const prevToken = process.env.DIFY_CONSOLE_TOKEN
  delete process.env.DIFY_API_BASE
  delete process.env.DIFY_CONSOLE_TOKEN
  try {
    const createAction = capabilityModule.actions.find(a => a.action === 'create_key')
    const state = {status: 'queued'}
    await assert.rejects(
      async () => createAction.execute({command: {resourceId: 'app-1', payload: {decisionRef: 'dec'}}, state}),
      err => err.status === 501 && err.code === 'UPSTREAM_UNSUPPORTED',
    )
  } finally {
    if (prevBase !== undefined) process.env.DIFY_API_BASE = prevBase
    if (prevToken !== undefined) process.env.DIFY_CONSOLE_TOKEN = prevToken
  }
})

test('keys 适配器按真实 Dify Console OpenAPI 协议创建、轮换与撤销密钥', async t => {
  const calls = []
  const difyServer = await listen(async (req, res, path) => {
    calls.push({method: req.method, path})
    if (path === '/console/api/apps/app-test/api-keys' && req.method === 'POST') {
      return json(res, {id: 'key-test-001', token: 'app-secret-token-1234'}, 201)
    }
    if (path.startsWith('/console/api/apps/app-test/api-keys/') && req.method === 'DELETE') {
      res.writeHead(204)
      return res.end()
    }
    return json(res, {error: 'not found'}, 404)
  })

  const prevBase = process.env.DIFY_API_BASE
  const prevToken = process.env.DIFY_CONSOLE_TOKEN
  process.env.DIFY_API_BASE = difyServer.url
  process.env.DIFY_CONSOLE_TOKEN = 'mock-dify-token'
  t.after(async () => {
    await difyServer.close()
    if (prevBase === undefined) delete process.env.DIFY_API_BASE
    else process.env.DIFY_API_BASE = prevBase
    if (prevToken === undefined) delete process.env.DIFY_CONSOLE_TOKEN
    else process.env.DIFY_CONSOLE_TOKEN = prevToken
  })

  const created = await createDifyApiKey({resourceId: 'app-test'})
  assert.equal(created.keyId, 'key-test-001')
  assert.equal(created.lastFour, '1234')
  assert.equal(created.secret, 'app-secret-token-1234')

  const rotated = await rotateDifyApiKey({resourceId: 'app-test', payload: {oldKeyId: 'key-old-999'}})
  assert.equal(rotated.keyId, 'key-test-001')
  assert.equal(rotated.oldKeyStatus, '成功撤销')

  const revoked = await revokeDifyApiKey({resourceId: 'app-test', payload: {keyId: 'key-test-001'}})
  assert.equal(revoked.keyId, 'key-test-001')
  assert.equal(revoked.status, '已撤销')

  assert.ok(calls.some(c => c.method === 'POST' && c.path === '/console/api/apps/app-test/api-keys'))
  assert.ok(calls.some(c => c.method === 'DELETE' && c.path === '/console/api/apps/app-test/api-keys/key-old-999'))
  assert.ok(calls.some(c => c.method === 'DELETE' && c.path === '/console/api/apps/app-test/api-keys/key-test-001'))
})

test('KEY-01/KEY-02 端到端闭环：上下文、获准输入复核、一次性领取、明文不落盘、修订防漂移与重启丢失明文', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'keys-e2e-'))
  let seq = 0
  const difyCalls = []
  const difyServer = await listen(async (req, res, path) => {
    difyCalls.push({method: req.method, path})
    if (path === '/console/api/apps/app-police' && req.method === 'GET') {
      return json(res, {id: 'app-police', name: '警情助手', workspace_id: 'ws-a', owner_account: 'chen.yu', publication_ticket_no: 'AG-02-live'})
    }
    if (path === '/console/api/apps/app-police/api-keys' && req.method === 'POST') {
      seq++
      return json(res, {id: `dify-key-${seq}`, token: `app-TOPSECRET-000${seq}`}, 201)
    }
    if (path.startsWith('/console/api/apps/app-police/api-keys/') && req.method === 'DELETE') {
      res.writeHead(204)
      return res.end()
    }
    return json(res, {error: 'not found'}, 404)
  })

  const approvedInputs = new Map()
  const managementServer = await listen((req, res, path) => {
    const match = /^\/internal\/v1\/approved-inputs\/([\w-]+)$/.exec(path)
    if (match && approvedInputs.has(match[1])) return json(res, approvedInputs.get(match[1]))
    return json(res, {error: {code: 'NOT_FOUND'}}, 404)
  }, {token: 'test-token'})

  const prevBase = process.env.DIFY_API_BASE
  const prevToken = process.env.DIFY_CONSOLE_TOKEN
  process.env.DIFY_API_BASE = difyServer.url
  process.env.DIFY_CONSOLE_TOKEN = 'mock-dify-token'

  const registry = createRegistry([capabilityModule], {
    actions: {'KEY-01': ['create_key'], 'KEY-02': ['rotate_key', 'revoke_key']},
    evidence: () => [],
  })
  let server = await startExecutionServer({dir, token: 'test-token', management: managementServer.url}, registry)

  t.after(async () => {
    await server?.close()
    await managementServer.close()
    await difyServer.close()
    await rm(dir, {recursive: true, force: true})
    if (prevBase === undefined) delete process.env.DIFY_API_BASE
    else process.env.DIFY_API_BASE = prevBase
    if (prevToken === undefined) delete process.env.DIFY_CONSOLE_TOKEN
    else process.env.DIFY_CONSOLE_TOKEN = prevToken
  })

  const call = (path, {method = 'GET', body, account = 'chen.yu', role = 'user', org = '业务一部'} = {}) =>
    fetch(server.url + '/internal/v1' + path, {
      method,
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
        'x-account': account,
        'x-role': role,
        'x-org': encodeURIComponent(org),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  // 1. KEY-01 上下文
  const ctx01 = await (await call('/execution-contexts/KEY-01?action=create_key&resourceId=app-police&workspaceId=ws-a')).json()
  assert.equal(ctx01.ticketType, 'KEY-01')
  assert.equal(ctx01.fields['Dify应用ID'], 'app-police')
  assert.equal(ctx01.fields['所有者账户名'], 'chen.yu')
  assert.equal(ctx01.fields['关联发布工单号'], 'AG-02-live')

  // 2. 执行 KEY-01 创建密钥
  approvedInputs.set('exec-create-1', {
    decisionRef: 'dec-create-1',
    ticketType: 'KEY-01',
    action: 'create_key',
    resourceId: 'app-police',
    fields: {'Dify workspace ID': 'ws-a', 'Dify应用ID': 'app-police', '调用方名称': '警情门户', '调用环境': '生产'},
    preconditions: [],
  })
  const createdResp = await call('/executions', {
    method: 'POST',
    body: {
      executionId: 'exec-create-1',
      ticketNo: 'KEY-01-1',
      ticketType: 'KEY-01',
      ticketTypeVersion: '1',
      action: 'create_key',
      resourceId: 'app-police',
      account: 'chen.yu',
      org: '业务一部',
      payload: {decisionRef: 'dec-create-1'},
    },
  })
  assert.equal(createdResp.status, 202)
  const createdState = await createdResp.json()
  assert.equal(createdState.status, 'succeeded')
  const regId1 = createdState.result.details.registrationId
  assert.ok(regId1)
  assert.equal(createdState.result.details['密钥后四位'], '0001')
  assert.ok(createdState.result.details.revealExpiresAt)
  assert.ok(!JSON.stringify(createdState).includes('TOPSECRET-0001'))

  // 3. 确认两个 SQLite 文件均未持久化明文 secret
  assert.ok(!(await readFile(join(dir, 'executions.sqlite'))).includes(Buffer.from('TOPSECRET-0001')))
  assert.ok(!(await readFile(join(dir, 'mod_keys_registrations.sqlite'))).includes(Buffer.from('TOPSECRET-0001')))

  // 4. 登记列表与详情（隔离他人、列表无 keyId、详情有 keyId、均无明文）
  const otherList = await (await call('/key-registrations?action=rotate_key', {account: 'other.user'})).json()
  assert.equal(otherList.items.length, 0)
  const ownerList = await (await call('/key-registrations?action=rotate_key')).json()
  assert.equal(ownerList.items.length, 1)
  assert.equal(ownerList.items[0].registrationId, regId1)
  assert.equal(ownerList.items[0].keyId, undefined)
  assert.equal(ownerList.nextCursor, null)

  const detail = await (await call(`/key-registrations/${regId1}?action=rotate_key`)).json()
  assert.equal(detail.keyId, 'dify-key-1')
  assert.equal(detail.revision, 1)
  assert.equal(detail.lastFour, '0001')

  // 5. 一次性领取：非申请人 404，申请人首次 200 (no-store)，二次 409 REVEAL_UNAVAILABLE
  assert.equal((await call(`/key-registrations/${regId1}/reveal`, {method: 'POST', body: {}, account: 'zhou.min', role: 'operator'})).status, 404)
  const reveal1 = await call(`/key-registrations/${regId1}/reveal`, {method: 'POST', body: {}})
  assert.equal(reveal1.status, 200)
  assert.equal(reveal1.headers.get('cache-control'), 'no-store')
  assert.equal((await reveal1.json()).secret, 'app-TOPSECRET-0001')
  const reveal2 = await call(`/key-registrations/${regId1}/reveal`, {method: 'POST', body: {}})
  assert.equal(reveal2.status, 409)
  assert.equal((await reveal2.json()).error.code, 'REVEAL_UNAVAILABLE')

  // 6. KEY-02 上下文 + 修订漂移保护
  const ctx02 = await (await call(`/execution-contexts/KEY-02?action=rotate_key&resourceId=${regId1}`)).json()
  assert.equal(ctx02.fields['Dify密钥ID'], 'dify-key-1')
  assert.equal(ctx02.fields['密钥后四位'], '0001')
  assert.deepEqual(ctx02.preconditions, [{kind: 'key_registration', id: regId1, revision: 1}])

  approvedInputs.set('exec-rotate-stale', {
    decisionRef: 'dec-stale',
    ticketType: 'KEY-02',
    action: 'rotate_key',
    resourceId: regId1,
    fields: {},
    preconditions: [{kind: 'key_registration', id: regId1, revision: 99}],
  })
  const callsBeforeStale = difyCalls.length
  const staleState = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-rotate-stale',
        ticketNo: 'KEY-02-stale',
        ticketType: 'KEY-02',
        ticketTypeVersion: '1',
        action: 'rotate_key',
        resourceId: regId1,
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-stale'},
      },
    })
  ).json()
  assert.equal(staleState.status, 'failed')
  assert.equal(staleState.result.failureCode, 'STALE_SNAPSHOT')
  assert.equal(difyCalls.length, callsBeforeStale)

  // 7. 正常 KEY-02 轮换（建新钥 + 删旧钥 + 旧登记标 rotated + 新登记可领）
  approvedInputs.set('exec-rotate-ok', {
    decisionRef: 'dec-rotate-ok',
    ticketType: 'KEY-02',
    action: 'rotate_key',
    resourceId: regId1,
    fields: {},
    preconditions: [{kind: 'key_registration', id: regId1, revision: 1}],
  })
  const rotatedState = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-rotate-ok',
        ticketNo: 'KEY-02-rot',
        ticketType: 'KEY-02',
        ticketTypeVersion: '1',
        action: 'rotate_key',
        resourceId: regId1,
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-rotate-ok'},
      },
    })
  ).json()
  assert.equal(rotatedState.status, 'succeeded')
  const regId2 = rotatedState.result.details.registrationId
  assert.notEqual(regId2, regId1)
  assert.equal(rotatedState.result.details['新密钥后四位'], '0002')
  assert.equal(rotatedState.result.details['旧密钥撤销结果'], '成功撤销')
  assert.ok(!JSON.stringify(rotatedState).includes('TOPSECRET-0002'))
  assert.ok(difyCalls.some(c => c.method === 'DELETE' && c.path === '/console/api/apps/app-police/api-keys/dify-key-1'))

  // 旧登记变为 rotated，不再作为候选
  assert.equal((await call(`/key-registrations/${regId1}?action=revoke_key`)).status, 403)

  // 8. 重启服务后，未领取的新密钥明文安全丢失，reveal 返回 409 REVEAL_UNAVAILABLE，但元数据持久保留
  await server.close()
  server = await startExecutionServer({dir, token: 'test-token', management: managementServer.url}, registry)
  const afterRestartReveal = await call(`/key-registrations/${regId2}/reveal`, {method: 'POST', body: {}})
  assert.equal(afterRestartReveal.status, 409)
  assert.equal((await afterRestartReveal.json()).error.code, 'REVEAL_UNAVAILABLE')

  // 9. KEY-02 撤销新密钥
  approvedInputs.set('exec-revoke-ok', {
    decisionRef: 'dec-revoke-ok',
    ticketType: 'KEY-02',
    action: 'revoke_key',
    resourceId: regId2,
    fields: {},
    preconditions: [{kind: 'key_registration', id: regId2, revision: 1}],
  })
  const revokedState = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-revoke-ok',
        ticketNo: 'KEY-02-rev',
        ticketType: 'KEY-02',
        ticketTypeVersion: '1',
        action: 'revoke_key',
        resourceId: regId2,
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-revoke-ok'},
      },
    })
  ).json()
  assert.equal(revokedState.status, 'succeeded')
  assert.equal(revokedState.result.details.status, '已撤销')
  assert.ok(difyCalls.some(c => c.method === 'DELETE' && c.path === '/console/api/apps/app-police/api-keys/dify-key-2'))
  const finalList = await (await call('/key-registrations?action=revoke_key')).json()
  assert.equal(finalList.items.length, 0)
})
