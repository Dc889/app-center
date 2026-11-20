import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'
import {listen, json} from '../../../../runtime/http.mjs'

test('integrations 模块导出结构契约与资源/路由登记', () => {
  assert.equal(capabilityModule.id, 'integrations')
  assert.equal(Array.isArray(capabilityModule.actions), true)
  assert.equal(capabilityModule.actions.length, 0)
  assert.ok(capabilityModule.routes.some(r => r.method === 'GET' && r.path === '/internal/v1/workspaces'))
  assert.equal(typeof capabilityModule.resources.model.list, 'function')
  assert.equal(typeof capabilityModule.resources.model.detail, 'function')
})

test('integrations /internal/v1/workspaces 路由参数校验、分页与严格上游模式', async () => {
  const route = capabilityModule.routes.find(r => r.method === 'GET' && r.path === '/internal/v1/workspaces')
  await assert.rejects(
    async () => route.handle({req: {url: 'http://localhost/internal/v1/workspaces?product=other'}, res: {}}),
    err => err.status === 400 && err.code === 'INVALID_PRODUCT',
  )

  let page1 = null
  const capture = cb => ({
    writeHead(status) {
      assert.equal(status, 200)
    },
    end(str) {
      cb(JSON.parse(str))
    },
  })
  await route.handle({req: {url: 'http://localhost/internal/v1/workspaces?product=dify&limit=2'}, res: capture(d => (page1 = d))})
  assert.equal(page1.items.length, 2)
  assert.ok(page1.nextCursor)

  let page2 = null
  await route.handle({
    req: {url: `http://localhost/internal/v1/workspaces?product=dify&limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`},
    res: capture(d => (page2 = d)),
  })
  assert.equal(page2.items.length, 1)
  assert.equal(page2.nextCursor, null)

  // 严格模式下无真实 Dify 配置返回 501
  const prevStrict = process.env.CAPABILITY_STRICT_UPSTREAM
  const prevBase = process.env.DIFY_API_BASE
  process.env.CAPABILITY_STRICT_UPSTREAM = '1'
  delete process.env.DIFY_API_BASE
  try {
    await assert.rejects(
      async () => route.handle({req: {url: 'http://localhost/internal/v1/workspaces?product=dify'}, res: {}}),
      err => err.status === 501 && err.code === 'UPSTREAM_UNSUPPORTED',
    )
    await assert.rejects(
      async () => capabilityModule.resources.model.list({query: new URLSearchParams()}),
      err => err.status === 501 && err.code === 'UPSTREAM_UNSUPPORTED',
    )
  } finally {
    if (prevStrict === undefined) delete process.env.CAPABILITY_STRICT_UPSTREAM
    else process.env.CAPABILITY_STRICT_UPSTREAM = prevStrict
    if (prevBase !== undefined) process.env.DIFY_API_BASE = prevBase
  }
})

test('integrations 对接真实 Dify Console API 拉取工作区与模型列表/详情及游标分页', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'integrations-dify-'))
  const dify = await listen((req, res, path) => {
    if (path === '/console/api/workspaces') {
      return json(res, {
        workspaces: [
          {id: 'ws-c', name: '丙区', status: 'normal'},
          {id: 'ws-a', name: '甲区', status: 'normal'},
          {id: 'ws-archived', name: '已归档区', status: 'archive'},
          {id: 'ws-b', name: '乙区', status: 'normal'},
        ],
      })
    }
    if (path === '/console/api/workspaces/current/models/model-types/llm') {
      return json(res, {
        data: [
          {
            provider: 'openai',
            models: [
              {model: 'gpt-4o', label: {zh_Hans: 'GPT-4o 推理模型'}, model_type: 'llm', status: 'active'},
              {model: 'legacy-disabled', label: {zh_Hans: '停用模型'}, model_type: 'llm', status: 'disabled'},
            ],
          },
          {
            provider: 'qwen',
            models: [{model: 'qwen-max', label: {zh_Hans: '通义千问 Max'}, model_type: 'llm', status: 'active'}],
          },
        ],
      })
    }
    return json(res, {error: 'not found'}, 404)
  })

  const prevBase = process.env.DIFY_API_BASE
  const prevToken = process.env.DIFY_CONSOLE_TOKEN
  process.env.DIFY_API_BASE = dify.url
  process.env.DIFY_CONSOLE_TOKEN = 'dify-tok'

  const registry = createRegistry([capabilityModule], {actions: {}, evidence: () => []})
  const server = await startExecutionServer({dir, token: 'tok'}, registry)
  t.after(async () => {
    await server.close()
    await dify.close()
    await rm(dir, {recursive: true, force: true})
    if (prevBase === undefined) delete process.env.DIFY_API_BASE
    else process.env.DIFY_API_BASE = prevBase
    if (prevToken === undefined) delete process.env.DIFY_CONSOLE_TOKEN
    else process.env.DIFY_CONSOLE_TOKEN = prevToken
  })

  const get = path => fetch(server.url + '/internal/v1' + path, {headers: {authorization: 'Bearer tok'}})

  // 1. 工作区过滤归档 + 分页
  const wsPage1 = await (await get('/workspaces?product=dify&limit=2')).json()
  assert.deepEqual(
    wsPage1.items.map(w => w.workspaceId),
    ['ws-a', 'ws-b'],
  )
  assert.equal(wsPage1.nextCursor, 'ws-b')
  const wsPage2 = await (await get('/workspaces?product=dify&limit=2&cursor=ws-b')).json()
  assert.deepEqual(wsPage2.items, [{workspaceId: 'ws-c', name: '丙区'}])
  assert.equal(wsPage2.nextCursor, null)

  // 2. 模型列表（过滤非 active）+ 搜索 + 详情
  const models = await (await get('/resources?kind=model&workspaceId=ws-a')).json()
  assert.equal(models.items.length, 2)
  assert.equal(models.items[0].resourceId, 'openai/gpt-4o')
  assert.equal(models.items[1].resourceId, 'qwen/qwen-max')

  const modelDetail = await (await get('/resources/model/' + encodeURIComponent('openai/gpt-4o'))).json()
  assert.equal(modelDetail.resourceId, 'openai/gpt-4o')
  assert.equal(modelDetail.name, 'GPT-4o 推理模型')
  assert.equal(modelDetail.source, 'openai')
  assert.equal((await get('/resources/model/missing')).status, 404)
})
