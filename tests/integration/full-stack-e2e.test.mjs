import {testPluginArchive} from '../fixtures/plugin-archive.mjs'
import {seedRepositoryFixtures} from '../fixtures/repository-data.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {localStack} from '../../dev/services.mjs'
import {listen, json, body, ledger, digest} from '../../runtime/http.mjs'

async function waitUntil(fn, {timeoutMs = 5000, intervalMs = 50} = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return last
}

test('全栈跨端联调：真实管理系统 + 真实能力组件 + 4 真实仓库端到端闭环', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'app-center-fullstack-'))
  const registrations = ledger(dir, 'mod_mcp_registrations')
  registrations.put('mcp-test-registration', {
    registrationId: 'mcp-test-registration', name: '全栈测试技术注册', source: 'mcp', status: 'registered',
    transport: 'sse', authType: 'bearer', urlFingerprint: digest(Buffer.from('https://test.invalid/mcp')),
    tools: [{name: 'test_search', description: '测试工具', inputSchema: {type: 'object'}}],
    syncedAt: new Date().toISOString(),
  })
  registrations.close()


  // 外层模拟 Dify 与 RAGFlow 上游产品（管理端与能力端均跑真实生产代码）
  const ragUsers = new Map()
  const difyMembers = new Map()
  let failDifyMemberPatch = false
  let nextId = 1

  const difyServer = await listen(async (req, res, path) => {
    if (req.method === 'GET' && path === '/console/api/workspaces/current') return json(res, {id: 'ws-1'})
    if (req.method === 'GET' && path === '/health') return json(res, {status: 'ok', version: '1.14.0'})
    if (req.method === 'GET' && path === '/console/api/workspaces') {
      return json(res, {workspaces: [{id: 'ws-1', name: '法制研判区', status: 'normal'}]})
    }
    if (req.method === 'GET' && path === '/console/api/apps') {
      return json(res, {
        data: [
          {
            id: 'dify-app-1',
            name: '法制助手',
            mode: 'workflow',
            enable_site: false,
            owner_account: 'chen.yu',
            workspace_id: 'ws-1',
          },
        ],
        has_more: false,
      })
    }
    if (req.method === 'GET' && path === '/console/api/apps/dify-app-1') {
      return json(res, {
        id: 'dify-app-1',
        name: '法制助手',
        mode: 'workflow',
        enable_site: false,
        workflow: {id: 'published-workflow-test-1'},
        owner_account: 'chen.yu',
        workspace_id: 'ws-1',
      })
    }
    if (req.method === 'POST' && path === '/console/api/apps/dify-app-1/api-keys') {
      const n = nextId++
      return json(res, {id: `dify-key-${n}`, token: `app-secret-token-${n}9876`, type: 'app'}, 201)
    }
    if (req.method === 'GET' && path === '/console/api/workspaces/current/tools/api') {
      return json(res, [
        {
          id: 'prov-gw',
          name: '警务网关',
          tools: [
            {
              id: 'tool-query',
              label: {zh_Hans: '卷宗检索工具'},
              version: '1.0.0',
              parameters_schema: {type: 'object', properties: {id: {type: 'string'}}},
              description: '查询卷宗元数据',
            },
          ],
        },
      ])
    }
    if (req.method === 'GET' && path === '/console/api/datasets') {
      return json(res, {data: [{id: 'dify-ds-1', name: '法规库', workspace_id: 'ws-1', owner_account: 'chen.yu'}]})
    }
    if (req.method === 'GET' && path === '/console/api/datasets/dify-ds-1') {
      return json(res, {id: 'dify-ds-1', name: '法规库', workspace_id: 'ws-1', owner_account: 'chen.yu', model_verified: true})
    }
    if (req.method === 'GET' && path === '/console/api/datasets/dify-ds-1/documents') {
      return json(res, {data: [{id: 'doc-1', name: '刑法总则.pdf', content: 'e2e-doc-1'}]})
    }
    if (req.method === 'PATCH' && path === '/console/api/datasets/dify-ds-1') {
      return json(res, {id: 'dify-ds-1'})
    }
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
        active: true,
      }
      difyMembers.set(member.id, member)
      return json(res, {account: member}, 201)
    }
    const memberMatch = /^\/console\/api\/workspaces\/current\/members\/([\w-]+)$/.exec(path)
    if (memberMatch && req.method === 'PATCH') {
      if (failDifyMemberPatch) return json(res, {code: 'DIFY_REJECTED', message: '明确拒绝改名，未产生写入'}, 409)
      const existing = difyMembers.get(memberMatch[1])
      if (!existing) return json(res, {code: 'NOT_FOUND'}, 404)
      const updated = {...existing, ...(await body(req))}
      difyMembers.set(existing.id, updated)
      return json(res, {account: updated})
    }
    if (memberMatch && req.method === 'DELETE') {
      difyMembers.delete(memberMatch[1])
      return json(res, {deleted: true})
    }
    return json(res, {error: 'not found'}, 404)
  })

  const ragServer = await listen(async (req, res, path) => {
    if (req.method === 'GET' && path === '/api/v1/system/health') return json(res, {status: 'ok', version: '0.22.1'})
    if (req.method === 'GET' && path === '/api/v1/datasets') {
      return json(res, {data: [{id: 'rag-ds-1', name: '研判库', tenant_id: 'tenant-1', owner_account: 'chen.yu'}]})
    }
    if (req.method === 'GET' && path === '/api/v1/system/users') {
      return json(res, {code: 0, data: [...ragUsers.values()]})
    }
    if (req.method === 'POST' && path === '/api/v1/system/users') {
      const payload = await body(req)
      const user = {
        id: `rag-u-${nextId++}`,
        subjectId: payload.subjectId,
        account: payload.account,
        permission: payload.permission,
        active: true,
      }
      ragUsers.set(user.id, user)
      return json(res, {code: 0, data: user}, 201)
    }
    const userMatch = /^\/api\/v1\/system\/users\/([\w-]+)$/.exec(path)
    if (userMatch && req.method === 'PUT') {
      const existing = ragUsers.get(userMatch[1])
      if (!existing) return json(res, {code: 'NOT_FOUND'}, 404)
      const updated = {...existing, ...(await body(req))}
      ragUsers.set(existing.id, updated)
      return json(res, {code: 0, data: updated})
    }
    if (userMatch && req.method === 'DELETE') {
      ragUsers.delete(userMatch[1])
      return json(res, {deleted: true})
    }
    return json(res, {error: 'not found'}, 404)
  })

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

  seedRepositoryFixtures(dir)
  const stack = await localStack(dir)
  t.after(async () => {
    await stack.close()
    await difyServer.close()
    await ragServer.close()
    await rm(dir, {recursive: true, force: true})
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  const reqApi = (path, cookie = '', payload = undefined, method = undefined) =>
    fetch(stack.management + path, {
      method: method ?? (payload !== undefined ? 'POST' : 'GET'),
      headers: {
        cookie,
        ...(payload !== undefined ? {'content-type': 'application/json'} : {}),
      },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    })

  async function login(account) {
    const res = await reqApi('/api/demo-session', '', {account})
    assert.equal(res.status, 200)
    return res.headers.get('set-cookie').split(';')[0]
  }

  const userCookie = await login('chen.yu')
  const opCookie = await login('zhou.min')
  const adminCookie = await login('li.qiang')

  // =========================================================================
  // 1. SKL-03 取消联动：管理端取消 -> 能力端 cancel -> 回调管理端 close + 仓库作废预留
  // =========================================================================
  const sklTicketRes = await reqApi('/api/tickets', userCookie, {
    ticketNo: 'SKL-03-cancel-e2e',
    ticketType: 'SKL-03',
    action: 'download',
    account: 'chen.yu',
    resourceId: 'skl_doc',
  })
  assert.equal(sklTicketRes.status, 200)
  const sklTicket = await sklTicketRes.json()
  assert.equal(sklTicket.status, 'awaiting_delivery')

  const cancelRes = await reqApi('/api/tickets/SKL-03-cancel-e2e/cancel', opCookie, {
    executionId: sklTicket.executionId ?? sklTicket.resultId.slice(3),
    note: '全栈联调测试取消预留',
  })
  assert.equal(cancelRes.status, 200, `SKL-03 cancel failed: ${cancelRes.status}`)
  const cancelledTicket = await cancelRes.json()
  assert.equal(cancelledTicket.status, 'cancelled')

  const dlAfterCancel = await reqApi('/api/tickets/SKL-03-cancel-e2e/file', userCookie)
  assert.ok([404, 409, 410].includes(dlAfterCancel.status))

  // =========================================================================
  // 2. SKL-01 上传 -> 扫描 -> 申请 -> 审批 -> 发布到真实 Skill 仓库 -> 仓库可见
  // =========================================================================
  const formSkill = new FormData()
  formSkill.append('file', new Blob(['# Demo Skill Package Content\n'], {type: 'application/octet-stream'}), 'demo-skill.tar.gz')
  const skillIntakeRes = await fetch(stack.management + '/api/intake/skill', {
    method: 'POST',
    headers: {cookie: userCookie, 'idempotency-key': 'e2e-skill-upload-1'},
    body: formSkill,
  })
  assert.equal(skillIntakeRes.status, 201, `skill intake failed: ${await skillIntakeRes.clone().text()}`)
  const skillIntake = await skillIntakeRes.json()
  assert.equal(skillIntake.status, 'ready')

  const skl01Sub = await reqApi('/api/applications', userCookie, {
    ticketNo: 'SKL-01-e2e-1',
    ticketType: 'SKL-01',
    resourceId: 'skl-demo-e2e',
    workspaceId: '',
    fields: {
      intakeId: skillIntake.intakeId,
      name: '全栈联调演示 Skill',
      version: 'v1.0.0',
      description: '用于全栈联调验证的 Skill 包',
      instructions: '在 Dify 或本地工作流中解压使用',
      license: '内部开源',
      tags: ['联调'],
      scope: '指定组织',
      targetOrgs: ['业务一部'],
    },
  })
  assert.equal(skl01Sub.status, 201, `SKL-01 submit failed: ${await skl01Sub.clone().text()}`)
  const skl01App = await skl01Sub.json()

  const skl01Approve = await reqApi('/api/applications/transition', opCookie, {
    ticketNo: 'SKL-01-e2e-1',
    revision: skl01App.revision,
    action: '批准',
    note: '同意上架',
  })
  assert.equal(skl01Approve.status, 200, `SKL-01 approve failed: ${await skl01Approve.clone().text()}`)

  const skl01Done = await waitUntil(async () => {
    const list = await (await reqApi('/api/applications?view=mine', userCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'SKL-01-e2e-1')
    return item?.execution?.status === 'succeeded' ? item : null
  })
  assert.ok(skl01Done, 'SKL-01 执行未在超时内到达 succeeded')

  const skillCatalog = await (await reqApi('/api/catalog?kind=skill', userCookie)).json()
  assert.ok(skillCatalog.items.some(i => i.name === '全栈联调演示 Skill'), '上架后的 Skill 应立即出现在 Skill 仓库')

  // =========================================================================
  // 3. KEY-01 密钥创建 + 一次性领取（真实管理端 -> 真实能力端保险箱 -> 二次拒绝）
  // =========================================================================
  const key01Sub = await reqApi('/api/applications', userCookie, {
    ticketNo: 'KEY-01-e2e-1',
    ticketType: 'KEY-01',
    resourceId: 'dify-app-1',
    workspaceId: 'ws-1',
    fields: {
      purpose: '本人调试',
      callerName: 'chen.yu-local',
      callerOrg: '业务一部',
      environment: '开发',
      allowedCidrs: ['10.0.0.0/24'],
      peakQps: 10,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    },
  })
  assert.equal(key01Sub.status, 201, `KEY-01 submit failed: ${await key01Sub.clone().text()}`)

  const key01Done = await waitUntil(async () => {
    const list = await (await reqApi('/api/applications?view=mine', userCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'KEY-01-e2e-1')
    return item?.execution?.status === 'succeeded' ? item : null
  })
  assert.ok(key01Done, 'KEY-01 执行未在超时内到达 succeeded')

  const reveal1 = await reqApi('/api/applications/reveal', userCookie, {ticketNo: 'KEY-01-e2e-1'})
  assert.equal(reveal1.status, 200, `KEY-01 reveal failed: ${await reveal1.clone().text()}`)
  const revealBody = await reveal1.json()
  assert.match(revealBody.secret, /^app-secret-token-/)

  const reveal2 = await reqApi('/api/applications/reveal', userCookie, {ticketNo: 'KEY-01-e2e-1'})
  assert.equal(reveal2.status, 409)

  // =========================================================================
  // 4. TOL-01 工具发现 + 首次批准全链路（管理端 -> 能力端 -> 回调获准输入 -> 持久化）
  // =========================================================================
  const tolCands = await (
    await reqApi('/api/execution-candidates?ticketType=TOL-01&action=set_tool_approval&workspaceId=ws-1&operation=' + encodeURIComponent('首次批准'), opCookie)
  ).json()
  assert.equal(tolCands.items.length, 1)

  const tolSub = await reqApi('/api/applications', opCookie, {
    ticketNo: 'TOL-01-e2e-1',
    ticketType: 'TOL-01',
    resourceId: 'tool-query',
    workspaceId: 'ws-1',
    fields: {
      operation: '首次批准',
      description: '卷宗检索接口工具',
      purpose: '供智能体按卷宗编号查询元数据',
      permissions: ['只读检索'],
      targetOrgs: ['业务一部'],
      classification: '内部',
      businessLine: '法制研判',
    },
  })
  assert.equal(tolSub.status, 201, `TOL-01 submit failed: ${await tolSub.clone().text()}`)
  const tolApp = await tolSub.json()

  const tolApprove = await reqApi('/api/applications/transition', opCookie, {
    ticketNo: 'TOL-01-e2e-1',
    revision: tolApp.revision,
    action: '批准',
    note: '安全复核通过',
    securityVerdict: '通过',
    securityNote: '已核对参数 schema 与权限范围',
    externalAllowed: '允许',
  })
  assert.equal(tolApprove.status, 200, `TOL-01 approve failed: ${await tolApprove.clone().text()}`)

  const tolDone = await waitUntil(async () => {
    const list = await (await reqApi('/api/applications?view=query', opCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'TOL-01-e2e-1')
    return item?.execution?.status === 'succeeded' ? item : null
  })
  assert.ok(tolDone, 'TOL-01 执行未在超时内到达 succeeded')

  // =========================================================================
  // 5. ACC-01 开通（回调真实管理端 commit）+ ACC-02 失败补偿与管理端真实解锁
  // =========================================================================
  const dirRes = await (await reqApi('/api/subjects', adminCookie)).json()
  const inactiveUser = dirRes.items.find(p => !p.active) ?? dirRes.items.find(p => p.account === 'chen.yu')
  assert.ok(inactiveUser)

  // 若演示目录中人员已是启用状态，直接走 ACC-02 改名（先注入产品基线再测试失败补偿与管理端解锁！）
  const targetSubject = dirRes.items.find(p => p.account === 'chen.yu')
  ragUsers.set('rag-chen', {id: 'rag-chen', subjectId: targetSubject.subjectId, account: 'chen.yu', permission: 'team', active: true})
  difyMembers.set('dify-chen', {
    id: 'dify-chen',
    subjectId: targetSubject.subjectId,
    account: 'chen.yu',
    workspaceId: 'ws-1',
    role: 'editor',
    active: true,
  })

  // 5a. ACC-01 角色变更：Dify 明确拒绝时触发 RAGFlow 自动补偿，并通过真实管理端核验恢复并解锁
  failDifyMemberPatch = true
  const acc01Sub = await reqApi('/api/account-applications', adminCookie, {
    ticketNo: 'ACC-01-e2e-fail',
    ticketType: 'ACC-01',
    subjectId: targetSubject.subjectId,
    fields: {
      operation: '角色变更',
      roles: ['operator'],
      workspaceId: 'ws-1',
      ragflowPermission: '管理员',
      difyRole: '管理员',
      effectiveAt: new Date(Date.now() - 1000).toISOString(),
      reason: '全栈联调测试部分失败补偿与解锁',
    },
  })
  assert.equal(acc01Sub.status, 201, `ACC-01 submit failed: ${await acc01Sub.clone().text()}`)
  const acc01App = await acc01Sub.json()

  const acc01Approve = await reqApi('/api/account-applications/transition', adminCookie, {
    ticketNo: 'ACC-01-e2e-fail',
    revision: acc01App.revision,
    action: '批准',
    note: '同意角色变更',
  })
  assert.equal(acc01Approve.status, 200, `ACC-01 approve failed: ${await acc01Approve.clone().text()}`)

  const acc01Failed = await waitUntil(async () => {
    const list = await (await reqApi('/api/account-applications?view=query', adminCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'ACC-01-e2e-fail')
    return item?.status === '执行失败' ? item : null
  })
  assert.ok(acc01Failed, 'ACC-01 应进入执行失败状态并完成 RAGFlow 自动补偿')
  assert.equal(ragUsers.get('rag-chen').permission, 'team')

  // 真实管理端调用真实能力端 GET /internal/v1/executions/:id/account-consistency 并原子解锁！
  const unlockRes = await reqApi('/api/account-applications/transition', adminCookie, {
    ticketNo: 'ACC-01-e2e-fail',
    revision: acc01Failed.revision,
    action: '核验恢复并解锁',
    note: '核验双端一致性封存证明并释放目标锁',
  })
  assert.equal(unlockRes.status, 200, `ACC-01 unlock failed: ${await unlockRes.clone().text()}`)
  const unlocked = await unlockRes.json()
  assert.equal(unlocked.status, '已终止')
  assert.equal(unlocked.recovery.sealed, true)
  assert.equal(unlocked.recovery.outcome, 'restored')

  // =========================================================================
  // 6. 总览监控：真实管理端 /api/overview -> 真实能力端 /internal/v1/overview-summary
  // =========================================================================
  const overviewRes = await reqApi('/api/overview?range=1h', opCookie)
  assert.equal(overviewRes.status, 200)
  const overview = await overviewRes.json()
  assert.equal(overview.resources.state, 'collected', `overview resources degraded: ${JSON.stringify(overview.resources)}`)
  assert.equal(overview.health.state, 'collected', `overview health degraded: ${JSON.stringify(overview.health)}`)
  assert.equal(overview.health.data.find(s => s.key === 'dify').status, 'healthy')
  assert.equal(overview.health.data.find(s => s.key === 'ragflow').status, 'healthy')
  assert.equal(overview.health.data.find(s => s.key === 'database').status, 'healthy')
  assert.equal(overview.calls.state, 'unavailable')
  assert.equal(overview.exceptions.state, 'unavailable')

  // =========================================================================
  // 7. PLG-01 插件上传解析 -> 上架审批 -> 真实插件仓库可见
  // =========================================================================
  const formPlugin = new FormData()
  formPlugin.append(
    'file',
    new Blob([testPluginArchive({uniqueIdentifier: 'e2e/demo-plugin', name: '全栈演示插件', version: '1.0.0'})], {
      type: 'application/octet-stream',
    }),
    'demo-plugin-1.0.0.difypkg',
  )
  const plgIntakeRes = await fetch(stack.management + '/api/intake/plugin', {
    method: 'POST',
    headers: {cookie: userCookie, 'idempotency-key': 'e2e-plugin-upload-1'},
    body: formPlugin,
  })
  assert.equal(plgIntakeRes.status, 201, `plugin intake failed: ${await plgIntakeRes.clone().text()}`)
  const plgIntake = await plgIntakeRes.json()
  assert.equal(plgIntake.status, 'ready')

  const plg01Sub = await reqApi('/api/applications', userCookie, {
    ticketNo: 'PLG-01-e2e-1',
    ticketType: 'PLG-01',
    resourceId: plgIntake.intakeId,
    workspaceId: '',
    fields: {
      intakeId: plgIntake.intakeId,
      description: '用于全栈联调验证的插件包',
      instructions: '安装至目标工作区后在工作流中调用',
      permissions: ['网络访问'],
      accessMode: '公开免审安装',
      installationMethod: '本地包',
      networkAccess: [{domain: 'internal.local', port: 443, purpose: '内网接口访问'}],
    },
  })
  assert.equal(plg01Sub.status, 201, `PLG-01 submit failed: ${await plg01Sub.clone().text()}`)
  const plg01App = await plg01Sub.json()

  const plg01Approve = await reqApi('/api/applications/transition', opCookie, {
    ticketNo: 'PLG-01-e2e-1',
    revision: plg01App.revision,
    action: '批准',
    note: '同意上架插件',
    externalAllowed: '允许',
  })
  assert.equal(plg01Approve.status, 200, `PLG-01 approve failed: ${await plg01Approve.clone().text()}`)

  const plg01Done = await waitUntil(async () => {
    const list = await (await reqApi('/api/applications?view=mine', userCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'PLG-01-e2e-1')
    return item?.execution?.status === 'succeeded' ? item : null
  })
  assert.ok(plg01Done, 'PLG-01 执行未在超时内到达 succeeded')

  const plgCatalog = await (await reqApi('/api/catalog?kind=plugin', userCookie)).json()
  assert.ok(plgCatalog.items.some(i => i.name === '全栈演示插件'), '上架后的插件应立即出现在插件仓库')

  // =========================================================================
  // 8. MCP-01 技术发现 -> 上架审批 -> 真实 MCP 仓库可见
  // =========================================================================
  const mcpResources = await (await reqApi('/api/resources?kind=mcp_registration', userCookie)).json()
  assert.ok(mcpResources.items.length >= 1)
  const mcpRegId = mcpResources.items[0].resourceId

  const mcp01Sub = await reqApi('/api/applications', userCookie, {
    ticketNo: 'MCP-01-e2e-1',
    ticketType: 'MCP-01',
    resourceId: mcpRegId,
    workspaceId: '',
    fields: {
      name: '全栈联调 MCP 服务',
      purpose: '提供内网标准工具协议调用',
      boundaryOrgs: ['业务一部'],
      classification: '内部',
      businessLine: '法制研判',
    },
  })
  assert.equal(mcp01Sub.status, 201, `MCP-01 submit failed: ${await mcp01Sub.clone().text()}`)
  const mcp01App = await mcp01Sub.json()

  const mcp01Approve = await reqApi('/api/applications/transition', opCookie, {
    ticketNo: 'MCP-01-e2e-1',
    revision: mcp01App.revision,
    action: '批准',
    note: '同意登记 MCP',
    securityVerdict: '通过',
    securityNote: '已核对 URL 指纹与工具清单',
    externalAllowed: '允许',
  })
  assert.equal(mcp01Approve.status, 200, `MCP-01 approve failed: ${await mcp01Approve.clone().text()}`)

  const mcp01Done = await waitUntil(async () => {
    const list = await (await reqApi('/api/applications?view=mine', userCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'MCP-01-e2e-1')
    return item?.execution?.status === 'succeeded' ? item : null
  })
  assert.ok(mcp01Done, 'MCP-01 执行未在超时内到达 succeeded')

  const mcpCatalog = await (await reqApi('/api/catalog?kind=mcp', userCookie)).json()
  assert.ok(mcpCatalog.items.some(i => i.name === '全栈联调 MCP 服务'), '登记后的 MCP 应立即出现在 MCP 仓库')

  // =========================================================================
  // 9. AG-01 纳管 -> AG-02 发布 -> 真实智能体仓库可见
  // =========================================================================
  const ag01Sub = await reqApi('/api/applications', userCookie, {
    ticketNo: 'AG-01-e2e-1',
    ticketType: 'AG-01',
    resourceId: 'dify-app-1',
    workspaceId: 'ws-1',
    fields: {},
  })
  assert.equal(ag01Sub.status, 201, `AG-01 submit failed: ${await ag01Sub.clone().text()}`)
  const ag01Done = await waitUntil(async () => {
    const list = await (await reqApi('/api/applications?view=mine', userCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'AG-01-e2e-1')
    return item?.execution?.status === 'succeeded' ? item : null
  })
  assert.ok(ag01Done, 'AG-01 执行未在超时内到达 succeeded')

  const ag02Sub = await reqApi('/api/applications', userCookie, {
    ticketNo: 'AG-02-e2e-1',
    ticketType: 'AG-02',
    resourceId: 'dify-app-1',
    workspaceId: 'ws-1',
    fields: {
      scenario: '法制研判助手',
      instructions: '输入案件要素即可生成法条建议',
      businessLine: '法制研判',
      classification: '内部',
      scope: 'orgs',
      targetOrgs: ['业务一部'],
      boundaryOrgs: ['业务一部'],
      usages: ['run', 'api'],
    },
  })
  assert.equal(ag02Sub.status, 201, `AG-02 submit failed: ${await ag02Sub.clone().text()}`)
  const ag02App = await ag02Sub.json()

  const ag02Approve = await reqApi('/api/applications/transition', opCookie, {
    ticketNo: 'AG-02-e2e-1',
    revision: ag02App.revision,
    action: '批准',
    note: '同意发布智能体',
  })
  assert.equal(ag02Approve.status, 200, `AG-02 approve failed: ${await ag02Approve.clone().text()}`)

  const ag02Done = await waitUntil(async () => {
    const list = await (await reqApi('/api/applications?view=mine', userCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'AG-02-e2e-1')
    return item?.execution?.status === 'succeeded' ? item : null
  })
  assert.ok(ag02Done, 'AG-02 执行未在超时内到达 succeeded')

  const ag02Confirm = await reqApi('/api/applications/transition', userCookie, {
    ticketNo: 'AG-02-e2e-1',
    revision: ag02Done.revision,
    action: '确认结果',
    note: '确认智能体已成功发布',
  })
  assert.equal(ag02Confirm.status, 200)

  const agentCatalog = await (await reqApi('/api/catalog?kind=agent', userCookie)).json()
  assert.ok(agentCatalog.items.some(i => i.resourceId === 'dify-app-1'), '发布后的智能体应出现在 agent 目录')

  const agentWarehouse = await (await reqApi('/api/agent-warehouse', userCookie)).json()
  assert.ok(agentWarehouse.items.some(i => i.id === 'dify-app-1'), '发布后的智能体应出现在智能体仓库')

  // =========================================================================
  // 10. KB-01 同步 -> KB-02 发布（逐文档确认）-> KB-03 同区绑定
  // =========================================================================
  const kb01Sub = await reqApi('/api/applications', userCookie, {
    ticketNo: 'KB-01-e2e-1',
    ticketType: 'KB-01',
    resourceId: 'dify-ds-1',
    workspaceId: 'ws-1',
    fields: {sourceSystem: 'Dify'},
  })
  assert.equal(kb01Sub.status, 201, `KB-01 submit failed: ${await kb01Sub.clone().text()}`)
  const kb01Done = await waitUntil(async () => {
    const list = await (await reqApi('/api/applications?view=mine', userCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'KB-01-e2e-1')
    return item?.execution?.status === 'succeeded' ? item : null
  })
  assert.ok(kb01Done, 'KB-01 执行未在超时内到达 succeeded')
  const kbCatalogId = kb01Done.execution.result.resultId

  const kb02Sub = await reqApi('/api/applications', userCookie, {
    ticketNo: 'KB-02-e2e-1',
    ticketType: 'KB-02',
    resourceId: kbCatalogId,
    workspaceId: 'ws-1',
    fields: {
      sourceSystem: 'Dify',
      shareMode: '共享目录',
      purpose: '供全网段业务研判检索使用',
      name: '全栈联调法规知识库',
      description: '标准法规库',
      tags: ['法规'],
      boundaryOrgs: ['业务一部'],
      classification: '内部',
      businessLine: '法制研判',
    },
  })
  assert.equal(kb02Sub.status, 201, `KB-02 submit failed: ${await kb02Sub.clone().text()}`)
  const kb02App = await kb02Sub.json()
  const docsToConfirm = kb02App.snapshot.fields['文档审查明细'].map(d => ({
    documentId: d.documentId,
    sha256: d.sha256,
    verdict: '通过',
  }))
  const kb02Approve = await reqApi('/api/applications/transition', opCookie, {
    ticketNo: 'KB-02-e2e-1',
    revision: kb02App.revision,
    action: '批准',
    note: '逐文档复核通过',
    confirmations: docsToConfirm,
  })
  assert.equal(kb02Approve.status, 200, `KB-02 approve failed: ${await kb02Approve.clone().text()}`)

  const kb02Done = await waitUntil(async () => {
    const list = await (await reqApi('/api/applications?view=mine', userCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'KB-02-e2e-1')
    return item?.execution?.status === 'succeeded' ? item : null
  })
  assert.ok(kb02Done, 'KB-02 执行未在超时内到达 succeeded')

  // =========================================================================
  // 11. ACC-02 成功改名 -> 真实回调 PUT /internal/v1/account-changes/:id/commit
  // =========================================================================
  failDifyMemberPatch = false
  const acc02OkSub = await reqApi('/api/account-applications', adminCookie, {
    ticketNo: 'ACC-02-e2e-ok',
    ticketType: 'ACC-02',
    subjectId: targetSubject.subjectId,
    fields: {
      newAccount: 'chen.yu.v2',
      workspaceId: 'ws-1',
      effectiveAt: new Date(Date.now() - 1000).toISOString(),
      reason: '全栈联调验证双端改名成功并提交本平台身份',
    },
  })
  assert.equal(acc02OkSub.status, 201, `ACC-02 ok submit failed: ${await acc02OkSub.clone().text()}`)
  const acc02OkApp = await acc02OkSub.json()
  const acc02OkApprove = await reqApi('/api/account-applications/transition', adminCookie, {
    ticketNo: 'ACC-02-e2e-ok',
    revision: acc02OkApp.revision,
    action: '批准',
    note: '批准改名',
  })
  assert.equal(acc02OkApprove.status, 200, `ACC-02 ok approve failed: ${await acc02OkApprove.clone().text()}`)

  const acc02OkDone = await waitUntil(async () => {
    const list = await (await reqApi('/api/account-applications?view=query', adminCookie)).json()
    const item = list.items.find(r => r.ticketNo === 'ACC-02-e2e-ok')
    return item?.status === '待结果确认' ? item : null
  })
  assert.ok(acc02OkDone, 'ACC-02 成功改名应完成真实管理端 commit 并进入待结果确认')
  const updatedDir = await (await reqApi('/api/subjects', adminCookie)).json()
  assert.equal(updatedDir.items.find(p => p.subjectId === targetSubject.subjectId)?.account, 'chen.yu.v2')
  assert.equal(ragUsers.get('rag-chen').account, 'chen.yu')
  assert.equal(difyMembers.get('dify-chen').account, 'chen.yu')
})
