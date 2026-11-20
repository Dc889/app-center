import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'
import {listen, json} from '../../../../runtime/http.mjs'

test('observability 模块结构、权限隔离与无伪造零规则', async t => {
  assert.equal(capabilityModule.id, 'observability')
  assert.deepEqual(capabilityModule.actions, [])
  assert.equal(capabilityModule.routes.length, 3)

  const dir = await mkdtemp(join(tmpdir(), 'obs-rbac-'))
  const registry = createRegistry([capabilityModule], {actions: {}, evidence: () => []})
  const server = await startExecutionServer({dir, token: 'tok'}, registry)
  t.after(async () => {
    await server.close()
    await rm(dir, {recursive: true, force: true})
  })

  const toMs = Math.floor(Date.now() / 300000) * 300000
  const from = new Date(toMs - 3600000).toISOString()
  const to = new Date(toMs).toISOString()
  const qs = `view=monitor&scope=user_network&range=1h&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucketMs=300000`

  // 普通用户 403
  const denied = await fetch(`${server.url}/internal/v1/overview-summary?${qs}`, {
    headers: {authorization: 'Bearer tok', 'x-account': 'user-1', 'x-role': 'requester'},
  })
  assert.equal(denied.status, 403)

  const deniedObs = await fetch(`${server.url}/internal/v1/observations?view=monitor`, {
    headers: {authorization: 'Bearer tok', 'x-account': 'user-1', 'x-role': 'requester'},
  })
  assert.equal(deniedObs.status, 403)

  // 未接入调用/异常采集源时严格返回 unavailable（绝不伪造 0）
  const res = await fetch(`${server.url}/internal/v1/overview-summary?${qs}`, {
    headers: {authorization: 'Bearer tok', 'x-account': 'op-1', 'x-role': 'operator'},
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.scope, 'user_network')
  assert.equal(data.calls.state, 'unavailable')
  assert.equal(data.calls.data, null)
  assert.equal(data.exceptions.state, 'unavailable')
  assert.equal(data.exceptions.data, null)
  // 本地 database 可探测，未配置的外部服务全部严格 6 个字段为 null
  assert.equal(data.health.state, 'collected')
  assert.equal(data.health.data.length, 6)
  const dbHealth = data.health.data.find(s => s.key === 'database')
  assert.equal(dbHealth.status, 'healthy')
  const objHealth = data.health.data.find(s => s.key === 'object_store')
  assert.equal(objHealth.status, 'unavailable')
  assert.equal(objHealth.instance, null)
  assert.equal(objHealth.evidenceRef, null)
})

test('observability 全链路：真实库存聚合、服务健康连续失败计数、事件去重分页与时间桶聚合', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'obs-full-'))

  const difyServer = await listen((req, res, path) => {
    if (path === '/health') return json(res, {status: 'ok', version: '1.14.0'})
    if (path === '/console/api/datasets') return json(res, {data: [{id: 'ds-1'}, {id: 'ds-2'}]})
    if (path === '/console/api/workspaces/current/tools/api') {
      return json(res, [{id: 'prov-1', tools: [{id: 't1'}, {id: 't2'}, {id: 't3'}]}])
    }
    if (path === '/console/api/apps/api-keys/summary') return json(res, {activeCount: 4})
    return json(res, {error: 'not found'}, 404)
  })
  const ragServer = await listen((req, res, path) => {
    if (path === '/api/v1/system/health') return json(res, {status: 'error'}, 503)
    if (path === '/api/v1/datasets') return json(res, {data: [{id: 'rag-1'}]})
    return json(res, {error: 'not found'}, 404)
  })
  const daemonServer = await listen((req, res, path) => {
    if (path === '/health/check') return json(res, {status: 'ok', version: '0.2.0'})
    return json(res, {error: 'not found'}, 404)
  })
  const skillRepo = await listen(
    (req, res, path) => {
      if (path === '/internal/v1/skills') return json(res, {items: [{resourceId: 's1', status: '已上架'}, {resourceId: 's2', status: '已下架'}]})
      return json(res, {items: []})
    },
    {token: 'tok'},
  )
  const pluginRepo = await listen(
    (req, res, path) => {
      if (path === '/internal/v1/plugins') return json(res, {items: [{resourceId: 'p1', status: '已上架'}, {resourceId: 'p2', status: '已上架'}]})
      return json(res, {items: []})
    },
    {token: 'tok'},
  )
  const mcpRepo = await listen(
    (req, res, path) => {
      if (path === '/internal/v1/mcps') return json(res, {items: [{resourceId: 'm1', status: '正常'}]})
      return json(res, {items: []})
    },
    {token: 'tok'},
  )
  const agentRepo = await listen(
    (req, res, path) => {
      if (path === '/internal/v1/agents') return json(res, {items: [{resourceId: 'a1', status: '已发布'}, {resourceId: 'a2', status: '已发布'}]})
      return json(res, {items: []})
    },
    {token: 'tok'},
  )

  const prevEnv = {
    DIFY_API_BASE: process.env.DIFY_API_BASE,
    DIFY_CONSOLE_TOKEN: process.env.DIFY_CONSOLE_TOKEN,
    RAGFLOW_API_BASE: process.env.RAGFLOW_API_BASE,
    RAGFLOW_API_KEY: process.env.RAGFLOW_API_KEY,
    DIFY_PLUGIN_DAEMON_URL: process.env.DIFY_PLUGIN_DAEMON_URL,
  }
  process.env.DIFY_API_BASE = difyServer.url
  process.env.DIFY_CONSOLE_TOKEN = 'dify-tok'
  process.env.RAGFLOW_API_BASE = ragServer.url
  process.env.RAGFLOW_API_KEY = 'rag-tok'
  process.env.DIFY_PLUGIN_DAEMON_URL = daemonServer.url

  const registry = createRegistry([capabilityModule], {actions: {}, evidence: () => []})
  const server = await startExecutionServer(
    {
      dir,
      token: 'tok',
      skill: skillRepo.url,
      plugin: pluginRepo.url,
      mcp: mcpRepo.url,
      agent: agentRepo.url,
    },
    registry,
  )

  t.after(async () => {
    await server.close()
    await Promise.all([
      difyServer.close(),
      ragServer.close(),
      daemonServer.close(),
      skillRepo.close(),
      pluginRepo.close(),
      mcpRepo.close(),
      agentRepo.close(),
    ])
    await rm(dir, {recursive: true, force: true})
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  const headers = {
    authorization: 'Bearer tok',
    'content-type': 'application/json',
    'x-account': 'op-1',
    'x-role': 'operator',
  }

  const nowMs = Date.now()
  const toMs = Math.floor(nowMs / 300000) * 300000
  const fromMs = toMs - 3600000
  const bucket2At = new Date(fromMs + 600000 + 1000).toISOString()

  // 1. 注册真实调用/异常采集源
  for (const reg of [
    {group: 'calls', source: 'gateway_telemetry', streams: ['agent', 'retrieval', 'mcp'], capturedAt: new Date(nowMs).toISOString()},
    {group: 'exceptions', source: 'gateway_telemetry', streams: ['agent', 'dataset_build', 'plugin', 'mcp'], capturedAt: new Date(nowMs).toISOString()},
  ]) {
    const r = await fetch(`${server.url}/internal/v1/observations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({collectorRegistration: reg}),
    })
    assert.equal(r.status, 201)
  }

  // 2. 禁止上报 ACC 账号工单事件
  const accReject = await fetch(`${server.url}/internal/v1/observations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: 'gateway',
      eventId: 'ev-acc',
      at: bucket2At,
      kind: 'audit',
      ticketType: 'ACC-01',
    }),
  })
  assert.equal(accReject.status, 400)

  // 3. 上报观测事件（含重复 eventId、重复 executionId 与需脱敏凭证）
  const ingestRes = await (
    await fetch(`${server.url}/internal/v1/observations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        events: [
          {source: 'gw', eventId: 'c1', at: bucket2At, kind: 'call', category: 'agent', executionId: 'ex-1', summary: 'Bearer super-secret-xyz'},
          {source: 'gw', eventId: 'c1', at: bucket2At, kind: 'call', category: 'agent', executionId: 'ex-1', summary: 'duplicate eventId'},
          {source: 'gw', eventId: 'c2', at: bucket2At, kind: 'call', category: 'agent', executionId: 'ex-1', summary: 'duplicate executionId'},
          {source: 'gw', eventId: 'c3', at: bucket2At, kind: 'call', category: 'mcp', summary: 'mcp ok'},
          {source: 'gw', eventId: 'e1', at: bucket2At, kind: 'exception', category: 'plugin', summary: 'api_key=leak-999 failed'},
        ],
      }),
    })
  ).json()
  assert.equal(ingestRes.inserted, 4)
  assert.equal(ingestRes.deduplicated, 1)

  // 4. 连续两次拉取 overview-summary 验证库存、健康连续失败计数（1 -> 2）与时间桶去重聚合
  const qs = `view=monitor&scope=user_network&range=1h&from=${encodeURIComponent(new Date(fromMs).toISOString())}&to=${encodeURIComponent(new Date(toMs).toISOString())}&bucketMs=300000`
  const snap1 = await (await fetch(`${server.url}/internal/v1/overview-summary?${qs}`, {headers})).json()
  assert.equal(snap1.resources.state, 'collected')
  assert.equal(snap1.resources.data.length, 7)
  assert.equal(snap1.resources.data.find(r => r.key === 'agents').count, 2)
  assert.equal(snap1.resources.data.find(r => r.key === 'datasets').count, 3)
  assert.equal(snap1.resources.data.find(r => r.key === 'tools').count, 3)
  assert.equal(snap1.resources.data.find(r => r.key === 'plugins').count, 2)
  assert.equal(snap1.resources.data.find(r => r.key === 'skills').count, 1)
  assert.equal(snap1.resources.data.find(r => r.key === 'mcp').count, 1)
  assert.equal(snap1.resources.data.find(r => r.key === 'keys').count, 4)

  assert.equal(snap1.health.data.find(s => s.key === 'dify').status, 'healthy')
  assert.equal(snap1.health.data.find(s => s.key === 'dify').version, '1.14.0')
  assert.equal(snap1.health.data.find(s => s.key === 'plugin_daemon').status, 'healthy')
  assert.equal(snap1.health.data.find(s => s.key === 'ragflow').status, 'failed')
  assert.equal(snap1.health.data.find(s => s.key === 'ragflow').consecutiveFailures, 1)

  // 完整 12 桶，且重复 executionId 只计 1 次
  assert.equal(snap1.calls.state, 'collected')
  assert.equal(snap1.calls.data.length, 12)
  assert.equal(snap1.calls.data[2].agent, 1)
  assert.equal(snap1.calls.data[2].mcp, 1)
  assert.equal(snap1.calls.data[2].retrieval, 0)
  assert.equal(snap1.exceptions.state, 'collected')
  assert.equal(snap1.exceptions.data[2].plugin, 1)

  const snap2 = await (await fetch(`${server.url}/internal/v1/overview-summary?${qs}`, {headers})).json()
  assert.equal(snap2.health.data.find(s => s.key === 'ragflow').consecutiveFailures, 2)

  // 5. 分页观测事件读取 & 凭证脱敏校验
  const page1 = await (await fetch(`${server.url}/internal/v1/observations?view=monitor&limit=2`, {headers})).json()
  assert.equal(page1.items.length, 2)
  assert.equal(page1.total, 4)
  assert.equal(page1.nextCursor, '2')
  const page2 = await (await fetch(`${server.url}/internal/v1/observations?view=monitor&limit=2&cursor=2`, {headers})).json()
  assert.equal(page2.items.length, 2)
  assert.equal(page2.nextCursor, null)
  const combined = JSON.stringify([...page1.items, ...page2.items])
  assert.ok(!combined.includes('super-secret-xyz'))
  assert.ok(!combined.includes('leak-999'))
})
