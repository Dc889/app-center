import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'
import {listen, json, body} from '../../../../runtime/http.mjs'

test('accounts 模块导出结构与未配置双端上游时返回 501', async t => {
  assert.equal(capabilityModule.id, 'accounts')
  assert.equal(capabilityModule.actions.length, 2)
  assert.equal(capabilityModule.routes.length, 3)
  assert.ok(capabilityModule.catalogs.account?.list)

  const dir = await mkdtemp(join(tmpdir(), 'accounts-no-upstream-'))
  const prevDifyBase = process.env.DIFY_API_BASE
  const prevRagBase = process.env.RAGFLOW_API_BASE
  delete process.env.DIFY_API_BASE
  delete process.env.RAGFLOW_API_BASE

  const registry = createRegistry([capabilityModule], {
    actions: {'ACC-01': ['apply_account_change'], 'ACC-02': ['rename_account']},
    evidence: () => [],
  })
  const server = await startExecutionServer({dir, token: 'tok'}, registry)
  t.after(async () => {
    await server.close()
    await rm(dir, {recursive: true, force: true})
    if (prevDifyBase !== undefined) process.env.DIFY_API_BASE = prevDifyBase
    if (prevRagBase !== undefined) process.env.RAGFLOW_API_BASE = prevRagBase
  })

  const res = await fetch(`${server.url}/internal/v1/execution-contexts/ACC-01?action=apply_account_change&resourceId=subj-1`, {
    headers: {authorization: 'Bearer tok', 'x-account': 'admin-1', 'x-role': 'admin'},
  })
  assert.equal(res.status, 501)
})

test('ACC-01/ACC-02 全生命周期：开通、角色变更、改名部分失败补偿封存、重启后一致性查证与成功改名', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'accounts-lifecycle-'))
  const ragUsers = new Map()
  const difyMembers = new Map()
  let failDifyPatch = false
  let nextId = 1

  const ragServer = await listen(async (req, res, path) => {
    if (req.method === 'GET' && path === '/api/v1/system/users') {
      return json(res, {data: [...ragUsers.values()]})
    }
    if (req.method === 'POST' && path === '/api/v1/system/users') {
      const payload = await body(req)
      const user = {
        id: `rag-u-${nextId++}`,
        subjectId: payload.subjectId,
        account: payload.account,
        permission: payload.permission,
        active: payload.active ?? true,
      }
      ragUsers.set(user.id, user)
      return json(res, {data: user}, 201)
    }
    const itemMatch = /^\/api\/v1\/system\/users\/([\w-]+)$/.exec(path)
    if (itemMatch && req.method === 'PUT') {
      const existing = ragUsers.get(itemMatch[1])
      if (!existing) return json(res, {code: 'NOT_FOUND'}, 404)
      const patch = await body(req)
      const updated = {...existing, ...patch}
      ragUsers.set(existing.id, updated)
      return json(res, {data: updated})
    }
    if (itemMatch && req.method === 'DELETE') {
      ragUsers.delete(itemMatch[1])
      return json(res, {deleted: true})
    }
    return json(res, {error: 'not found'}, 404)
  })

  const difyServer = await listen(async (req, res, path) => {
    if (req.method === 'GET' && path === '/console/api/workspaces/current/members') {
      return json(res, {accounts: [...difyMembers.values()]})
    }
    if (req.method === 'POST' && path === '/console/api/workspaces/current/members') {
      const payload = await body(req)
      const member = {
        id: `dify-u-${nextId++}`,
        subjectId: payload.subjectId,
        account: payload.account,
        workspaceId: payload.workspaceId,
        role: payload.role,
        active: payload.active ?? true,
      }
      difyMembers.set(member.id, member)
      return json(res, {account: member}, 201)
    }
    const itemMatch = /^\/console\/api\/workspaces\/current\/members\/([\w-]+)$/.exec(path)
    if (itemMatch && req.method === 'PATCH') {
      if (failDifyPatch) return json(res, {code: 'DIFY_BUSY', message: 'Dify 写入失败'}, 500)
      const existing = difyMembers.get(itemMatch[1])
      if (!existing) return json(res, {code: 'NOT_FOUND'}, 404)
      const patch = await body(req)
      const updated = {...existing, ...patch}
      difyMembers.set(existing.id, updated)
      return json(res, {account: updated})
    }
    if (itemMatch && req.method === 'DELETE') {
      difyMembers.delete(itemMatch[1])
      return json(res, {deleted: true})
    }
    return json(res, {error: 'not found'}, 404)
  })

  const approvedInputs = new Map()
  const commits = new Map()
  let identityRevision = 1
  const mgmt = await listen(
    async (req, res, path) => {
      const appMatch = /^\/internal\/v1\/approved-inputs\/([\w-]+)$/.exec(path)
      if (req.method === 'GET' && appMatch && approvedInputs.has(appMatch[1])) {
        return json(res, approvedInputs.get(appMatch[1]))
      }
      const commitMatch = /^\/internal\/v1\/account-changes\/([\w-]+)\/commit$/.exec(path)
      if (req.method === 'PUT' && commitMatch) {
        const input = await body(req)
        identityRevision += 1
        const response = {subjectId: input.subjectId, revision: identityRevision, committedAt: new Date().toISOString()}
        commits.set(commitMatch[1], {input, response})
        return json(res, response)
      }
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

  const makeRegistry = () =>
    createRegistry([capabilityModule], {
      actions: {'ACC-01': ['apply_account_change'], 'ACC-02': ['rename_account']},
      evidence: () => [],
    })

  let server = await startExecutionServer({dir, token: 'tok', management: mgmt.url}, makeRegistry())
  t.after(async () => {
    await server.close()
    await ragServer.close()
    await difyServer.close()
    await mgmt.close()
    await rm(dir, {recursive: true, force: true})
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  const call = (path, {method = 'GET', payload} = {}) =>
    fetch(`${server.url}/internal/v1${path}`, {
      method,
      headers: {authorization: 'Bearer tok', 'content-type': 'application/json', 'x-account': 'admin-1', 'x-role': 'admin'},
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    })

  // 1. ACC-01 开通前上下文查询：产品账户尚不存在，recoveryBaseline 明确返回 null/false
  const ctxOpen = await (
    await call('/execution-contexts/ACC-01?action=apply_account_change&resourceId=person-chen&workspaceId=ws-1&account=chen.yu')
  ).json()
  assert.equal(ctxOpen.eligible, true)
  assert.equal(ctxOpen.fields['RAGFlow账户ID'], null)
  assert.equal(ctxOpen.fields['Dify账户ID'], null)
  assert.equal(ctxOpen.recoveryBaseline.ragflow.active, false)
  assert.equal(ctxOpen.recoveryBaseline.dify.workspaceId, 'ws-1')
  assert.equal(ctxOpen.preconditions[0].revision, 0)

  // 2. ACC-01 开通执行 + 回调管理端 commit + 更新 account 目录
  approvedInputs.set('exec-acc-open', {
    decisionRef: 'dec-open',
    ticketType: 'ACC-01',
    action: 'apply_account_change',
    resourceId: 'person-chen',
    fields: {
      操作类型: '开通',
      目标人员ID: 'person-chen',
      唯一账户名: 'chen.yu',
      RAGFlow目标权限: '团队成员',
      'Dify目标workspace角色': '编辑',
      'Dify workspace ID': 'ws-1',
    },
    preconditions: [
      {kind: 'product_account_mapping', id: 'person-chen', revision: 0},
      {kind: 'identity_mapping', id: 'person-chen', revision: 1},
    ],
  })
  const openRes = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-acc-open',
        ticketNo: 'ACC-01-open',
        ticketType: 'ACC-01',
        ticketTypeVersion: '1',
        action: 'apply_account_change',
        resourceId: 'person-chen',
        account: 'admin-1',
        org: '系统管理组',
        payload: {decisionRef: 'dec-open'},
      },
    })
  ).json()
  assert.equal(openRes.status, 'succeeded')
  assert.ok(commits.has('exec-acc-open'))

  const catalogRes = await (await call('/catalog?kind=account')).json()
  assert.equal(catalogRes.items.length, 1)
  assert.equal(catalogRes.items[0].name, 'chen.yu')
  const detailRes = await (await call('/catalog/account/person-chen')).json()
  assert.equal(detailRes.data.ragflowPermission, '团队成员')

  // 3. ACC-02 改名上下文（获取最新审批前基线）
  const ctxRename = await (
    await call('/execution-contexts/ACC-02?action=rename_account&resourceId=person-chen&workspaceId=ws-1&newAccount=chen.yu2')
  ).json()
  assert.equal(ctxRename.eligible, true)
  assert.equal(ctxRename.fields['当前账户名'], 'chen.yu')
  assert.equal(ctxRename.fields['待校验新账户名'], 'chen.yu2')
  assert.equal(ctxRename.recoveryBaseline.ragflow.permission, '团队成员')
  assert.equal(ctxRename.recoveryBaseline.dify.role, '编辑')
  assert.equal(ctxRename.preconditions[0].revision, 1)

  // 4. 模拟 ACC-02 部分失败（RAGFlow 改名成功、Dify 改名失败）-> 触发补偿与封存
  failDifyPatch = true
  approvedInputs.set('exec-acc-rename-fail', {
    decisionRef: 'dec-rename-fail',
    ticketType: 'ACC-02',
    action: 'rename_account',
    resourceId: 'person-chen',
    fields: {
      操作类型: '账户名变更',
      目标人员ID: 'person-chen',
      原账户名: 'chen.yu',
      新账户名: 'chen.yu2',
      'Dify workspace ID': 'ws-1',
    },
    preconditions: [
      {kind: 'product_account_mapping', id: 'person-chen', revision: 1},
      {kind: 'identity_mapping', id: 'person-chen', revision: 2},
    ],
  })
  const failRes = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-acc-rename-fail',
        ticketNo: 'ACC-02-fail',
        ticketType: 'ACC-02',
        ticketTypeVersion: '1',
        action: 'rename_account',
        resourceId: 'person-chen',
        account: 'admin-1',
        org: '系统管理组',
        payload: {decisionRef: 'dec-rename-fail'},
      },
    })
  ).json()
  assert.equal(failRes.status, 'failed')
  assert.equal(failRes.result.details.compensated, true)
  assert.equal(failRes.result.details.sealed, true)
  assert.equal(commits.has('exec-acc-rename-fail'), false)

  // 确认 RAGFlow 真实状态已被补偿回滚到 chen.yu
  assert.equal([...ragUsers.values()][0].account, 'chen.yu')

  // 5. 重启能力服务后，调用只读 account-consistency 接口仍可稳定核验封存恢复证明
  await server.close()
  server = await startExecutionServer({dir, token: 'tok', management: mgmt.url}, makeRegistry())

  const proofRes = await call('/executions/exec-acc-rename-fail/account-consistency')
  assert.equal(proofRes.status, 200)
  const proof = await proofRes.json()
  assert.equal(proof.executionId, 'exec-acc-rename-fail')
  assert.equal(proof.ticketNo, 'ACC-02-fail')
  assert.equal(proof.subjectId, 'person-chen')
  assert.equal(proof.identityRevision, 2)
  assert.equal(proof.productMappingRevision, 1)
  assert.equal(proof.executionStatus, 'failed')
  assert.equal(proof.sealed, true)
  assert.equal(proof.outcome, 'restored')
  assert.deepEqual(proof.products, ctxRename.recoveryBaseline)

  // 6. 恢复 Dify 正常后再次执行 ACC-02 改名成功并回调管理端 commit
  failDifyPatch = false
  approvedInputs.set('exec-acc-rename-ok', {
    decisionRef: 'dec-rename-ok',
    ticketType: 'ACC-02',
    action: 'rename_account',
    resourceId: 'person-chen',
    fields: {
      操作类型: '账户名变更',
      目标人员ID: 'person-chen',
      原账户名: 'chen.yu',
      新账户名: 'chen.yu2',
      'Dify workspace ID': 'ws-1',
    },
    preconditions: [
      {kind: 'product_account_mapping', id: 'person-chen', revision: 1},
      {kind: 'identity_mapping', id: 'person-chen', revision: 2},
    ],
  })
  const okRes = await (
    await call('/executions', {
      method: 'POST',
      payload: {
        executionId: 'exec-acc-rename-ok',
        ticketNo: 'ACC-02-ok',
        ticketType: 'ACC-02',
        ticketTypeVersion: '1',
        action: 'rename_account',
        resourceId: 'person-chen',
        account: 'admin-1',
        org: '系统管理组',
        payload: {decisionRef: 'dec-rename-ok'},
      },
    })
  ).json()
  assert.equal(okRes.status, 'succeeded')
  assert.ok(commits.has('exec-acc-rename-ok'))
  assert.equal([...ragUsers.values()][0].account, 'chen.yu2')
  assert.equal([...difyMembers.values()][0].account, 'chen.yu2')
})
