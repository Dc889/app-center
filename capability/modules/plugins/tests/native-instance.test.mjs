import test from 'node:test'
import assert from 'node:assert/strict'
import {listen, json, body} from '../../../../runtime/http.mjs'
import {uninstallDifyPlugin, setDifyPluginState} from '../adapters/dify-uninstall.mjs'
import {capabilityModule} from '../public.mjs'

async function setup(t, {failedTask = false, acknowledge = true} = {}) {
  const writes = []
  let items = [{id: 'actual-native-id', tenant_id: 'real-ws', plugin_unique_identifier: 'publisher/tool:1.0.0@checksum'}]
  const server = await listen(async (req, res, path) => {
    if (path === '/console/api/workspaces/current') {assert.equal(req.method, 'GET'); return json(res, {id: 'real-ws'})}
    if (path === '/console/api/workspaces/current/plugin/list') return json(res, {total: failedTask ? 0 : items.length, plugins: failedTask ? [] : items})
    if (path === '/console/api/workspaces/current/plugin/tasks/failed-task') return json(res, {task: {status: 'failed', plugins: []}})
    if (path === '/console/api/workspaces/current/plugin/uninstall') {
      const payload = await body(req); writes.push(payload)
      if (acknowledge) items = []
      return json(res, {success: acknowledge})
    }
    return json(res, {error: 'unsupported'}, 404)
  })
  const values = {DIFY_API_BASE: server.url, DIFY_CONSOLE_TOKEN: 'test', DIFY_WORKSPACE_ID: 'real-ws'}
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(async () => {await server.close(); for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value
  }})
  return {writes}
}
const target = {productInstallationId: 'actual-native-id', workspaceId: 'real-ws', uniqueIdentifier: 'publisher/tool:1.0.0@checksum'}

test('卸载使用原生ID与版本映射，并以真实列表确认不存在', async t => {
  const app = await setup(t)
  const result = await uninstallDifyPlugin(target)
  assert.equal(result.uninstalled, true)
  assert.deepEqual(app.writes, [{plugin_installation_id: 'actual-native-id'}])
})

test('缺少原生映射、平台ID冒充或版本漂移时不能发送卸载', async t => {
  const app = await setup(t)
  await assert.rejects(() => uninstallDifyPlugin({...target, productInstallationId: undefined}), error => error.status === 501)
  await assert.rejects(() => uninstallDifyPlugin({...target, productInstallationId: 'platform-inst-id'}), error => error.code === 'PLUGIN_INSTALLATION_CHANGED')
  await assert.rejects(() => uninstallDifyPlugin({...target, uniqueIdentifier: 'publisher/tool:2.0.0@new'}), error => error.code === 'PLUGIN_INSTALLATION_CHANGED')
  assert.equal(app.writes.length, 0)
})

test('原生HTTP200 success=false不能回写已卸载', async t => {
  await setup(t, {acknowledge: false})
  await assert.rejects(() => uninstallDifyPlugin(target), error => error.code === 'PLUGIN_UNINSTALL_FAILED')
})

test('确认失败的原生安装任务进入failed终态，不永久停在reconciling或自动重建', async t => {
  await setup(t, {failedTask: true})
  const row = {command: {executionId: 'failed-original'}, productTask: {workspaceId: 'real-ws', pluginUniqueIdentifier: target.uniqueIdentifier, upstreamTaskId: 'failed-task'}, state: {status: 'reconciling'}}
  let saves = 0
  const services = {row, store: {put() {saves++}}, stamp: () => new Date().toISOString()}
  await capabilityModule.reconcile(services)
  assert.equal(row.state.status, 'failed')
  assert.equal(row.state.result.failureCode, 'PLUGIN_INSTALL_FAILED')
  assert.equal(row.state.result.retryable, false)
  await capabilityModule.reconcile(services)
  assert.equal(saves, 1)
})

test('Dify1.7.1不存在的通用停用端点明确501，不以本地台账禁用冒充', async t => {
  await setup(t)
  await assert.rejects(() => setDifyPluginState({...target, action: 'disable_plugin'}), error => error.status === 501 && error.code === 'UPSTREAM_UNSUPPORTED')
})
