import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'
import {listen, json} from '../../../../runtime/http.mjs'

test('tools 模块导出结构契约、动作与路由登记', () => {
  assert.equal(capabilityModule.id, 'tools')
  assert.equal(capabilityModule.actions.length, 1)
  assert.equal(capabilityModule.actions[0].ticketType, 'TOL-01')
  assert.equal(typeof capabilityModule.actions[0].execute, 'function')
})

test('TOL-01 全生命周期：工具发现、首次批准、配置指纹漂移拦截、变更再审与撤销批准', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tools-lifecycle-'))
  let toolVersion = '1.0.0'
  const difyServer = await listen((req, res, path) => {
    if (path === '/console/api/workspaces/current/tools/api') {
      return json(res, [
        {
          id: 'prov-gw',
          name: '警务网关',
          tools: [
            {
              id: 'tool-query',
              label: {zh_Hans: '卷宗检索工具'},
              version: toolVersion,
              parameters_schema: {type: 'object', properties: {id: {type: 'string'}}},
              description: '查询卷宗元数据',
            },
          ],
        },
      ])
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

  const prevBase = process.env.DIFY_API_BASE
  const prevToken = process.env.DIFY_CONSOLE_TOKEN
  process.env.DIFY_API_BASE = difyServer.url
  process.env.DIFY_CONSOLE_TOKEN = 'dify-tok'

  const registry = createRegistry([capabilityModule], {actions: {'TOL-01': ['set_tool_approval']}, evidence: () => []})
  const server = await startExecutionServer({dir, token: 'tok', management: mgmt.url}, registry)
  t.after(async () => {
    await server.close()
    await difyServer.close()
    await mgmt.close()
    await rm(dir, {recursive: true, force: true})
    if (prevBase === undefined) delete process.env.DIFY_API_BASE
    else process.env.DIFY_API_BASE = prevBase
    if (prevToken === undefined) delete process.env.DIFY_CONSOLE_TOKEN
    else process.env.DIFY_CONSOLE_TOKEN = prevToken
  })

  const call = (path, {method = 'GET', body} = {}) =>
    fetch(server.url + '/internal/v1' + path, {
      method,
      headers: {authorization: 'Bearer tok', 'content-type': 'application/json', 'x-account': 'zhou.min', 'x-role': 'operator'},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  // 1. 候选与首次批准上下文
  const cands = await (await call('/execution-contexts/TOL-01/candidates?workspaceId=ws-1&operation=' + encodeURIComponent('首次批准'))).json()
  assert.equal(cands.items.length, 1)
  assert.equal(cands.items[0].resourceId, 'tool-query')

  const ctx1 = await (
    await call('/execution-contexts/TOL-01?action=set_tool_approval&resourceId=tool-query&workspaceId=ws-1&operation=' + encodeURIComponent('首次批准'))
  ).json()
  assert.equal(ctx1.eligible, true)
  assert.match(ctx1.fields['工具配置指纹'], /^[a-f0-9]{64}$/)
  assert.equal(ctx1.preconditions.find(p => p.kind === 'tool_approval').revision, 0)

  // 2. 配置指纹漂移时拒绝执行
  toolVersion = '1.0.1'
  approvedInputs.set('exec-tol-stale', {
    decisionRef: 'dec-stale',
    ticketType: 'TOL-01',
    action: 'set_tool_approval',
    resourceId: 'tool-query',
    fields: {...ctx1.fields, '操作类型': '首次批准', '对外使用权限': '允许'},
    preconditions: ctx1.preconditions,
  })
  const staleRes = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-tol-stale',
        ticketNo: 'TOL-01-stale',
        ticketType: 'TOL-01',
        ticketTypeVersion: '1',
        action: 'set_tool_approval',
        resourceId: 'tool-query',
        account: 'zhou.min',
        org: '平台运营组',
        payload: {decisionRef: 'dec-stale'},
      },
    })
  ).json()
  assert.equal(staleRes.status, 'failed')
  assert.equal(staleRes.result.failureCode, 'STALE_SNAPSHOT')

  // 3. 恢复原版本执行首次批准
  toolVersion = '1.0.0'
  approvedInputs.set('exec-tol-1', {
    decisionRef: 'dec-1',
    ticketType: 'TOL-01',
    action: 'set_tool_approval',
    resourceId: 'tool-query',
    fields: {...ctx1.fields, '操作类型': '首次批准', '对外使用权限': '允许'},
    preconditions: ctx1.preconditions,
  })
  const res1 = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-tol-1',
        ticketNo: 'TOL-01-1',
        ticketType: 'TOL-01',
        ticketTypeVersion: '1',
        action: 'set_tool_approval',
        resourceId: 'tool-query',
        account: 'zhou.min',
        org: '平台运营组',
        payload: {decisionRef: 'dec-1'},
      },
    })
  ).json()
  assert.equal(res1.status, 'succeeded')
  assert.equal(res1.result.details.revision, 1)

  // 4. 工具版本升级 -> 变更再审上下文含原工单号与配置差异 -> 执行变更再审
  toolVersion = '2.0.0'
  const ctx2 = await (
    await call('/execution-contexts/TOL-01?action=set_tool_approval&resourceId=tool-query&workspaceId=ws-1&operation=' + encodeURIComponent('变更再审'))
  ).json()
  assert.equal(ctx2.fields['原批准工单号'], 'TOL-01-1')
  assert.equal(ctx2.fields['原工具版本'], '1.0.0')
  assert.ok(ctx2.fields['配置差异'].some(d => d['差异项'] === '版本'))
  approvedInputs.set('exec-tol-2', {
    decisionRef: 'dec-2',
    ticketType: 'TOL-01',
    action: 'set_tool_approval',
    resourceId: 'tool-query',
    fields: {...ctx2.fields, '操作类型': '变更再审', '对外使用权限': '允许'},
    preconditions: ctx2.preconditions,
  })
  const res2 = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-tol-2',
        ticketNo: 'TOL-01-2',
        ticketType: 'TOL-01',
        ticketTypeVersion: '1',
        action: 'set_tool_approval',
        resourceId: 'tool-query',
        account: 'zhou.min',
        org: '平台运营组',
        payload: {decisionRef: 'dec-2'},
      },
    })
  ).json()
  assert.equal(res2.status, 'succeeded')
  assert.equal(res2.result.details.revision, 2)

  // 5. 撤销批准
  const ctx3 = await (
    await call('/execution-contexts/TOL-01?action=set_tool_approval&resourceId=tool-query&workspaceId=ws-1&operation=' + encodeURIComponent('撤销批准'))
  ).json()
  approvedInputs.set('exec-tol-3', {
    decisionRef: 'dec-3',
    ticketType: 'TOL-01',
    action: 'set_tool_approval',
    resourceId: 'tool-query',
    fields: {...ctx3.fields, '操作类型': '撤销批准', '对外使用权限': '禁止'},
    preconditions: ctx3.preconditions,
  })
  const res3 = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-tol-3',
        ticketNo: 'TOL-01-3',
        ticketType: 'TOL-01',
        ticketTypeVersion: '1',
        action: 'set_tool_approval',
        resourceId: 'tool-query',
        account: 'zhou.min',
        org: '平台运营组',
        payload: {decisionRef: 'dec-3'},
      },
    })
  ).json()
  assert.equal(res3.status, 'succeeded')
  assert.equal(res3.result.details.status, 'revoked')
  assert.equal(res3.result.details.externalAllowed, '禁止')
})
