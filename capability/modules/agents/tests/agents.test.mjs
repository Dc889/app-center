import {seedRepositoryFixtures} from '../../../../tests/fixtures/repository-data.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'
import {startAgent} from '../../../repositories/agent/public.mjs'
import {listen, json} from '../../../../runtime/http.mjs'

test('agents 模块导出结构契约、动作与全部动态路由登记', () => {
  assert.equal(capabilityModule.id, 'agents')
  assert.equal(capabilityModule.actions.length, 5)
  for (const act of ['sync_app', 'publish', 'grant_app_access', 'republish', 'withdraw_app']) {
    const entry = capabilityModule.actions.find(a => a.action === act)
    assert.ok(entry)
    assert.notEqual(entry.ready, false)
    assert.equal(typeof entry.execute, 'function')
  }
  assert.equal(typeof capabilityModule.resources.dify_app.list, 'function')
  assert.equal(typeof capabilityModule.resources.dify_app.detail, 'function')
  assert.equal(typeof capabilityModule.catalogs.agent.versions, 'function')
})

test('agents 未配置 Dify 环境时 sync_app 与 withdraw_app 抛出 501 UPSTREAM_UNSUPPORTED', async () => {
  const prevBase = process.env.DIFY_API_BASE
  const prevToken = process.env.DIFY_CONSOLE_TOKEN
  delete process.env.DIFY_API_BASE
  delete process.env.DIFY_CONSOLE_TOKEN
  try {
    for (const act of ['sync_app', 'withdraw_app']) {
      const action = capabilityModule.actions.find(a => a.action === act)
      await assert.rejects(
        async () => action.execute({command: {executionId: 'e', resourceId: 'app-1', payload: {decisionRef: 'd'}}, state: {status: 'queued'}}),
        err => err.status === 501 && err.code === 'UPSTREAM_UNSUPPORTED',
      )
    }
  } finally {
    if (prevBase !== undefined) process.env.DIFY_API_BASE = prevBase
    if (prevToken !== undefined) process.env.DIFY_CONSOLE_TOKEN = prevToken
  }
})

test('AG-01~05 全生命周期：纳管、目标应用、发布、授权、影响分析、再发布、替代目录与下架', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'agents-lifecycle-'))
  seedRepositoryFixtures(dir)
  const agentRepo = await startAgent({dir, token: 'tok'})
  const difyServer = await listen((req, res, path) => {
    if (path === '/console/api/apps' || path.startsWith('/console/api/apps?')) {
      return json(res, {
        data: [
          {id: 'dify-app-a', name: '智能研判 A', mode: 'workflow', workspace_id: 'ws-a'},
          {id: 'dify-app-b', name: '通用问答 B', mode: 'chat', workspace_id: 'ws-a'},
        ],
      })
    }
    if (path === '/console/api/apps/dify-app-a') {
      return json(res, {id: 'dify-app-a', name: '智能研判 A', mode: 'workflow'})
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

  const registry = createRegistry([capabilityModule], {
    actions: {
      'AG-01': ['sync_app'],
      'AG-02': ['publish'],
      'AG-03': ['grant_app_access'],
      'AG-04': ['republish'],
      'AG-05': ['withdraw_app'],
    },
    evidence: () => [],
  })
  const server = await startExecutionServer({dir, token: 'tok', agent: agentRepo.url, management: mgmt.url}, registry)
  t.after(async () => {
    await server.close()
    await agentRepo.close()
    await difyServer.close()
    await mgmt.close()
    await rm(dir, {recursive: true, force: true})
    if (prevBase === undefined) delete process.env.DIFY_API_BASE
    else process.env.DIFY_API_BASE = prevBase
    if (prevToken === undefined) delete process.env.DIFY_CONSOLE_TOKEN
    else process.env.DIFY_CONSOLE_TOKEN = prevToken
  })

  const call = (path, {method = 'GET', body, account = 'chen.yu', role = 'operator', org = '业务一部'} = {}) =>
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

  // 1. CAP-AGT-05: AG-01 纳管同步
  approvedInputs.set('exec-ag01', {
    decisionRef: 'dec-ag01',
    ticketType: 'AG-01',
    action: 'sync_app',
    resourceId: 'dify-app-a',
    fields: {'Dify workspace ID': 'ws-a'},
    preconditions: [],
  })
  const syncRes = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-ag01',
        ticketNo: 'AG-01-a',
        ticketType: 'AG-01',
        ticketTypeVersion: '1',
        action: 'sync_app',
        resourceId: 'dify-app-a',
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-ag01'},
      },
    })
  ).json()
  assert.equal(syncRes.status, 'succeeded')
  assert.equal(syncRes.result.details.name, '智能研判 A')

  // 2. CAP-AGT-03: application-targets 列表与详情
  const targets = await (await call('/application-targets?purpose=dataset_binding&workspaceId=ws-a')).json()
  assert.ok(targets.items.some(a => a.appId === 'dify-app-a'))
  const targetDetail = await (await call('/application-targets/dify-app-a?purpose=mcp_binding&workspaceId=ws-a')).json()
  assert.equal(targetDetail.eligible, true)
  assert.equal(targetDetail.purpose, 'mcp_binding')
  assert.ok(targetDetail.targetRef)

  // 3. CAP-AGT-06: AG-02 发布两个智能体目录（cat-a 与替代 cat-b）
  for (const [id, appId, scope, orgs] of [
    ['cat-a', 'dify-app-a', 'org', ['业务一部']],
    ['cat-b', 'dify-app-b', 'public', []],
  ]) {
    const pubRes = await (
      await call('/executions', {
        method: 'POST',
        body: {
          executionId: `exec-pub-${id}`,
          ticketNo: `AG-02-${id}`,
          ticketType: 'AG-02',
          ticketTypeVersion: '1',
          action: 'publish',
          resourceId: id,
          account: 'chen.yu',
          org: '业务一部',
          payload: {
            appId,
            snapshotId: `wf-${id}-1`,
            workspaceId: 'ws-a',
            publicationVersionId: `pub-${id}-v1`,
            scope,
            expectedRevision: 0,
            targetOrgs: orgs,
            targetAccounts: [],
            boundaryOrgs: orgs,
            usages: ['web'],
          },
        },
      })
    ).json()
    assert.equal(pubRes.status, 'succeeded')
  }

  // 4. CAP-AGT-07: AG-03 应用授权
  approvedInputs.set('exec-grant-a', {
    decisionRef: 'dec-grant-a',
    ticketType: 'AG-03',
    action: 'grant_app_access',
    resourceId: 'cat-a',
    fields: {'目标人员': ['chen.yu'], '目标组织': ['业务一部']},
    preconditions: [],
  })
  const grantRes = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-grant-a',
        ticketNo: 'AG-03-a',
        ticketType: 'AG-03',
        ticketTypeVersion: '1',
        action: 'grant_app_access',
        resourceId: 'cat-a',
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-grant-a'},
      },
    })
  ).json()
  assert.equal(grantRes.status, 'succeeded')
  assert.equal(grantRes.result.details.grantCount, 2)

  // 5. CAP-AGT-02: resources/dify_app/:id 带 catalogResourceId 返回真实 agentImpact（calls30d 未采集标 unavailable 不伪造 0）
  const appDetail = await (await call('/resources/dify_app/dify-app-a?workspaceId=ws-a&catalogResourceId=cat-a')).json()
  assert.equal(appDetail.data.agentImpact.grants.state, 'collected')
  assert.equal(appDetail.data.agentImpact.grants.count, 2)
  assert.equal(appDetail.data.agentImpact.grants.revision, 1)
  assert.equal(appDetail.data.agentImpact.calls30d.state, 'unavailable')
  assert.equal(appDetail.data.agentImpact.calls30d.count, null)

  // 6. CAP-AGT-06: AG-04 变更再发布 + versions 查询
  approvedInputs.set('exec-repub-a', {
    decisionRef: 'dec-repub-a',
    ticketType: 'AG-04',
    action: 'republish',
    resourceId: 'cat-a',
    fields: {publicationVersionId: 'pub-cat-a-v2', workflowSnapshotId: 'wf-cat-a-2'},
    preconditions: [{kind: 'agent', id: 'cat-a', revision: 1}],
  })
  const repubRes = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-repub-a',
        ticketNo: 'AG-04-a',
        ticketType: 'AG-04',
        ticketTypeVersion: '1',
        action: 'republish',
        resourceId: 'cat-a',
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-repub-a'},
      },
    })
  ).json()
  assert.equal(repubRes.status, 'succeeded')
  assert.equal(repubRes.result.details.revision, 2)
  const versions = await (await call('/catalog/agent/cat-a/versions')).json()
  assert.equal(versions.versions.length, 2)

  // 7. CAP-AGT-04: agent-replacements 排除自身且受众兼容 cat-b
  const replPage = await (await call('/agent-replacements?sourceResourceId=cat-a')).json()
  assert.ok(replPage.items.some(r => r.resourceId === 'cat-b'))
  assert.ok(!replPage.items.some(r => r.resourceId === 'cat-a'))
  const replDetail = await (await call('/agent-replacements/cat-b?sourceResourceId=cat-a')).json()
  assert.equal(replDetail.eligible, true)
  assert.equal(replDetail.audienceCompatible, true)
  assert.equal(replDetail.sourceResourceId, 'cat-a')

  // 8. CAP-AGT-08: AG-05 下架（授权修订漂移被拒；修订一致则成功下架并撤销 2 项授权）
  approvedInputs.set('exec-wd-stale', {
    decisionRef: 'dec-wd-stale',
    ticketType: 'AG-05',
    action: 'withdraw_app',
    resourceId: 'cat-a',
    fields: {},
    preconditions: [
      {kind: 'agent', id: 'cat-a', revision: 2},
      {kind: 'agent_grants', id: 'cat-a', revision: 99},
    ],
  })
  const staleWd = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-wd-stale',
        ticketNo: 'AG-05-stale',
        ticketType: 'AG-05',
        ticketTypeVersion: '1',
        action: 'withdraw_app',
        resourceId: 'cat-a',
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-wd-stale'},
      },
    })
  ).json()
  assert.equal(staleWd.status, 'failed')
  assert.equal(staleWd.result.failureCode, 'STALE_SNAPSHOT')

  approvedInputs.set('exec-wd-ok', {
    decisionRef: 'dec-wd-ok',
    ticketType: 'AG-05',
    action: 'withdraw_app',
    resourceId: 'cat-a',
    fields: {'替代目录ID': 'cat-b'},
    preconditions: [
      {kind: 'agent', id: 'cat-a', revision: 2},
      {kind: 'agent_grants', id: 'cat-a', revision: 1},
      {kind: 'agent_replacement', id: 'cat-b', revision: 1},
    ],
  })
  const okWd = await (
    await call('/executions', {
      method: 'POST',
      body: {
        executionId: 'exec-wd-ok',
        ticketNo: 'AG-05-ok',
        ticketType: 'AG-05',
        ticketTypeVersion: '1',
        action: 'withdraw_app',
        resourceId: 'cat-a',
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-wd-ok'},
      },
    })
  ).json()
  assert.equal(okWd.status, 'succeeded')
  assert.equal(okWd.result.details.status, '已下架')
  assert.equal(okWd.result.details.revokedGrants, 2)
  assert.equal(okWd.result.details.replacementResourceId, 'cat-b')
})
