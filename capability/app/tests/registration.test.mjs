import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {check, json} from '../../../runtime/http.mjs'
import {createRegistry} from '../../platform/registry/public.mjs'
import {startExecutionServer} from '../../platform/execution/public.mjs'
import {startExecutor} from '../service.mjs'

test('模块动作经过公共引擎接单/查询/重启不重复执行，HTTP能力与处理器一致', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'capability-registry-'))
  let calls = 0
  let api
  const action = {
    ticketType: 'AG-01',
    ticketTypeVersion: '1',
    action: 'sync_app',
    variants: [null],
    execute: async ({state}) => {
      calls++
      state.status = 'succeeded'
      state.result = {ok: true, failureCode: '', failureReason: '', retryable: false, resultId: 'app', version: '', sha256: '', details: {}}
    },
  }
  const r = createRegistry(
    [
      {
        id: 'test',
        actions: [action],
        catalogs: {new_kind: {detail: ({res, resourceId}) => res.end(JSON.stringify({resourceId}))}},
        routes: [{method: 'GET', path: '/internal/v1/new-module-route', handle: ({res}) => res.end(JSON.stringify({owner: 'test'}))}],
      },
    ],
    {actions: {'AG-01': ['sync_app']}, evidence: () => []},
  )
  api = await startExecutionServer({dir, token: 'test'}, r)
  t.after(async () => {
    await api.close()
    await rm(dir, {recursive: true, force: true})
  })
  const command = {
    executionId: 'e1',
    ticketNo: 'AG-01-one',
    ticketType: 'AG-01',
    ticketTypeVersion: '1',
    action: 'sync_app',
    resourceId: 'app',
    account: 'user',
    org: 'org',
    payload: {decisionRef: 'decision'},
  }
  const req = (path, data, token = 'test') =>
    fetch(api.url + '/internal/v1' + path, {
      method: data ? 'POST' : 'GET',
      headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'},
      body: data ? JSON.stringify(data) : undefined,
    })
  assert.equal((await req('/capabilities', null, 'wrong')).status, 403)
  assert.equal((await (await req('/catalog/new_kind/resource')).json()).resourceId, 'resource')
  assert.equal((await (await req('/new-module-route')).json()).owner, 'test')
  assert.equal((await (await req('/capabilities')).json()).items[0].state, 'unverified')
  assert.equal((await req('/executions', command)).status, 202)
  assert.equal((await req('/executions', command)).status, 200)
  assert.equal(calls, 1)
  assert.equal((await req('/executions', {...command, resourceId: 'changed'})).status, 409)
  await api.close()
  api = await startExecutionServer({dir, token: 'test'}, r)
  assert.equal((await (await req('/executions/e1')).json()).status, 'succeeded')
  assert.equal(calls, 1)
})

test('模块扩展点：动态路由参数、资源详情/身份上下文、目录版本、自定义校验、取消钩子与独立台账生命周期', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'capability-ext-'))
  let cleanedUp = false
  const mod = {
    id: 'demo',
    init({openLedger}) {
      const db = openLedger('items')
      db.put('reg-1', {secret: 'ONE-TIME'})
      return () => {
        cleanedUp = true
      }
    },
    actions: [
      {
        ticketType: 'AG-01',
        ticketTypeVersion: '1',
        action: 'sync_app',
        variants: [null],
        validatePayload(payload) {
          check(typeof payload.customField === 'string' && payload.customField.length > 0, 400, 'INVALID_CUSTOM_PAYLOAD')
        },
        execute: async ({state}) => {
          state.status = 'reconciling'
        },
        cancel: async ({state}) => {
          state.status = 'cancelled'
          state.result = {ok: false, failureCode: 'CANCELLED', failureReason: '已取消', retryable: false, resultId: '', version: '', sha256: '', details: {}}
        },
      },
    ],
    resources: {
      dify_app: {
        list: ({identity, query}) => ({
          items: [{resourceId: 'app-1', name: '应用一', source: 'dify', workspaceId: query.get('workspaceId') || null, account: identity.account}],
          nextCursor: 'cursor-2',
        }),
        detail: ({resourceId, identity}) => ({resourceId, viewer: identity.account, org: identity.org}),
      },
    },
    catalogs: {
      skill: {
        versions: ({res, resourceId}) => json(res, {resourceId, versions: ['v1.0.0', 'v2.0.0']}),
      },
    },
    routes: [
      {
        method: 'POST',
        path: '/internal/v1/key-registrations/:registrationId/reveal',
        handle: ({res, params, openLedger, identity}) => {
          const db = openLedger('items')
          const rec = db.get(params.registrationId)
          check(rec, 404, 'NOT_FOUND')
          json(res, {secret: rec.secret, account: identity.account})
        },
      },
      {
        method: 'GET',
        path: '/internal/v1/executions/:executionId/account-consistency',
        handle: ({res, params, getExecution}) => {
          const snap = getExecution(params.executionId)
          check(snap, 404, 'NOT_FOUND')
          json(res, {executionId: snap.command.executionId, status: snap.state.status})
        },
      },
    ],
  }
  const r = createRegistry([mod], {actions: {'AG-01': ['sync_app']}, evidence: () => []})
  const api = await startExecutionServer({dir, token: 'test'}, r)
  t.after(async () => {
    await api.close()
    await rm(dir, {recursive: true, force: true})
  })
  const headers = {authorization: 'Bearer test', 'content-type': 'application/json', 'x-account': 'chen.yu', 'x-org': encodeURIComponent('业务一部')}
  const call = (path, method = 'GET', data) =>
    fetch(api.url + '/internal/v1' + path, {method, headers, body: data ? JSON.stringify(data) : undefined})

  // 1. 资源列表透传身份与分页 + 资源详情
  const resList = await (await call('/resources?kind=dify_app&workspaceId=ws-1')).json()
  assert.equal(resList.items[0].account, 'chen.yu')
  assert.equal(resList.nextCursor, 'cursor-2')
  const resDetail = await (await call('/resources/dify_app/app-1')).json()
  assert.deepEqual(resDetail, {resourceId: 'app-1', viewer: 'chen.yu', org: '业务一部'})

  // 2. 目录版本端点 + 合法未实现目录返回 501
  const versions = await (await call('/catalog/skill/skl_doc/versions')).json()
  assert.deepEqual(versions, {resourceId: 'skl_doc', versions: ['v1.0.0', 'v2.0.0']})
  assert.equal((await call('/catalog?kind=knowledge')).status, 501)

  // 3. 动态路由参数 + 模块专属台账
  const revealed = await (await call('/key-registrations/reg-1/reveal', 'POST', {})).json()
  assert.deepEqual(revealed, {secret: 'ONE-TIME', account: 'chen.yu'})

  // 4. 模块自定义 payload 校验 + 取消钩子 + 执行只读子资源路由
  const baseCmd = {executionId: 'exec-ext', ticketNo: 'AG-01-ext', ticketType: 'AG-01', ticketTypeVersion: '1', action: 'sync_app', resourceId: 'app-1', account: 'chen.yu', org: '业务一部'}
  assert.equal((await call('/executions', 'POST', {...baseCmd, payload: {decisionRef: 'wrong'}})).status, 400)
  assert.equal((await call('/executions', 'POST', {...baseCmd, payload: {customField: 'ok'}})).status, 202)
  const proof = await (await call('/executions/exec-ext/account-consistency')).json()
  assert.deepEqual(proof, {executionId: 'exec-ext', status: 'reconciling'})
  const cancelled = await (await call('/executions/exec-ext/cancel', 'POST', {})).json()
  assert.equal(cancelled.status, 'cancelled')
  assert.equal((await call('/executions/exec-ext/cancel', 'POST', {})).status, 409)

  // 5. 关闭时自动触发模块 cleanup
  await api.close()
  assert.equal(cleanedUp, true)
})

test('现有启动入口与模块资源/目录路由保持可用，不完整Dify动作返回明确失败', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'capability-http-'))
  const api = await startExecutor({dir, token: 'test'})
  t.after(async () => {
    await api.close()
    await rm(dir, {recursive: true, force: true})
  })
  const get = path => fetch(api.url + '/internal/v1' + path, {headers: {authorization: 'Bearer test'}})
  assert.equal((await get('/workspaces?product=dify')).status, 501)
  assert.equal((await get('/resources?kind=dify_app&workspaceId=chosen')).status, 501)
  assert.equal((await get('/catalog?kind=agent')).status, 503)
  const c = {
    executionId: 'unsupported',
    ticketNo: 'AG-05-one',
    ticketType: 'AG-05',
    ticketTypeVersion: '1',
    action: 'withdraw_app',
    resourceId: 'app',
    account: 'user',
    org: 'org',
    payload: {decisionRef: 'decision'},
  }
  const post = await fetch(api.url + '/internal/v1/executions', {
    method: 'POST',
    headers: {authorization: 'Bearer test', 'content-type': 'application/json'},
    body: JSON.stringify(c),
  })
  assert.equal(post.status, 202)
  assert.equal((await post.json()).result.failureCode, 'UPSTREAM_UNSUPPORTED')
})
