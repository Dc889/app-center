import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'
import {listen, json, body} from '../../../../runtime/http.mjs'

test('knowledge 模块导出结构、6 动作与 3 条绑定分支契约', () => {
  assert.equal(capabilityModule.id, 'knowledge')
  assert.equal(capabilityModule.actions.length, 6)
  const bind = capabilityModule.actions.find(a => a.action === 'bind_dataset')
  assert.deepEqual(bind.variants, ['RAGFlow外部知识库', 'Dify同workspace授权', 'Dify跨workspace复制'])
  assert.equal(capabilityModule.routes.length, 6)
  assert.ok(capabilityModule.resources.dify_dataset.detail)
  assert.ok(capabilityModule.resources.ragflow_dataset.detail)
  assert.ok(capabilityModule.catalogs.knowledge.list)
})

test('KB-01~KB-05：双引擎同步发布、真实协议分支与未适配分支拒绝、变更再审和文档处置', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-lifecycle-'))

  let difyDocs = [
    {id: 'doc-1', name: '刑法总则.pdf', content: 'v1-content-1'},
    {id: 'doc-2', name: '刑事诉讼法.pdf', content: 'v1-content-2'},
  ]
  const ragDocs = [{id: 'rdoc-1', name: '警务研判指南.pdf', content: 'rag-v1'}]
  const calls = {
    externalApi: 0,
    externalDataset: 0,
    sameWsGrant: 0,
    crossWsCopy: 0,
    difyDisableDocs: [],
    difyRevokes: [],
    ragDisableDocs: [],
  }

  const difyServer = await listen(async (req, res, path) => {
    if (req.method === 'GET' && path === '/console/api/datasets') {
      return json(res, {
        data: [{id: 'dify-ds-1', name: '法规知识库', workspace_id: 'ws-a', owner_account: 'chen.yu'}],
      })
    }
    if (req.method === 'GET' && path === '/console/api/datasets/dify-ds-1') {
      return json(res, {id: 'dify-ds-1', name: '法规知识库', workspace_id: 'ws-a', owner_account: 'chen.yu', model_verified: true})
    }
    if (req.method === 'GET' && path === '/console/api/datasets/dify-ds-1/documents') {
      return json(res, {data: difyDocs})
    }
    if (req.method === 'POST' && path === '/console/api/datasets/external-knowledge-api') {
      const payload = await body(req)
      assert.equal(payload.settings.api_key, 'rag-tok')
      assert.ok(payload.settings.endpoint.endsWith('/api/v1/dify'))
      calls.externalApi += 1
      return json(res, {id: 'ext-api-1'}, 201)
    }
    if (req.method === 'POST' && path === '/console/api/datasets/external') {
      const payload = await body(req)
      assert.equal(payload.external_knowledge_api_id, 'ext-api-1')
      assert.equal(payload.external_knowledge_id, 'rag-ds-1')
      calls.externalDataset += 1
      return json(res, {id: 'ext-ds-1'}, 201)
    }
    if (req.method === 'PATCH' && path === '/console/api/datasets/dify-ds-1') {
      calls.sameWsGrant += 1
      return json(res, {id: 'dify-ds-1'})
    }
    if (req.method === 'POST' && path === '/console/api/datasets') {
      calls.crossWsCopy += 1
      return json(res, {id: 'dify-replica-1'}, 201)
    }
    if (req.method === 'PATCH' && path === '/console/api/datasets/dify-ds-1/documents/status/disable/batch') {
      const ids = new URL(req.url, 'http://localhost').searchParams.getAll('document_id')
      assert.equal(ids.length, 1)
      calls.difyDisableDocs.push(...ids)
      return json(res, {result: 'success'})
    }
    const revokeMatch = /^\/console\/api\/datasets\/([\w-]+)\/revoke$/.exec(path)
    if (req.method === 'POST' && revokeMatch) {
      calls.difyRevokes.push(await body(req))
      return json(res, {revoked: true})
    }
    return json(res, {error: 'not found'}, 404)
  })

  const ragServer = await listen(async (req, res, path) => {
    if (req.method === 'GET' && path === '/api/v1/datasets') {
      return json(res, {
        data: [{id: 'rag-ds-1', name: '警务研判库', tenant_id: 'tenant-1', owner_account: 'chen.yu'}],
      })
    }
    if (req.method === 'GET' && path === '/api/v1/datasets/rag-ds-1') {
      return json(res, {
        data: {id: 'rag-ds-1', name: '警务研判库', tenant_id: 'tenant-1', owner_account: 'chen.yu', model_verified: true},
      })
    }
    if (req.method === 'GET' && path === '/api/v1/datasets/rag-ds-1/documents') {
      return json(res, {data: {docs: ragDocs}})
    }
    const disableMatch = /^\/api\/v1\/datasets\/([\w-]+)\/documents\/([\w-]+)$/.exec(path)
    if (req.method === 'PUT' && disableMatch) {
      assert.deepEqual(await body(req), {enabled: false})
      calls.ragDisableDocs.push(disableMatch[2])
      return json(res, {disabled: true})
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

  const prevEnv = {
    DIFY_API_BASE: process.env.DIFY_API_BASE,
    DIFY_CONSOLE_TOKEN: process.env.DIFY_CONSOLE_TOKEN,
    RAGFLOW_API_BASE: process.env.RAGFLOW_API_BASE,
    RAGFLOW_API_KEY: process.env.RAGFLOW_API_KEY,
  }
  process.env.DIFY_API_BASE = difyServer.url
  process.env.DIFY_CONSOLE_TOKEN = 'dify-tok'
  process.env.RAGFLOW_API_BASE = ragServer.url
  process.env.RAGFLOW_API_KEY = 'rag-tok'

  const registry = createRegistry([capabilityModule], {
    actions: {
      'KB-01': ['sync_dataset'],
      'KB-02': ['publish_dataset'],
      'KB-03': ['bind_dataset'],
      'KB-04': ['review_dataset_changes'],
      'KB-05': ['pause_share', 'dispose_dataset'],
    },
    evidence: () => [],
  })
  const server = await startExecutionServer({dir, token: 'tok', management: mgmt.url}, registry)
  t.after(async () => {
    await server.close()
    await difyServer.close()
    await ragServer.close()
    await mgmt.close()
    await rm(dir, {recursive: true, force: true})
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  const call = (path, {method = 'GET', payload, account = 'chen.yu', role = 'operator', org = '法制支队'} = {}) =>
    fetch(`${server.url}/internal/v1${path}`, {
      method,
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
        'x-account': account,
        'x-role': role,
        'x-org': encodeURIComponent(org),
      },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    })

  // 1. 双引擎资源发现（list + detail）
  const difyDetail = await (await call('/resources/dify_dataset/dify-ds-1?workspaceId=ws-a')).json()
  assert.equal(difyDetail.workspaceId, 'ws-a')
  assert.equal(difyDetail.data.ownerAccount, 'chen.yu')
  const ragDetail = await (await call('/resources/ragflow_dataset/rag-ds-1')).json()
  assert.equal(ragDetail.workspaceId, null)
  assert.equal(ragDetail.data.tenantId, 'tenant-1')

  // 2. KB-01 同步 Dify 与 RAGFlow 知识库入台账
  approvedInputs.set('exec-kb01-dify', {
    decisionRef: 'dec-kb01-dify',
    ticketType: 'KB-01',
    action: 'sync_dataset',
    resourceId: 'dify-ds-1',
    fields: {来源系统: 'Dify', '所属workspace/tenant ID': 'ws-a', 所有者账户名: 'chen.yu'},
    preconditions: [],
  })
  const syncDify = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-kb01-dify',
        ticketNo: 'KB-01-dify',
        ticketType: 'KB-01',
        ticketTypeVersion: '1',
        action: 'sync_dataset',
        resourceId: 'dify-ds-1',
        account: 'chen.yu',
        org: '法制支队',
        payload: {decisionRef: 'dec-kb01-dify'},
      },
    })
  ).json()
  assert.equal(syncDify.status, 'succeeded')
  const difyCatalogId = syncDify.result.resultId

  approvedInputs.set('exec-kb01-rag', {
    decisionRef: 'dec-kb01-rag',
    ticketType: 'KB-01',
    action: 'sync_dataset',
    resourceId: 'rag-ds-1',
    fields: {来源系统: 'RAGFlow', '所属workspace/tenant ID': 'tenant-1', 所有者账户名: 'chen.yu'},
    preconditions: [],
  })
  const syncRag = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-kb01-rag',
        ticketNo: 'KB-01-rag',
        ticketType: 'KB-01',
        ticketTypeVersion: '1',
        action: 'sync_dataset',
        resourceId: 'rag-ds-1',
        account: 'chen.yu',
        org: '法制支队',
        payload: {decisionRef: 'dec-kb01-rag'},
      },
    })
  ).json()
  assert.equal(syncRag.status, 'succeeded')
  const ragCatalogId = syncRag.result.resultId

  const catalogList = await (await call('/catalog?kind=knowledge')).json()
  assert.equal(catalogList.items.length, 2)

  // 3. KB-02 上下文与发布（Dify 知识库）
  const kb02Ctx = await (await call(`/execution-contexts/KB-02?action=publish_dataset&resourceId=${difyCatalogId}`)).json()
  assert.equal(kb02Ctx.eligible, true)
  assert.equal(kb02Ctx.fields['文档数'], 2)
  assert.equal(kb02Ctx.fields['模型目录核对结果'], '一致')

  approvedInputs.set('exec-kb02-1', {
    decisionRef: 'dec-kb02-1',
    ticketType: 'KB-02',
    action: 'publish_dataset',
    resourceId: difyCatalogId,
    fields: {
      分享方式: '共享目录',
      目录展示名称: '法规标准知识库',
      组织边界: ['法制支队', '刑侦支队'],
      密级: '内部',
      业务线: '法制研判',
      policyRef: 'policy-law-1',
    },
    preconditions: kb02Ctx.preconditions,
  })
  const pubRes = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-kb02-1',
        ticketNo: 'KB-02-1',
        ticketType: 'KB-02',
        ticketTypeVersion: '1',
        action: 'publish_dataset',
        resourceId: difyCatalogId,
        account: 'chen.yu',
        org: '法制支队',
        payload: {decisionRef: 'dec-kb02-1'},
      },
    })
  ).json()
  assert.equal(pubRes.status, 'succeeded')

  // 4. KB-03 候选与三条独立绑定分支全覆盖
  const kb03Cands = await (await call('/execution-contexts/KB-03/candidates?action=bind_dataset&workspaceId=ws-a&permission=' + encodeURIComponent('检索使用'))).json()
  assert.equal(kb03Cands.items.length, 2)

  // 4a. 分支 1：RAGFlow外部知识库
  const ctxRagBind = await (
    await call(`/execution-contexts/KB-03?action=bind_dataset&resourceId=${ragCatalogId}&workspaceId=ws-a&permission=` + encodeURIComponent('检索使用'))
  ).json()
  assert.equal(ctxRagBind.fields['实现方式'], 'RAGFlow外部知识库')
  assert.ok(ctxRagBind.fields['外部知识库API地址'].endsWith('/api/v1/dify'))
  approvedInputs.set('exec-kb03-rag', {
    decisionRef: 'dec-kb03-rag',
    ticketType: 'KB-03',
    action: 'bind_dataset',
    resourceId: ragCatalogId,
    fields: {
      '目标Dify workspace ID': 'ws-a',
      实现方式: 'RAGFlow外部知识库',
      申请权限: '检索使用',
      获批使用者账户名: 'chen.yu',
      目标智能体ID: 'app-1',
      外部知识库API地址: ctxRagBind.fields['外部知识库API地址'],
    },
    preconditions: ctxRagBind.preconditions,
  })
  const bindRagRes = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-kb03-rag',
        ticketNo: 'KB-03-rag',
        ticketType: 'KB-03',
        ticketTypeVersion: '1',
        action: 'bind_dataset',
        resourceId: ragCatalogId,
        account: 'chen.yu',
        org: '法制支队',
        payload: {decisionRef: 'dec-kb03-rag'},
      },
    })
  ).json()
  assert.equal(bindRagRes.status, 'succeeded')
  assert.equal(calls.externalApi, 1)
  assert.equal(calls.externalDataset, 1)

  // 4b. 分支 2：Dify同workspace授权
  const ctxSameWs = await (
    await call(`/execution-contexts/KB-03?action=bind_dataset&resourceId=${difyCatalogId}&workspaceId=ws-a&permission=` + encodeURIComponent('编排绑定'))
  ).json()
  assert.equal(ctxSameWs.fields['实现方式'], 'Dify同workspace授权')
  approvedInputs.set('exec-kb03-same', {
    decisionRef: 'dec-kb03-same',
    ticketType: 'KB-03',
    action: 'bind_dataset',
    resourceId: difyCatalogId,
    fields: {
      '目标Dify workspace ID': 'ws-a',
      实现方式: 'Dify同workspace授权',
      申请权限: '编排绑定',
      获批使用者账户名: 'li.lei',
      目标智能体ID: 'app-2',
    },
    preconditions: ctxSameWs.preconditions,
  })
  const bindSameRes = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-kb03-same',
        ticketNo: 'KB-03-same',
        ticketType: 'KB-03',
        ticketTypeVersion: '1',
        action: 'bind_dataset',
        resourceId: difyCatalogId,
        account: 'li.lei',
        org: '刑侦支队',
        payload: {decisionRef: 'dec-kb03-same'},
      },
    })
  ).json()
  assert.equal(bindSameRes.status, 'failed')
  assert.equal(bindSameRes.result.failureCode, 'UPSTREAM_UNSUPPORTED')
  assert.equal(calls.sameWsGrant, 0)

  // 4c. 分支 3：Dify跨workspace复制
  const ctxCrossWs = await (
    await call(`/execution-contexts/KB-03?action=bind_dataset&resourceId=${difyCatalogId}&workspaceId=ws-b&permission=` + encodeURIComponent('检索使用'))
  ).json()
  assert.equal(ctxCrossWs.fields['实现方式'], 'Dify跨workspace复制')
  assert.match(ctxCrossWs.fields['源文档版本指纹'], /^[a-f0-9]{64}$/)
  approvedInputs.set('exec-kb03-cross', {
    decisionRef: 'dec-kb03-cross',
    ticketType: 'KB-03',
    action: 'bind_dataset',
    resourceId: difyCatalogId,
    fields: {
      '目标Dify workspace ID': 'ws-b',
      实现方式: 'Dify跨workspace复制',
      申请权限: '检索使用',
      获批使用者账户名: 'li.lei',
      目标智能体ID: 'app-3',
    },
    preconditions: ctxCrossWs.preconditions,
  })
  const bindCrossRes = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-kb03-cross',
        ticketNo: 'KB-03-cross',
        ticketType: 'KB-03',
        ticketTypeVersion: '1',
        action: 'bind_dataset',
        resourceId: difyCatalogId,
        account: 'li.lei',
        org: '刑侦支队',
        payload: {decisionRef: 'dec-kb03-cross'},
      },
    })
  ).json()
  assert.equal(bindCrossRes.status, 'failed')
  assert.equal(bindCrossRes.result.failureCode, 'UPSTREAM_UNSUPPORTED')
  assert.equal(calls.crossWsCopy, 0)

  // 5. KB-04 变更检测上下文与 review_dataset_changes
  difyDocs = [
    {id: 'doc-1', name: '刑法总则.pdf', content: 'v2-updated-content-1'},
    {id: 'doc-3', name: '治安管理处罚法.pdf', content: 'v1-new-doc'},
  ]
  const kb04Ctx = await (
    await call(`/execution-contexts/KB-04?action=review_dataset_changes&resourceId=${difyCatalogId}&sourceEventId=chg-evt-1`)
  ).json()
  assert.equal(kb04Ctx.fields['新增文档数'], 1)
  assert.equal(kb04Ctx.fields['变更文档数'], 1)
  assert.equal(kb04Ctx.fields['删除文档数'], 1)
  assert.notEqual(kb04Ctx.fields['处置证据事件ID'], kb04Ctx.fields['人工处置证据事件ID'])

  approvedInputs.set('exec-kb04-1', {
    decisionRef: 'dec-kb04-1',
    ticketType: 'KB-04',
    action: 'review_dataset_changes',
    resourceId: difyCatalogId,
    fields: {运维确认结论: '通过', 新目录状态: '保持发布'},
    preconditions: kb04Ctx.preconditions,
  })
  const reviewRes = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-kb04-1',
        ticketNo: 'KB-04-1',
        ticketType: 'KB-04',
        ticketTypeVersion: '1',
        action: 'review_dataset_changes',
        resourceId: difyCatalogId,
        account: 'op-1',
        org: '平台运营组',
        payload: {decisionRef: 'dec-kb04-1'},
      },
    })
  ).json()
  assert.equal(reviewRes.status, 'succeeded')
  assert.equal(reviewRes.result.details.values['新目录状态'], '保持发布')

  // 6. KB-05 告警暂停分享（普通账号冒充 system_event 必须被拦截，真实 system_event 通过）与最终处置
  const spoofAlert = await call(
    `/execution-contexts/KB-05?action=pause_share&resourceId=${difyCatalogId}&sourceEventId=${kb04Ctx.fields['处置证据事件ID']}`,
    {account: 'chen.yu'},
  )
  assert.equal(spoofAlert.status, 403)

  const pauseCtx = await (
    await call(
      `/execution-contexts/KB-05?action=pause_share&resourceId=${difyCatalogId}&sourceEventId=${kb04Ctx.fields['处置证据事件ID']}`,
      {account: 'system_event'},
    )
  ).json()
  assert.equal(pauseCtx.fields['清单完整'], true)
  assert.equal(pauseCtx.fields['影响中的授权数'], 0)
  assert.equal(pauseCtx.fields['影响中的智能体数'], 0)
  assert.equal(pauseCtx.fields['告警证据'].length, 1)

  approvedInputs.set('exec-kb05-pause', {
    decisionRef: 'dec-kb05-pause',
    ticketType: 'KB-05',
    action: 'pause_share',
    resourceId: difyCatalogId,
    fields: {处置原因: '内容违规', 告警ID: kb04Ctx.fields['处置证据事件ID']},
    preconditions: pauseCtx.preconditions,
  })
  const pauseRes = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-kb05-pause',
        ticketNo: 'KB-05-pause',
        ticketType: 'KB-05',
        ticketTypeVersion: '1',
        action: 'pause_share',
        resourceId: difyCatalogId,
        account: 'system_event',
        org: '系统服务',
        payload: {decisionRef: 'dec-kb05-pause'},
      },
    })
  ).json()
  assert.equal(pauseRes.status, 'succeeded')

  // 暂停后再读新修订执行 dispose_dataset（停用文档 + 撤销未到期授权 + 目录下架）
  const kb05Cands = await (await call('/execution-contexts/KB-05/candidates?action=dispose_dataset')).json()
  assert.equal(kb05Cands.items.length, 2)

  const dispCtx = await (await call(`/execution-contexts/KB-05?action=dispose_dataset&resourceId=${difyCatalogId}`)).json()
  assert.ok(dispCtx.preconditions.find(p => p.kind === 'dataset').revision > pauseCtx.preconditions.find(p => p.kind === 'dataset').revision)

  approvedInputs.set('exec-kb05-dispose', {
    decisionRef: 'dec-kb05-dispose',
    ticketType: 'KB-05',
    action: 'dispose_dataset',
    resourceId: difyCatalogId,
    fields: {
      处置原因: '内容违规',
      处置动作: ['目录下架', '撤销未到期授权', '停用文档'],
      API执行对象清单: dispCtx.fields['处置目标清单'].filter(t => t.action !== '暂停分享'),
    },
    preconditions: dispCtx.preconditions,
  })
  const dispRes = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-kb05-dispose',
        ticketNo: 'KB-05-dispose',
        ticketType: 'KB-05',
        ticketTypeVersion: '1',
        action: 'dispose_dataset',
        resourceId: difyCatalogId,
        account: 'op-1',
        org: '平台运营组',
        payload: {decisionRef: 'dec-kb05-dispose'},
      },
    })
  ).json()
  assert.equal(dispRes.status, 'succeeded')
  assert.equal(dispRes.result.details['新状态'], '已下架')
  assert.equal(calls.difyRevokes.length, 0)
  assert.deepEqual(calls.difyDisableDocs.sort(), ['doc-1', 'doc-3'])
})
