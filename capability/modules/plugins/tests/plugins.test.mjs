import test from 'node:test'
import assert from 'node:assert/strict'
import {capabilityModule} from '../public.mjs'
import {listen, json} from '../../../../runtime/http.mjs'

test('plugins 模块导出结构契约与动作登记', () => {
  assert.equal(capabilityModule.id, 'plugins')
  assert.equal(Array.isArray(capabilityModule.actions), true)
  assert.equal(capabilityModule.actions.length, 7)
  const installAction = capabilityModule.actions.find(a => a.action === 'install')
  assert.ok(installAction)
  assert.equal(installAction.ticketType, 'PLG-03')
  assert.equal(typeof installAction.execute, 'function')
})

test('plugins install 未配置 Dify 凭证时抛出 501 UPSTREAM_UNSUPPORTED', async () => {
  const installAction = capabilityModule.actions.find(a => a.action === 'install')
  const command = {
    executionId: 'exec-plg-unconfigured',
    resourceId: 'document-parser',
    account: 'chen.yu',
    payload: {version: 'v2.4.1', sha256: 'abc', workspaceId: 'ws-default'},
  }
  const row = {command, state: {status: 'queued'}}
  await assert.rejects(
    async () => installAction.execute({command, state: row.state, row, plugin: async () => {}, store: {put() {}}}),
    err => err.status === 501 && err.code === 'UPSTREAM_UNSUPPORTED',
  )
})

test('plugins install 与 reconcile 配合 Dify 对端完成安装闭环', async t => {
  const difyServer = await listen((req, res, path) => {
    if (path === '/console/api/workspaces/current') {
      return json(res, {id: 'ws-test'})
    }
    if (path === '/console/api/workspaces/current/plugin/upload/pkg') {
      return json(res, {unique_identifier: 'document-parser:v2.4.1'})
    }
    if (path === '/console/api/workspaces/current/plugin/install/pkg') {
      return json(res, {task_id: 'task-101'})
    }
    if (path === '/console/api/workspaces/current/plugin/list') {
      return json(res, {
        total: 1,
        plugins: [{tenant_id: 'ws-test', plugin_unique_identifier: 'document-parser:v2.4.1'}],
      })
    }
    return json(res, {error: 'not found'}, 404)
  })

  const prevEnv = {...process.env}
  process.env.DIFY_API_BASE = difyServer.url
  process.env.DIFY_CONSOLE_TOKEN = 'test-token'
  process.env.DIFY_WORKSPACE_ID = 'ws-test'
  process.env.DIFY_INSTALL_ACCOUNT = 'chen.yu'

  t.after(async () => {
    await difyServer.close()
    for (const k of ['DIFY_API_BASE', 'DIFY_CONSOLE_TOKEN', 'DIFY_WORKSPACE_ID', 'DIFY_INSTALL_ACCOUNT']) {
      if (prevEnv[k] === undefined) delete process.env[k]
      else process.env[k] = prevEnv[k]
    }
  })

  const installAction = capabilityModule.actions.find(a => a.action === 'install')
  const saved = new Map()
  const mockStore = {
    put(key, val) { saved.set(key, val) },
  }
  const pkgBytes = Buffer.from('test-package-bytes')
  const {digest} = await import('../../../../runtime/http.mjs')
  const pkgSha256 = digest(pkgBytes)

  const mockPlugin = async () => ({
    arrayBuffer: async () => pkgBytes,
  })

  const command = {
    executionId: 'exec-plg-01',
    resourceId: 'document-parser',
    account: 'chen.yu',
    org: '业务一部',
    payload: {
      version: 'v2.4.1',
      sha256: pkgSha256,
      workspaceId: 'ws-test',
    },
  }
  const row = {command, state: {status: 'queued'}}

  await installAction.execute({
    command,
    state: row.state,
    row,
    plugin: mockPlugin,
    store: mockStore,
  })

  assert.equal(row.state.status, 'reconciling')
  assert.ok(row.productTask)
  assert.equal(row.productTask.pluginUniqueIdentifier, 'document-parser:v2.4.1')

  await capabilityModule.reconcile({
    row,
    store: mockStore,
    stamp: () => '2026-11-20T00:00:00Z',
  })

  assert.equal(row.state.status, 'succeeded')
  assert.equal(row.state.result.ok, true)
  assert.equal(row.state.result.resultId, 'document-parser:v2.4.1')
})

test('plugins 资源候选与目录读取', async () => {
  const resItems = await capabilityModule.resources.plugin('ws-default')
  assert.ok(Array.isArray(resItems))
  assert.ok(resItems.some(i => i.resourceId === 'document-parser'))

  let listResult = null
  const mockReq = {url: 'http://localhost/catalog?kind=plugin&workspaceId=ws-default', headers: {}}
  const mockRes = {
    writeHead() {},
    end(str) { listResult = JSON.parse(str) },
  }

  await capabilityModule.catalogs.plugin.list({
    req: mockReq,
    res: mockRes,
    query: new URLSearchParams('kind=plugin&workspaceId=ws-default'),
  })

  assert.ok(listResult)
  assert.ok(Array.isArray(listResult.items))
  assert.ok(listResult.items.some(i => i.resourceId === 'document-parser'))

  let detailResult = null
  const detailRes = {
    writeHead() {},
    end(str) { detailResult = JSON.parse(str) },
  }
  const mockPlugin = async () => ({
    json: async () => ({resourceId: 'document-parser', version: 'v2.4.1', sha256: 'abc', sizeBytes: 112}),
  })
  await capabilityModule.catalogs.plugin.detail({
    req: mockReq,
    res: detailRes,
    resourceId: 'document-parser',
    plugin: mockPlugin,
  })
  assert.ok(detailResult)
  assert.equal(detailResult.resourceId, 'document-parser')
})
