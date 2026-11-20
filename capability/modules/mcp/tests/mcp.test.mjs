import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'
import {startMcp} from '../../../repositories/mcp/public.mjs'
import {listen, json} from '../../../../runtime/http.mjs'

test('mcp 模块导出结构契约、动作与路由登记', () => {
  assert.equal(capabilityModule.id, 'mcp')
  assert.equal(capabilityModule.actions.length, 5)
  for (const act of ['register_mcp', 'bind', 'unbind_mcp', 'isolate_mcp', 'withdraw_mcp']) {
    const entry = capabilityModule.actions.find(a => a.action === act)
    assert.ok(entry)
    assert.equal(typeof entry.execute, 'function')
  }
  assert.equal(typeof capabilityModule.resources.mcp_registration.list, 'function')
  assert.equal(typeof capabilityModule.resources.mcp_registration.detail, 'function')
})

test('MCP-01/02/03 全生命周期：技术注册详情、上架、指纹校验绑定、单用户解绑隔离与目录下架', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-lifecycle-'))
  const mcpRepo = await startMcp({dir, token: 'tok'})
  const approvedInputs = new Map()
  const mgmt = await listen(
    (req, res, path) => {
      const m = /^\/internal\/v1\/approved-inputs\/([\w-]+)$/.exec(path)
      if (m && approvedInputs.has(m[1])) return json(res, approvedInputs.get(m[1]))
      return json(res, {error: {code: 'NOT_FOUND'}}, 404)
    },
    {token: 'tok'},
  )
  const registry = createRegistry([capabilityModule], {
    actions: {'MCP-01': ['register_mcp'], 'MCP-02': ['bind'], 'MCP-03': ['unbind_mcp', 'isolate_mcp', 'withdraw_mcp']},
    evidence: () => [],
  })
  const server = await startExecutionServer({dir, token: 'tok', mcp: mcpRepo.url, management: mgmt.url}, registry)
  t.after(async () => {
    await server.close()
    await mcpRepo.close()
    await mgmt.close()
    await rm(dir, {recursive: true, force: true})
  })

  const call = (path, {method = 'GET', body, account = 'chen.yu', role = 'user', org = '业务一部'} = {}) =>
    fetch(server.url + '/internal/v1' + path, {
      method,
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
        'x-account': account,
        'x-role': role,
        'x-org': encodeURIComponent(org),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  // 1. CAP-MCP-02: 技术注册列表与详情（含 64 位 URL 指纹与工具定义）
  const regList = await (await call('/resources?kind=mcp_registration&workspaceId=ws-a')).json()
  assert.ok(regList.items.some(r => r.resourceId === 'mcp-archive-reg'))
  const regDetail = await (await call('/resources/mcp_registration/mcp-archive-reg')).json()
  assert.equal(regDetail.data.registrationId, 'mcp-archive-reg')
  assert.match(regDetail.data.urlFingerprint, /^[a-f0-9]{64}$/)
  assert.ok(regDetail.data.tools.length >= 2)

  // 2. CAP-MCP-03: MCP-01 上架注册（指纹漂移拒绝，正常指纹成功）
  approvedInputs.set('exec-mcp-reg-bad', {
    decisionRef: 'dec-bad',
    ticketType: 'MCP-01',
    action: 'register_mcp',
    resourceId: 'mcp-new-archive',
    fields: {'技术注册ID': 'mcp-archive-reg', 'URL指纹': 'f'.repeat(64)},
    preconditions: [],
  })
  const badReg = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-mcp-reg-bad',
        ticketNo: 'MCP-01-bad',
        ticketType: 'MCP-01',
        ticketTypeVersion: '1',
        action: 'register_mcp',
        resourceId: 'mcp-new-archive',
        account: 'zhou.min',
        org: '平台运营组',
        payload: {decisionRef: 'dec-bad'},
      },
    })
  ).json()
  assert.equal(badReg.status, 'failed')
  assert.equal(badReg.result.failureCode, 'STALE_SNAPSHOT')

  approvedInputs.set('exec-mcp-reg-ok', {
    decisionRef: 'dec-ok',
    ticketType: 'MCP-01',
    action: 'register_mcp',
    resourceId: 'mcp-new-archive',
    fields: {'技术注册ID': 'mcp-archive-reg', 'MCP名称': '新版档案检索 MCP', 'URL指纹': regDetail.data.urlFingerprint},
    preconditions: [],
  })
  const okReg = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-mcp-reg-ok',
        ticketNo: 'MCP-01-ok',
        ticketType: 'MCP-01',
        ticketTypeVersion: '1',
        action: 'register_mcp',
        resourceId: 'mcp-new-archive',
        account: 'zhou.min',
        org: '平台运营组',
        payload: {decisionRef: 'dec-ok'},
      },
    })
  ).json()
  assert.equal(okReg.status, 'succeeded')

  // 3. CAP-MCP-04: 绑定上下文 + 两个用户先后绑定 MCP-02（错指纹被拒）
  const bindCtx = await (await call('/binding-contexts/mcp-new-archive?workspaceId=ws-a')).json()
  assert.equal(bindCtx.expectedUrlFingerprint, regDetail.data.urlFingerprint)
  assert.equal(bindCtx.bindingAccess, 'approval')

  const startsAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 3600_000).toISOString()
  const badBind = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-bind-bad',
        ticketNo: 'MCP-02-bad',
        ticketType: 'MCP-02',
        ticketTypeVersion: '1',
        action: 'bind',
        resourceId: 'mcp-new-archive',
        account: 'chen.yu',
        org: '业务一部',
        payload: {workspaceId: 'ws-a', startsAt, expiresAt, expectedUrlFingerprint: '0'.repeat(64)},
      },
    })
  ).json()
  assert.equal(badBind.status, 'failed')
  assert.equal(badBind.result.failureCode, 'STALE_SNAPSHOT')

  for (const [idx, acc] of ['chen.yu', 'li.qiang'].entries()) {
    const resBind = await (
      await call('/executions', {
        method: 'POST',
        body: {
          executionId: `exec-bind-${idx}`,
          ticketNo: `MCP-02-${idx}`,
          ticketType: 'MCP-02',
          ticketTypeVersion: '1',
          action: 'bind',
          resourceId: 'mcp-new-archive',
          account: acc,
          org: '业务一部',
          payload: {workspaceId: 'ws-a', startsAt, expiresAt, expectedUrlFingerprint: regDetail.data.urlFingerprint},
        },
      })
    ).json()
    assert.equal(resBind.status, 'succeeded')
  }

  // 4. CAP-MCP-05: 单用户解绑不扩大为目录处置（只解绑 chen.yu，保留 li.qiang）
  const unbindCtx = await (
    await call('/execution-contexts/MCP-03?action=unbind_mcp&resourceId=mcp-new-archive&workspaceId=ws-a&targetAccount=chen.yu', {
      account: 'zhou.min',
      role: 'operator',
    })
  ).json()
  assert.equal(unbindCtx.fields['绑定清单'].length, 1)
  assert.equal(unbindCtx.fields['绑定清单'][0].account, 'chen.yu')

  approvedInputs.set('exec-unbind-1', {
    decisionRef: 'dec-unbind-1',
    ticketType: 'MCP-03',
    action: 'unbind_mcp',
    resourceId: 'mcp-new-archive',
    fields: {'绑定清单': unbindCtx.fields['绑定清单']},
    preconditions: unbindCtx.preconditions,
  })
  const unbindRes = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-unbind-1',
        ticketNo: 'MCP-03-unbind',
        ticketType: 'MCP-03',
        ticketTypeVersion: '1',
        action: 'unbind_mcp',
        resourceId: 'mcp-new-archive',
        account: 'zhou.min',
        org: '平台运营组',
        payload: {decisionRef: 'dec-unbind-1'},
      },
    })
  ).json()
  assert.equal(unbindRes.status, 'succeeded')
  assert.equal(unbindRes.result.details.unboundCount, 1)
  assert.equal(unbindRes.result.details.status, 'active')

  // 5. 目录隔离：读取剩余完整绑定（li.qiang），隔离目录并解绑残留
  const isoCtx = await (
    await call('/execution-contexts/MCP-03?action=isolate_mcp&resourceId=mcp-new-archive', {account: 'zhou.min', role: 'operator'})
  ).json()
  assert.equal(isoCtx.fields['绑定清单'].length, 1)
  assert.equal(isoCtx.fields['绑定清单'][0].account, 'li.qiang')

  approvedInputs.set('exec-iso-1', {
    decisionRef: 'dec-iso-1',
    ticketType: 'MCP-03',
    action: 'isolate_mcp',
    resourceId: 'mcp-new-archive',
    fields: {'绑定清单': isoCtx.fields['绑定清单']},
    preconditions: isoCtx.preconditions,
  })
  const isoRes = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-iso-1',
        ticketNo: 'MCP-03-iso',
        ticketType: 'MCP-03',
        ticketTypeVersion: '1',
        action: 'isolate_mcp',
        resourceId: 'mcp-new-archive',
        account: 'zhou.min',
        org: '平台运营组',
        payload: {decisionRef: 'dec-iso-1'},
      },
    })
  ).json()
  assert.equal(isoRes.status, 'succeeded')
  assert.equal(isoRes.result.details.status, 'isolated')
  assert.equal(isoRes.result.details.unboundCount, 1)

  // 隔离后 binding-contexts 返回 denied
  const deniedCtx = await (await call('/binding-contexts/mcp-new-archive?workspaceId=ws-a')).json()
  assert.equal(deniedCtx.bindingAccess, 'denied')

  // 6. 目录下架（isolated -> withdrawn）
  const wdCtx = await (
    await call('/execution-contexts/MCP-03?action=withdraw_mcp&resourceId=mcp-new-archive', {account: 'zhou.min', role: 'operator'})
  ).json()
  approvedInputs.set('exec-wd-mcp', {
    decisionRef: 'dec-wd-mcp',
    ticketType: 'MCP-03',
    action: 'withdraw_mcp',
    resourceId: 'mcp-new-archive',
    fields: {'绑定清单': wdCtx.fields['绑定清单']},
    preconditions: wdCtx.preconditions,
  })
  const wdRes = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-wd-mcp',
        ticketNo: 'MCP-03-wd',
        ticketType: 'MCP-03',
        ticketTypeVersion: '1',
        action: 'withdraw_mcp',
        resourceId: 'mcp-new-archive',
        account: 'zhou.min',
        org: '平台运营组',
        payload: {decisionRef: 'dec-wd-mcp'},
      },
    })
  ).json()
  assert.equal(wdRes.status, 'succeeded')
  assert.equal(wdRes.result.details.status, 'withdrawn')
})
