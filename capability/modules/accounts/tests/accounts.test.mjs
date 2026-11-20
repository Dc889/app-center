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
  let ignoreDifyPatch = false, loseCommitResponse = false, productWrites = 0, commitWrites = 0
  let nextId = 1

  const ragServer = await listen(async (req, res, path) => {
    if (req.method === 'GET' && path === '/api/v1/system/users') {
      return json(res, {code: 0, data: [...ragUsers.values()]})
    }
    if (req.method === 'POST' && path === '/api/v1/system/users') {
      productWrites++
      const payload = await body(req)
      const user = {
        id: `rag-u-${nextId++}`,
        subjectId: payload.subjectId,
        account: payload.account,
        permission: payload.permission,
        active: payload.active ?? true,
      }
      ragUsers.set(user.id, user)
      return json(res, {code: 0, data: user}, 201)
    }
    const itemMatch = /^\/api\/v1\/system\/users\/([\w-]+)$/.exec(path)
    if (itemMatch && req.method === 'PUT') {
      productWrites++
      const existing = ragUsers.get(itemMatch[1])
      if (!existing) return json(res, {code: 'NOT_FOUND'}, 404)
      const patch = await body(req)
      const updated = {...existing, ...patch}
      ragUsers.set(existing.id, updated)
      return json(res, {code: 0, data: updated})
    }
    if (itemMatch && req.method === 'DELETE') {
      ragUsers.delete(itemMatch[1])
      return json(res, {code: 0, deleted: true})
    }
    return json(res, {error: 'not found'}, 404)
  })

  const difyServer = await listen(async (req, res, path) => {
    if (req.method === 'GET' && path === '/console/api/workspaces/current') return json(res, {id: 'ws-1'})
    if (req.method === 'GET' && path === '/console/api/workspaces/current/members') {
      return json(res, {accounts: [...difyMembers.values()]})
    }
    if (req.method === 'POST' && path === '/console/api/workspaces/current/members') {
      productWrites++
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
      productWrites++
      if (failDifyPatch) return json(res, {code: 'DIFY_REJECTED', message: '明确拒绝本次写入'}, 409)
      const existing = difyMembers.get(itemMatch[1])
      if (!existing) return json(res, {code: 'NOT_FOUND'}, 404)
      const patch = await body(req)
      const updated = ignoreDifyPatch ? existing : {...existing, ...patch}
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
      if (path === '/internal/v1/subjects/person-chen') return json(res, {subjectId: 'person-chen', account: 'chen.yu', revision: identityRevision})
      const appMatch = /^\/internal\/v1\/approved-inputs\/([\w-]+)$/.exec(path)
      if (req.method === 'GET' && appMatch && approvedInputs.has(appMatch[1])) {
        return json(res, approvedInputs.get(appMatch[1]))
      }
      const commitMatch = /^\/internal\/v1\/account-changes\/([\w-]+)\/commit$/.exec(path)
      if (req.method === 'GET' && commitMatch) {
        const saved = commits.get(commitMatch[1])
        return saved ? json(res, {executionId: commitMatch[1], request: saved.input, response: saved.response}) : json(res, {error: {code: 'NOT_FOUND'}}, 404)
      }
      if (req.method === 'PUT' && commitMatch) {
        commitWrites++
        const input = await body(req)
        identityRevision += 1
        const response = {subjectId: input.subjectId, revision: identityRevision, committedAt: new Date().toISOString()}
        commits.set(commitMatch[1], {input, response})
        if (loseCommitResponse) return json(res, {error: {code: 'RESPONSE_LOST'}}, 503)
        return json(res, response)
      }
      return json(res, {error: {code: 'NOT_FOUND'}}, 404)
    },
    {token: 'tok'},
  )

  const prevEnv = {
    DIFY_API_BASE: process.env.DIFY_API_BASE,
    DIFY_CONSOLE_TOKEN: process.env.DIFY_CONSOLE_TOKEN,
    DIFY_WORKSPACE_ID: process.env.DIFY_WORKSPACE_ID,
    RAGFLOW_API_BASE: process.env.RAGFLOW_API_BASE,
    RAGFLOW_API_KEY: process.env.RAGFLOW_API_KEY,
  }
  process.env.DIFY_API_BASE = difyServer.url
  process.env.DIFY_CONSOLE_TOKEN = 'dify-tok'
  process.env.DIFY_WORKSPACE_ID = 'ws-1'
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
    recoveryBaseline: ctxOpen.recoveryBaseline,
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
    recoveryBaseline: ctxRename.recoveryBaseline,
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
    recoveryBaseline: ctxRename.recoveryBaseline,
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

  // A successful HTTP acknowledgement without the requested effect cannot commit platform identity.
  const change = executionId => ({executionId, ticketNo: 'ACC-01-' + executionId, ticketType: 'ACC-01', ticketTypeVersion: '1',
    action: 'apply_account_change', resourceId: 'person-chen', account: 'admin-1', org: '系统管理组', payload: {decisionRef: 'dec-' + executionId}})
  const approval = executionId => ({recoveryBaseline: {ragflow: {accountId: [...ragUsers.values()][0].id, account: 'chen.yu2', active: true, permission: '团队成员'}, dify: {accountId: [...difyMembers.values()][0].id, workspaceId: 'ws-1', account: 'chen.yu2', active: true, role: '编辑'}}, decisionRef: 'dec-' + executionId, ticketType: 'ACC-01', action: 'apply_account_change', resourceId: 'person-chen',
    fields: {操作类型: '角色变更', 目标人员ID: 'person-chen', 唯一账户名: 'chen.yu2', RAGFlow目标权限: '管理员', 'Dify目标workspace角色': '管理员', 'Dify workspace ID': 'ws-1'},
    preconditions: [{kind: 'product_account_mapping', id: 'person-chen', revision: 2}, {kind: 'identity_mapping', id: 'person-chen', revision: 3}]})
  const stale = approval('stale-approved')
  stale.recoveryBaseline.ragflow.permission = '个人'
  approvedInputs.set('stale-approved', stale)
  const beforeStaleWrites = productWrites
  const staleResult = await (await call('/executions', {method: 'POST', payload: change('stale-approved')})).json()
  assert.equal(staleResult.status, 'failed'); assert.equal(staleResult.result.failureCode, 'STALE_ACCOUNT_BASELINE')
  assert.equal(productWrites, beforeStaleWrites); assert.equal(commits.has('stale-approved'), false)
  ignoreDifyPatch = true
  approvedInputs.set('readback-fail', approval('readback-fail'))
  const mismatch = await (await call('/executions', {method: 'POST', payload: change('readback-fail')})).json()
  assert.equal(mismatch.status, 'failed')
  assert.equal(mismatch.result.failureCode, 'ACCOUNT_WRITE_READBACK_MISMATCH')
  assert.equal(commits.has('readback-fail'), false)
  assert.equal([...ragUsers.values()][0].permission, 'team')
  assert.equal([...difyMembers.values()][0].role, 'editor')

  // Commit happened but its reply was lost: restart, GET original proof, never repeat product or commit writes.
  ignoreDifyPatch = false; loseCommitResponse = true
  approvedInputs.set('commit-lost', approval('commit-lost'))
  const pending = await (await call('/executions', {method: 'POST', payload: change('commit-lost')})).json()
  assert.equal(pending.status, 'reconciling'); assert.equal(pending.result, null)
  assert.ok(commits.has('commit-lost'))
  const beforeProductWrites = productWrites, beforeCommitWrites = commitWrites
  await server.close()
  server = await startExecutionServer({dir, token: 'tok', management: mgmt.url}, makeRegistry())
  const recovered = await (await call('/executions/commit-lost')).json()
  assert.equal(recovered.status, 'succeeded')
  assert.equal(recovered.result.details['本平台身份修订'], 4)
  assert.equal(productWrites, beforeProductWrites); assert.equal(commitWrites, beforeCommitWrites)
  const forbiddenRollback = await call('/executions/commit-lost/account-consistency')
  assert.equal(forbiddenRollback.status, 409)
})
