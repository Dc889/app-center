import test from 'node:test'
import assert from 'node:assert/strict'
import {listen, json} from '../../../../runtime/http.mjs'
import {plg04Context} from '../queries/execution-contexts.mjs'
import {setDifyPluginState} from '../adapters/dify-uninstall.mjs'
import {capabilityModule} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'

async function fixture(t, alert) {
  const installed = {installationId: 'platform-instance', productInstallationId: 'native-instance', resourceId: 'plugin',
    workspaceId: 'ws', status: '已启用', version: '1.0.0', revision: 3, pluginName: 'Plugin', disableCycleId: 'cycle'}
  const openLedger = name => name === 'installations' ? {all: () => [installed], get: () => installed} : {get: () => alert}
  const server = await listen((req, res) => plg04Context({res, query: new URL(req.url, 'http://local').searchParams, openLedger}))
  t.after(() => server.close())
  return suffix => fetch(server.url + '/?action=disable_plugin&resourceId=plugin&workspaceId=ws' + suffix)
}

test('安装台账存在不能把未实现的定向调用控制标为verified', async t => {
  const request = await fixture(t)
  const res = await request(''), value = await res.json()
  assert.equal(res.status, 200); assert.equal(value.eligible, false)
  assert.equal(value.fields['定向操作能力'], 'unsupported')
  assert.equal(value.fields['实例状态'], '未知'); assert.equal(value.fields['安装实例ID'], null)
  assert.deepEqual(value.preconditions, [])
})

test('传入观察执行与完整时间范围不能制造采集或观察通过', async t => {
  const request = await fixture(t)
  const res = await request('&observationExecutionId=pretend&observeFrom=2026-01-01T00:00:00Z&observeUntil=2026-12-31T00:00:00Z')
  assert.equal(res.status, 503)
  assert.equal((await res.json()).error.code, 'PLUGIN_OBSERVATION_UNAVAILABLE')
})

test('告警缺失或来自其他插件/工作区不能移用采集证据', async t => {
  for (const alert of [undefined, {resourceId: 'other', workspaceId: 'ws'}, {resourceId: 'plugin', workspaceId: 'other'}]) {
    const request = await fixture(t, alert)
    const res = await request('&sourceEventId=event')
    assert.equal(res.status, alert ? 409 : 404)
  }
})

test('同范围告警记录不能覆盖实例、工作区或目标能力的权威字段', async t => {
  const request = await fixture(t, {resourceId: 'plugin', workspaceId: 'ws', 'workspace ID': 'forged', '定向操作能力': 'verified',
    '安装实例ID': 'forged', '实例状态': '已禁用', '统计数据完整': false, '触发规则': '失败率'})
  const value = await (await request('&sourceEventId=event')).json()
  assert.equal(value.fields['workspace ID'], 'ws'); assert.equal(value.fields['定向操作能力'], 'unsupported')
  assert.equal(value.fields['安装实例ID'], null); assert.equal(value.fields['告警ID'], 'event')
})

test('未知控制协议即使有同名HTTP200端点也不调用，不据此回写插件已禁用', async t => {
  let calls = 0
  const server = await listen((_req, res) => {calls++; return json(res, {success: true})})
  const before = process.env.DIFY_API_BASE
  process.env.DIFY_API_BASE = server.url
  t.after(async () => {await server.close(); if (before === undefined) delete process.env.DIFY_API_BASE; else process.env.DIFY_API_BASE = before})
  await assert.rejects(() => setDifyPluginState({productInstallationId: 'native', workspaceId: 'ws', action: 'disable_plugin'}),
    error => error.status === 501 && error.code === 'UPSTREAM_UNSUPPORTED')
  assert.equal(calls, 0)
})

test('旧部署证明不能把尚未实现的PLG-04动作提升为verified', () => {
  const actions = {}
  for (const spec of capabilityModule.actions) (actions[spec.ticketType] ??= []).push(spec.action)
  const evidence = ['disable_plugin', 'restore_plugin'].map(action => ({ticketType: 'PLG-04', ticketTypeVersion: '1',
    action, variant: null, workspaceId: 'ws', state: 'verified'}))
  const registry = createRegistry([capabilityModule], {actions, evidence: () => evidence})
  const rows = registry.capabilities('ws').items.filter(item => item.ticketType === 'PLG-04')
  assert.equal(rows.length, 2)
  for (const row of rows) {assert.equal(row.state, 'unsupported'); assert.equal(row.reasonCode, 'IMPLEMENTATION_INCOMPLETE')}
})
