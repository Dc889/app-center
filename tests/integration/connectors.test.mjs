import test from 'node:test'
import assert from 'node:assert/strict'
import {listen, json, body} from '../../runtime/http.mjs'
import {startDifyConnector} from '../../connectors/dify/public.mjs'
import {startRagflowConnector} from '../../connectors/ragflow/public.mjs'
import {
  difyConsoleFetch,
  difyPluginDaemonFetch,
  getDifyConfig,
  hydrateDifyConnector,
  setDifyConnectorMeta,
} from '../../capability/platform/dify/public.mjs'
import {
  getRagflowConfig,
  hydrateRagflowConnector,
  ragflowFetch,
  setRagflowConnectorMeta,
} from '../../capability/platform/ragflow/public.mjs'

test('独立 connector-dify 与 connector-ragflow 隔离外部凭证，支持 401 令牌续签、Plugin Daemon 与 RAGFlow 转发', async t => {
  let difyLoginCount = 0
  let difyAppCalls = 0
  let daemonCalls = 0
  let ragCalls = 0

  const fakeDify = await listen(async (req, res, path) => {
    if (req.method === 'POST' && path === '/console/api/login') {
      difyLoginCount += 1
      const payload = await body(req)
      assert.equal(payload.email, 'admin@test.local')
      return json(res, {result: 'success', data: {access_token: 'fresh-dify-token'}})
    }
    if (req.method === 'GET' && path === '/console/api/setup') {
      return json(res, {step: 'finished', version: '1.7.1'})
    }
    if (req.method === 'GET' && path === '/console/api/apps') {
      difyAppCalls += 1
      if (req.headers.authorization === 'Bearer expired-dify-token') {
        return json(res, {code: 'unauthorized'}, 401)
      }
      assert.equal(req.headers.authorization, 'Bearer fresh-dify-token')
      return json(res, {data: [{id: 'app-1', name: 'Connector App'}]})
    }
    if (req.method === 'GET' && path === '/health/check') {
      assert.equal(req.headers['x-api-key'], 'daemon-secret')
      return json(res, {status: 'ok', version: '0.2.0'})
    }
    if (req.method === 'POST' && path === '/plugin/ws-conn/management/install/upgrade') {
      daemonCalls += 1
      assert.equal(req.headers['x-api-key'], 'daemon-secret')
      return json(res, {code: 0, data: {task_id: 'upg-1'}})
    }
    return json(res, {error: 'not found'}, 404)
  })

  const fakeRagflow = await listen(async (req, res, path) => {
    if (req.method === 'GET' && path === '/v1/system/healthz') {
      return json(res, {status: 'ok', version: '0.22.1'})
    }
    if (req.method === 'GET' && path === '/api/v1/datasets') {
      ragCalls += 1
      assert.equal(req.headers.authorization, 'Bearer ragflow-secret')
      return json(res, {code: 0, data: [{id: 'rag-ds-1', name: 'Connector KB'}]})
    }
    return json(res, {error: 'not found'}, 404)
  })

  const envBackup = {}
  const keys = [
    'DIFY_API_BASE', 'DIFY_CONSOLE_TOKEN', 'DIFY_CONSOLE_EMAIL', 'DIFY_CONSOLE_PASSWORD',
    'DIFY_WORKSPACE_ID', 'DIFY_PLUGIN_DAEMON_BASE', 'DIFY_PLUGIN_DAEMON_KEY',
    'RAGFLOW_API_BASE', 'RAGFLOW_API_KEY', 'RAGFLOW_TENANT_ID',
    'DIFY_CONNECTOR_URL', 'RAGFLOW_CONNECTOR_URL', 'INTERNAL_TOKEN',
  ]
  for (const k of keys) envBackup[k] = process.env[k]

  const internalToken = 'internal-connector-test-token'
  process.env.DIFY_API_BASE = fakeDify.url
  process.env.DIFY_CONSOLE_TOKEN = 'expired-dify-token'
  process.env.DIFY_CONSOLE_EMAIL = 'admin@test.local'
  process.env.DIFY_CONSOLE_PASSWORD = 'password123'
  process.env.DIFY_WORKSPACE_ID = 'ws-conn'
  process.env.DIFY_PLUGIN_DAEMON_BASE = fakeDify.url
  process.env.DIFY_PLUGIN_DAEMON_KEY = 'daemon-secret'
  process.env.RAGFLOW_API_BASE = fakeRagflow.url
  process.env.RAGFLOW_API_KEY = 'ragflow-secret'
  process.env.RAGFLOW_TENANT_ID = 'tenant-conn'

  const difyConn = await startDifyConnector({token: internalToken})
  const ragConn = await startRagflowConnector({token: internalToken})

  t.after(async () => {
    setDifyConnectorMeta(null)
    setRagflowConnectorMeta(null)
    await difyConn.close()
    await ragConn.close()
    await fakeDify.close()
    await fakeRagflow.close()
    for (const k of keys) {
      if (envBackup[k] === undefined) delete process.env[k]
      else process.env[k] = envBackup[k]
    }
  })

  // 验证 /healthz 免令牌可探活，而 /connector/v1/meta 必须携带 INTERNAL_TOKEN
  const hz1 = await fetch(difyConn.url + '/healthz')
  assert.equal(hz1.status, 200)
  const denied = await fetch(difyConn.url + '/connector/v1/meta')
  assert.equal(denied.status, 403)

  // 切换到 connector 模式（模拟 executor 容器：不持有外部 token，仅持有 CONNECTOR_URL + INTERNAL_TOKEN）
  process.env.DIFY_CONNECTOR_URL = difyConn.url
  process.env.RAGFLOW_CONNECTOR_URL = ragConn.url
  process.env.INTERNAL_TOKEN = internalToken

  const difyMeta = await hydrateDifyConnector(internalToken)
  const ragMeta = await hydrateRagflowConnector(internalToken)
  assert.equal(difyMeta.workspaceId, 'ws-conn')
  assert.equal(difyMeta.pluginDaemonConfigured, true)
  assert.equal(ragMeta.tenantId, 'tenant-conn')

  assert.equal(getDifyConfig().mode, 'connector')
  assert.equal(getRagflowConfig().mode, 'connector')

  // 验证 Dify 401 自动在 connector-dify 内完成续签并重试成功
  const appsRes = await difyConsoleFetch('/console/api/apps?page=1')
  assert.equal(appsRes.status, 200)
  const appsJson = await appsRes.json()
  assert.equal(appsJson.data[0].id, 'app-1')
  assert.equal(difyLoginCount, 1)
  assert.equal(difyAppCalls, 2)

  // 验证 Plugin Daemon 通过 connector-dify 转发
  const daemonRes = await difyPluginDaemonFetch('/plugin/ws-conn/management/install/upgrade', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({source: 'package'}),
  })
  assert.equal(daemonRes.status, 200)
  assert.equal((await daemonRes.json()).data.task_id, 'upg-1')
  assert.equal(daemonCalls, 1)

  // 验证 RAGFlow 通过 connector-ragflow 转发
  const ragRes = await ragflowFetch('/api/v1/datasets?page_size=10')
  assert.equal(ragRes.status, 200)
  assert.equal((await ragRes.json()).data[0].id, 'rag-ds-1')
  assert.equal(ragCalls, 1)
})
