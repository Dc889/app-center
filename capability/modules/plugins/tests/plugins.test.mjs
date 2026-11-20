import {testPluginArchive} from '../../../../tests/fixtures/plugin-archive.mjs'
import {seedRepositoryFixtures} from '../../../../tests/fixtures/repository-data.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'
import {startPlugin} from '../../../repositories/plugin/public.mjs'
import {listen, json, body} from '../../../../runtime/http.mjs'

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
  const nativeUid = 'document-parser:2.4.1@' + 'a'.repeat(64)
  const difyServer = await listen((req, res, path) => {
    if (path === '/console/api/workspaces/current') {
      return json(res, {id: 'ws-test'})
    }
    if (path === '/console/api/workspaces/current/plugin/upload/pkg') {
      return json(res, {unique_identifier: nativeUid})
    }
    if (path === '/console/api/workspaces/current/plugin/install/pkg') {
      return json(res, {task_id: 'task-101'})
    }
    if (path === '/console/api/workspaces/current/plugin/list') {
      return json(res, {
        total: 1,
        plugins: [{id: 'native-document-parser', tenant_id: 'ws-test', plugin_unique_identifier: nativeUid}],
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
    for (const k of ['DIFY_API_BASE', 'DIFY_CONSOLE_TOKEN', 'DIFY_WORKSPACE_ID', 'DIFY_INSTALL_ACCOUNT', 'DIFY_PLUGIN_DAEMON_BASE', 'DIFY_PLUGIN_DAEMON_KEY']) {
      if (prevEnv[k] === undefined) delete process.env[k]
      else process.env[k] = prevEnv[k]
    }
  })

  const installAction = capabilityModule.actions.find(a => a.action === 'install')
  const saved = new Map()
  const mockStore = {
    put(key, val) { saved.set(key, val) },
  }
  const pkgBytes = testPluginArchive({uniqueIdentifier: 'document-parser', version: '2.4.1'})
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
      version: '2.4.1',
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
  assert.equal(row.productTask.pluginUniqueIdentifier, nativeUid)

  await capabilityModule.reconcile({
    row,
    store: mockStore,
    stamp: () => '2026-11-20T00:00:00Z',
  })

  assert.equal(row.state.status, 'succeeded')
  assert.equal(row.state.result.ok, true)
  assert.equal(row.state.result.resultId, nativeUid)
})

test('plugins 资源候选与目录读取', async () => {
  const mockPluginClient = async () => ({
    json: async () => ({
      items: [{resourceId: 'document-parser', name: '文档解析插件', version: 'v2.4.1', status: 'approved'}],
    }),
  })
  const resPage = await capabilityModule.resources.plugin.list({
    clients: {plugin: mockPluginClient},
    query: new URLSearchParams('workspaceId=ws-default'),
  })
  assert.ok(Array.isArray(resPage.items))
  assert.ok(resPage.items.some(i => i.resourceId === 'document-parser'))

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
    plugin: mockPluginClient,
  })

  assert.ok(listResult)
  assert.ok(Array.isArray(listResult.items))
  assert.ok(listResult.items.some(i => i.resourceId === 'document-parser'))
  assert.equal(listResult.items[0].data.installed, null)
  assert.equal(listResult.items[0].data.installationId, '')

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

test('PLG-01~04 全生命周期：上传解析、上架、安装对账、变更再审、升级对账、禁用恢复与卸载', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'plugins-lifecycle-'))
  seedRepositoryFixtures(dir)
  const pluginRepo = await startPlugin({dir, token: 'tok'})
  const installedIds = new Set()
  const difyCalls = []
  const difyServer = await listen(async (req, res, path) => {
    difyCalls.push({method: req.method, path})
    if (path === '/console/api/workspaces/current') return json(res, {id: 'ws-p'})
    if (path === '/console/api/workspaces/current/plugin/upload/pkg') {
      const id = installedIds.size === 0 ? 'chart-gen:1.0.0@' + 'a'.repeat(64) : 'chart-gen:2.0.0@' + 'b'.repeat(64)
      return json(res, {unique_identifier: id})
    }
    if (path === '/console/api/workspaces/current/plugin/install/pkg') {
      const id = installedIds.size === 0 ? 'chart-gen:1.0.0@' + 'a'.repeat(64) : 'chart-gen:2.0.0@' + 'b'.repeat(64)
      installedIds.add(id)
      return json(res, {task_id: 'task-' + installedIds.size})
    }
    if (path === '/console/api/workspaces/current/plugin/list') {
      return json(res, {
        total: installedIds.size,
        plugins: [...installedIds].map(id => ({id: id.includes(':2.0.0@') ? 'native-chart-2' : 'native-chart-1', tenant_id: 'ws-p', plugin_unique_identifier: id})),
      })
    }
    if (path === '/console/api/workspaces/current/plugin/disable' || path === '/console/api/workspaces/current/plugin/enable') {
      return json(res, {success: true})
    }
    if (path === '/plugin/ws-p/management/install/upgrade') {
      assert.equal(req.headers['x-api-key'], 'daemon-test-key')
      const payload = await body(req)
      assert.equal(payload.source, 'package')
      assert.ok(installedIds.has(payload.original_plugin_unique_identifier))
      installedIds.delete(payload.original_plugin_unique_identifier)
      installedIds.add(payload.new_plugin_unique_identifier)
      return json(res, {code: 0, data: {task_id: 'native-upgrade-2'}})
    }
    if (path === '/console/api/workspaces/current/plugin/uninstall') {
      const payload = await body(req)
      assert.equal(payload.plugin_installation_id, 'native-chart-2')
      installedIds.clear()
      return json(res, {success: true})
    }
    return json(res, {error: 'not found'}, 404)
  })

  const approvedInputs = new Map()
  const mgmt = await listen(
    (req, res, path) => {
      const m = /^\/internal\/v1\/approved-inputs\/([\w-]+)$/.exec(path)
      if (m && approvedInputs.has(m[1])) return json(res, approvedInputs.get(m[1]))
      return json(res, {error: {code: 'NOT_FOUND'}}, 404)
    },
    {token: 'tok'},
  )

  const prevEnv = {...process.env}
  process.env.DIFY_API_BASE = difyServer.url
  process.env.DIFY_CONSOLE_TOKEN = 'dify-tok'
  process.env.DIFY_WORKSPACE_ID = 'ws-p'
  process.env.DIFY_INSTALL_ACCOUNT = 'chen.yu'
  process.env.DIFY_PLUGIN_DAEMON_BASE = difyServer.url
  process.env.DIFY_PLUGIN_DAEMON_KEY = 'daemon-test-key'

  const registry = createRegistry([capabilityModule], {
    actions: {
      'PLG-01': ['publish_package'],
      'PLG-02': ['revise_package'],
      'PLG-03': ['install', 'upgrade', 'uninstall'],
      'PLG-04': ['disable_plugin', 'restore_plugin'],
    },
    evidence: () => [],
  })
  const server = await startExecutionServer({dir, token: 'tok', plugin: pluginRepo.url, management: mgmt.url}, registry)
  t.after(async () => {
    await server.close()
    await pluginRepo.close()
    await difyServer.close()
    await mgmt.close()
    await rm(dir, {recursive: true, force: true})
    for (const k of ['DIFY_API_BASE', 'DIFY_CONSOLE_TOKEN', 'DIFY_WORKSPACE_ID', 'DIFY_INSTALL_ACCOUNT', 'DIFY_PLUGIN_DAEMON_BASE', 'DIFY_PLUGIN_DAEMON_KEY']) {
      if (prevEnv[k] === undefined) delete process.env[k]
      else process.env[k] = prevEnv[k]
    }
  })

  const multipart = (filename, content) => {
    const boundary = '----PlgBoundary'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/json\r\n\r\n`),
      Buffer.from(content),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    return {contentType: `multipart/form-data; boundary=${boundary}`, body}
  }
  const hdr = (extra = {}) => ({
    authorization: 'Bearer tok',
    'x-account': 'chen.yu',
    'x-role': 'operator',
    'x-org': encodeURIComponent('平台运营组'),
    ...extra,
  })
  const exec = async cmd => {
    let value = await (await fetch(server.url + '/internal/v1/executions', {
      method: 'POST', headers: hdr({'content-type': 'application/json'}), body: JSON.stringify(cmd),
    })).json()
    const deadline = Date.now() + 3000
    while (['queued', 'running'].includes(value.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
      value = await (await fetch(server.url + '/internal/v1/executions/' + cmd.executionId, {headers: hdr()})).json()
    }
    return value
  }

  // 1. CAP-PLG-02: 上传插件包并解析 packageMetadata
  const pkg1 = multipart(
    'chart-gen.difypkg',
    testPluginArchive({uniqueIdentifier: 'chart-gen', name: '图表生成插件', version: '1.0.0', dependencies: [{name: 'echarts', version: '5.5.0'}]}),
  )
  const up1 = await (
    await fetch(server.url + '/internal/v1/intake/plugin', {
      method: 'POST',
      headers: hdr({'content-type': pkg1.contentType, 'idempotency-key': 'plg-v1'}),
      body: pkg1.body,
    })
  ).json()
  assert.equal(up1.status, 'ready')
  const intake1 = await (await fetch(server.url + `/internal/v1/intake/plugin/${up1.intakeId}`, {headers: hdr()})).json()
  assert.equal(intake1.packageMetadata.uniqueIdentifier, 'chart-gen')
  assert.equal(intake1.packageMetadata.dependencies.length, 1)

  // 2. CAP-PLG-03: PLG-01 上架发布
  approvedInputs.set('exec-plg-pub', {
    decisionRef: 'dec-plg-pub',
    ticketType: 'PLG-01',
    action: 'publish_package',
    resourceId: 'chart-gen',
    fields: {intakeId: intake1.intakeId, '审批版本指纹': intake1.sha256, '公开方式': '受限审批安装'},
    preconditions: [],
  })
  const pubRes = await exec({
    executionId: 'exec-plg-pub',
    ticketNo: 'PLG-01-1',
    ticketType: 'PLG-01',
    ticketTypeVersion: '1',
    action: 'publish_package',
    resourceId: 'chart-gen',
    account: 'chen.yu',
    org: '平台运营组',
    payload: {decisionRef: 'dec-plg-pub'},
  })
  assert.equal(pubRes.status, 'succeeded')

  // 3. PLG-03 安装 + GET 对账落库安装实例
  const instStart = await exec({
    executionId: 'exec-plg-inst',
    ticketNo: 'PLG-03-inst',
    ticketType: 'PLG-03',
    ticketTypeVersion: '1',
    action: 'install',
    resourceId: 'chart-gen',
    account: 'chen.yu',
    org: '平台运营组',
    payload: {workspaceId: 'ws-p', version: '1.0.0', sha256: intake1.sha256},
  })
  assert.equal(instStart.status, 'reconciling')
  const instDone = await (await fetch(server.url + '/internal/v1/executions/exec-plg-inst', {headers: hdr()})).json()
  assert.equal(instDone.status, 'succeeded')
  const installationId = instDone.result.details.installationId
  assert.ok(installationId)
  assert.notEqual(installationId, 'native-chart-1')
  assert.equal(instDone.result.details.productInstallationId, 'native-chart-1')

  // 4. CAP-PLG-03: PLG-02 上下文与变更再审发布 v2.0.0
  const ctx02 = await (await fetch(server.url + '/internal/v1/execution-contexts/PLG-02?action=revise_package&resourceId=chart-gen', {headers: hdr()})).json()
  assert.equal(ctx02.fields['原版本号'], '1.0.0')
  assert.equal(ctx02.fields['插件唯一标识'], 'chart-gen')

  const pkg2 = multipart('chart-gen-v2.difypkg', testPluginArchive({uniqueIdentifier: 'chart-gen', name: '图表生成插件', version: '2.0.0', dependencies: []}))
  const up2 = await (
    await fetch(server.url + '/internal/v1/intake/plugin', {
      method: 'POST',
      headers: hdr({'content-type': pkg2.contentType, 'idempotency-key': 'plg-v2'}),
      body: pkg2.body,
    })
  ).json()
  const intake2 = await (await fetch(server.url + `/internal/v1/intake/plugin/${up2.intakeId}`, {headers: hdr()})).json()
  approvedInputs.set('exec-plg-rev', {
    decisionRef: 'dec-plg-rev',
    ticketType: 'PLG-02',
    action: 'revise_package',
    resourceId: 'chart-gen',
    fields: {intakeId: intake2.intakeId, '新版本指纹': intake2.sha256, '升级策略': '逐个工单升级'},
    preconditions: ctx02.preconditions,
  })
  const revRes = await exec({
    executionId: 'exec-plg-rev',
    ticketNo: 'PLG-02-1',
    ticketType: 'PLG-02',
    ticketTypeVersion: '1',
    action: 'revise_package',
    resourceId: 'chart-gen',
    account: 'chen.yu',
    org: '平台运营组',
    payload: {decisionRef: 'dec-plg-rev'},
  })
  assert.equal(revRes.status, 'succeeded')
  assert.equal(revRes.result.version, '2.0.0')

  // 5. CAP-PLG-04 & 05: PLG-03 候选、升级上下文与升级对账
  const cands = await (await fetch(server.url + '/internal/v1/execution-contexts/PLG-03/candidates?action=upgrade&workspaceId=ws-p', {headers: hdr()})).json()
  assert.equal(cands.items.length, 1)
  const upgCtx = await (
    await fetch(server.url + `/internal/v1/execution-contexts/PLG-03?action=upgrade&resourceId=chart-gen&workspaceId=ws-p&installationId=${installationId}`, {headers: hdr()})
  ).json()
  assert.equal(upgCtx.eligible, true)
  assert.equal(upgCtx.fields['原安装版本号'], '1.0.0')
  assert.equal(upgCtx.fields['批准版本号'], '2.0.0')

  approvedInputs.set('exec-plg-upg', {
    decisionRef: 'dec-plg-upg',
    ticketType: 'PLG-03',
    action: 'upgrade',
    resourceId: 'chart-gen',
    fields: upgCtx.fields,
    preconditions: upgCtx.preconditions,
  })
  const upgStart = await exec({
    executionId: 'exec-plg-upg',
    ticketNo: 'PLG-03-upg',
    ticketType: 'PLG-03',
    ticketTypeVersion: '1',
    action: 'upgrade',
    resourceId: 'chart-gen',
    account: 'chen.yu',
    org: '平台运营组',
    payload: {decisionRef: 'dec-plg-upg'},
  })
  assert.equal(upgStart.status, 'reconciling')
  const upgDone = await (await fetch(server.url + '/internal/v1/executions/exec-plg-upg', {headers: hdr()})).json()
  assert.equal(upgDone.status, 'succeeded')
  assert.equal(upgDone.result.version, '2.0.0')

  // 6. CAP-PLG-06: PLG-04 禁用与恢复
  const disCtx = await (await fetch(server.url + '/internal/v1/execution-contexts/PLG-04?action=disable_plugin&resourceId=chart-gen&workspaceId=ws-p', {headers: hdr()})).json()
  assert.equal(disCtx.fields['定向操作能力'], 'verified')
  assert.equal(disCtx.fields['实例状态'], '已启用')
  approvedInputs.set('exec-plg-dis', {
    decisionRef: 'dec-plg-dis',
    ticketType: 'PLG-04',
    action: 'disable_plugin',
    resourceId: 'chart-gen',
    fields: disCtx.fields,
    preconditions: disCtx.preconditions,
  })
  const disRes = await exec({
    executionId: 'exec-plg-dis',
    ticketNo: 'PLG-04-dis',
    ticketType: 'PLG-04',
    ticketTypeVersion: '1',
    action: 'disable_plugin',
    resourceId: 'chart-gen',
    account: 'system_event',
    org: '系统服务',
    payload: {decisionRef: 'dec-plg-dis'},
  })
  assert.equal(disRes.status, 'succeeded')
  assert.equal(disRes.result.details.values['插件状态'], '已禁用')

  const restCtx = await (await fetch(server.url + '/internal/v1/execution-contexts/PLG-04?action=restore_plugin&resourceId=chart-gen&workspaceId=ws-p', {headers: hdr()})).json()
  assert.equal(restCtx.fields['实例状态'], '已禁用')
  approvedInputs.set('exec-plg-rest', {
    decisionRef: 'dec-plg-rest',
    ticketType: 'PLG-04',
    action: 'restore_plugin',
    resourceId: 'chart-gen',
    fields: restCtx.fields,
    preconditions: restCtx.preconditions,
  })
  const restRes = await exec({
    executionId: 'exec-plg-rest',
    ticketNo: 'PLG-04-rest',
    ticketType: 'PLG-04',
    ticketTypeVersion: '1',
    action: 'restore_plugin',
    resourceId: 'chart-gen',
    account: 'system_event',
    org: '系统服务',
    payload: {decisionRef: 'dec-plg-rest'},
  })
  assert.equal(restRes.status, 'succeeded')
  assert.equal(restRes.result.details.values['插件状态'], '已启用')

  // 7. CAP-PLG-05: PLG-03 卸载
  const unCtx = await (
    await fetch(server.url + `/internal/v1/execution-contexts/PLG-03?action=uninstall&resourceId=chart-gen&workspaceId=ws-p&installationId=${installationId}`, {headers: hdr()})
  ).json()
  assert.equal(unCtx.fields['批准版本号'], '2.0.0')
  assert.equal(unCtx.fields['原安装版本号'], '2.0.0')
  approvedInputs.set('exec-plg-un', {
    decisionRef: 'dec-plg-un',
    ticketType: 'PLG-03',
    action: 'uninstall',
    resourceId: 'chart-gen',
    fields: unCtx.fields,
    preconditions: unCtx.preconditions,
  })
  const unRes = await exec({
    executionId: 'exec-plg-un',
    ticketNo: 'PLG-03-un',
    ticketType: 'PLG-03',
    ticketTypeVersion: '1',
    action: 'uninstall',
    resourceId: 'chart-gen',
    account: 'chen.yu',
    org: '平台运营组',
    payload: {decisionRef: 'dec-plg-un'},
  })
  assert.equal(unRes.status, 'succeeded')
  assert.equal(unRes.result.details.status, '已卸载')
  assert.ok(difyCalls.some(c => c.path === '/console/api/workspaces/current/plugin/uninstall'))
})
