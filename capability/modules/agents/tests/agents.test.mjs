import test from 'node:test'
import assert from 'node:assert/strict'
import {capabilityModule} from '../public.mjs'

test('agents 模块导出结构契约与动作登记', () => {
  assert.equal(capabilityModule.id, 'agents')
  assert.equal(Array.isArray(capabilityModule.actions), true)
  assert.equal(capabilityModule.actions.length, 5)
  const syncAction = capabilityModule.actions.find(a => a.action === 'sync_app')
  assert.ok(syncAction)
  assert.equal(syncAction.ticketType, 'AG-01')
  assert.equal(syncAction.ready, false)

  const pubAction = capabilityModule.actions.find(a => a.action === 'publish')
  assert.ok(pubAction)
  assert.equal(pubAction.ticketType, 'AG-02')
  assert.equal(pubAction.ready, false)

  const withAction = capabilityModule.actions.find(a => a.action === 'withdraw_app')
  assert.ok(withAction)
  assert.equal(withAction.ticketType, 'AG-05')
  assert.equal(withAction.ready, false)
})

test('agents 资源候选读取', async () => {
  const apps = await capabilityModule.resources.dify_app('ws-default')
  assert.ok(Array.isArray(apps))
  assert.ok(apps.some(a => a.resourceId.includes('app-')))
})

test('agents 目录列表与详情读取', async () => {
  let listData = null
  const req = {url: 'http://localhost/catalog?kind=agent&workspaceId=ws-default', headers: {}}
  const res = {
    writeHead() {},
    end(str) { listData = JSON.parse(str) },
  }
  await capabilityModule.catalogs.agent.list({
    req,
    res,
    query: new URLSearchParams('kind=agent&workspaceId=ws-default'),
  })
  assert.ok(listData)
  assert.ok(Array.isArray(listData.items))
  assert.ok(listData.items.some(i => i.resourceId === 'app-police-query'))

  let detailData = null
  const detailRes = {
    writeHead() {},
    end(str) { detailData = JSON.parse(str) },
  }
  await capabilityModule.catalogs.agent.detail({
    req,
    res: detailRes,
    query: new URLSearchParams('action=withdraw_app'),
    resourceId: 'app-police-query',
  })
  assert.ok(detailData)
  assert.equal(detailData.resourceId, 'app-police-query')
  assert.deepEqual(detailData.actions, ['withdraw_app'])
})

test('agents 未配置 Dify 环境时执行草稿抛出 501 UPSTREAM_UNSUPPORTED', async () => {
  const syncAction = capabilityModule.actions.find(a => a.action === 'sync_app')
  const command = {executionId: 'exec-sync', resourceId: 'app-1', payload: {}}
  const state = {status: 'queued'}
  await assert.rejects(
    async () => syncAction.execute({command, state}),
    err => err.status === 501 && err.code === 'UPSTREAM_UNSUPPORTED',
  )
})
