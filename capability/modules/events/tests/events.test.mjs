import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule} from '../public.mjs'
import {redactText, sanitizeEvidencePayload} from '../queries/evidence.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'

test('events 模块严格禁止 EVT-01 注册直接执行动作', () => {
  assert.equal(capabilityModule.id, 'events')
  assert.deepEqual(capabilityModule.actions, [])
  assert.equal(capabilityModule.routes.length, 1)

  const registry = createRegistry([capabilityModule], {actions: {'EVT-01': []}})
  assert.equal(registry.actionSpec({ticketType: 'EVT-01', ticketTypeVersion: '1', action: 'close_event'}), null)

  assert.throws(
    () =>
      createRegistry(
        [
          {
            id: 'events-illegal',
            actions: [
              {
                ticketType: 'EVT-01',
                ticketTypeVersion: '1',
                action: 'close_event',
                variants: [null],
                execute: async () => ({status: 'succeeded'}),
              },
            ],
            resources: {},
            catalogs: {},
            routes: [],
          },
        ],
        {actions: {'EVT-01': []}},
      ),
    err => err.code === 'UNREGISTERED_ACTION',
  )
})

test('events 能力侧关联证据快照：脱敏、资源匹配校验与账号类执行权限隔离', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'events-evidence-'))
  const stubModule = Object.freeze({
    id: 'stub-disposition',
    actions: [
      {
        ticketType: 'MCP-03',
        ticketTypeVersion: '1',
        action: 'isolate_mcp',
        variants: [null],
        execute: async ({state}) => {
          state.status = 'succeeded'
          state.result = {
            status: 'succeeded',
            summary: '已隔离上游 Bearer secret-token-123456',
            values: {
              token: 'raw-top-secret',
              detail: 'password=abc12345 已阻断',
            },
          }
        },
      },
      {
        ticketType: 'ACC-01',
        ticketTypeVersion: '1',
        action: 'apply_account_change',
        variants: [null],
        execute: async ({state}) => {
          state.status = 'succeeded'
          state.result = {
            status: 'succeeded',
            summary: '账号变更完成',
            values: {account: 'zhangsan'},
          }
        },
      },
    ],
    resources: {},
    catalogs: {},
    routes: [],
  })

  const registry = createRegistry([capabilityModule, stubModule], {
    actions: {
      'EVT-01': [],
      'MCP-03': ['isolate_mcp'],
      'ACC-01': ['apply_account_change'],
    },
    evidence: () => [],
  })
  const server = await startExecutionServer({dir, token: 'tok'}, registry)

  t.after(async () => {
    await server.close()
    await rm(dir, {recursive: true, force: true})
  })

  const headers = (account, role) => ({
    authorization: 'Bearer tok',
    'content-type': 'application/json',
    'x-account': account,
    'x-role': role,
  })

  // 1. 直接向 EVT-01 提交执行命令被明确拒绝
  const evtExecRes = await fetch(`${server.url}/internal/v1/executions`, {
    method: 'POST',
    headers: headers('op-1', 'operator'),
    body: JSON.stringify({
      executionId: 'exec-evt-illegal-1',
      ticketNo: 'EVT-01-20260101-0001',
      ticketType: 'EVT-01',
      ticketTypeVersion: '1',
      action: 'close_event',
      resourceId: 'mcp-1',
      account: 'op-1',
      org: '平台运营组',
      payload: {decisionRef: 'dec-1'},
    }),
  })
  assert.equal(evtExecRes.status, 400)

  // 2. 先产生一条 MCP-03 处置执行记录与一条 ACC-01 账号执行记录
  const mcpExec = await fetch(`${server.url}/internal/v1/executions`, {
    method: 'POST',
    headers: headers('op-1', 'operator'),
    body: JSON.stringify({
      executionId: 'exec-mcp-iso-1',
      ticketNo: 'MCP-03-20260101-0001',
      ticketType: 'MCP-03',
      ticketTypeVersion: '1',
      action: 'isolate_mcp',
      resourceId: 'mcp-gateway-1',
      account: 'op-1',
      org: '平台运营组',
      payload: {decisionRef: 'dec-mcp-1'},
    }),
  })
  assert.equal(mcpExec.status, 202)

  const accExec = await fetch(`${server.url}/internal/v1/executions`, {
    method: 'POST',
    headers: headers('admin-1', 'admin'),
    body: JSON.stringify({
      executionId: 'exec-acc-1',
      ticketNo: 'ACC-01-20260101-0001',
      ticketType: 'ACC-01',
      ticketTypeVersion: '1',
      action: 'apply_account_change',
      resourceId: 'user-zhangsan',
      account: 'admin-1',
      org: '系统管理组',
      payload: {decisionRef: 'dec-acc-1'},
    }),
  })
  assert.equal(accExec.status, 202)

  // 3. 运维查询关联证据：必须严格脱敏
  const evRes = await fetch(`${server.url}/internal/v1/event-evidence/exec-mcp-iso-1?resourceId=mcp-gateway-1`, {
    headers: headers('op-2', 'operator'),
  })
  assert.equal(evRes.status, 200)
  const evBody = await evRes.json()
  assert.equal(evBody.source, 'capability_execution_ledger')
  assert.equal(evBody.redacted, true)
  assert.equal(evBody.status, 'succeeded')
  assert.equal(evBody.resourceId, 'mcp-gateway-1')
  assert.ok(!JSON.stringify(evBody).includes('secret-token-123456'))
  assert.ok(!JSON.stringify(evBody).includes('raw-top-secret'))
  assert.ok(!JSON.stringify(evBody).includes('abc12345'))
  assert.equal(evBody.resultSummary.values.token, '[REDACTED]')

  // 4. resourceId 不匹配返回 409
  const mismatch = await fetch(`${server.url}/internal/v1/event-evidence/exec-mcp-iso-1?resourceId=other-res`, {
    headers: headers('op-2', 'operator'),
  })
  assert.equal(mismatch.status, 409)

  // 5. 账号类执行证据禁止非管理员访问，管理员允许访问
  const accDenied = await fetch(`${server.url}/internal/v1/event-evidence/exec-acc-1`, {
    headers: headers('op-2', 'operator'),
  })
  assert.equal(accDenied.status, 403)

  const accAllowed = await fetch(`${server.url}/internal/v1/event-evidence/exec-acc-1`, {
    headers: headers('admin-1', 'admin'),
  })
  assert.equal(accAllowed.status, 200)
  const accBody = await accAllowed.json()
  assert.equal(accBody.ticketType, 'ACC-01')

  // 6. 普通用户无法越权查看他人执行证据，但可查本人提交的执行证据
  const otherUserDenied = await fetch(`${server.url}/internal/v1/event-evidence/exec-mcp-iso-1`, {
    headers: headers('user-1', 'requester'),
  })
  assert.equal(otherUserDenied.status, 403)

  const selfAllowed = await fetch(`${server.url}/internal/v1/event-evidence/exec-mcp-iso-1`, {
    headers: headers('op-1', 'requester'),
  })
  assert.equal(selfAllowed.status, 200)

  // 7. 不存在的执行记录返回 404
  const notFound = await fetch(`${server.url}/internal/v1/event-evidence/exec-missing`, {
    headers: headers('op-2', 'operator'),
  })
  assert.equal(notFound.status, 404)

  // 8. 脱敏辅助函数单测
  assert.equal(redactText('Bearer tok_123 api_key=xyz'), 'Bearer [REDACTED] api_key=[REDACTED]')
  assert.deepEqual(sanitizeEvidencePayload({apiKey: 'abc', nested: {ok: 'Bearer xxx'}}), {
    apiKey: '[REDACTED]',
    nested: {ok: 'Bearer [REDACTED]'},
  })
})
