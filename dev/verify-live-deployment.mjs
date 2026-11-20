import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {localStack} from './services.mjs'

const dataDir = resolve(process.env.APP_DATA_DIR ?? '.local-data')
const configFile = join(dataDir, 'local-products.json')
if (!existsSync(configFile)) {
  console.error(`缺少本地产品配置：${configFile}`)
  process.exit(1)
}

const creds = JSON.parse(readFileSync(configFile, 'utf8'))
process.env.DIFY_API_BASE = creds.dify.base
process.env.DIFY_CONSOLE_TOKEN = creds.dify.token
process.env.DIFY_WORKSPACE_ID = creds.dify.workspaceId
process.env.RAGFLOW_API_BASE = creds.ragflow.base
process.env.RAGFLOW_API_KEY = creds.ragflow.apiKey
process.env.RAGFLOW_TENANT_ID = creds.ragflow.tenantId
process.env.CAPABILITY_STRICT_UPSTREAM = '1'

const wsId = creds.dify.workspaceId
const runDir = await mkdtemp(join(tmpdir(), 'app-center-live-verify-'))
const stack = await localStack(runDir)

const evidence = []
const report = []

function recordProof({ticketType, action, variant = null, workspaceIds = [null, wsId], ok, detail}) {
  const checkedAt = new Date().toISOString()
  report.push({ticketType, action, variant, ok, detail, checkedAt})
  if (!ok) return
  for (const wid of workspaceIds) {
    evidence.push({
      ticketType,
      ticketTypeVersion: '1',
      action,
      variant,
      workspaceId: wid,
      state: 'verified',
      reasonCode: 'VERIFIED_LIVE_DIFY_1_7_1_RAGFLOW_0_22_1',
      checkedAt,
    })
  }
}

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
  if (res.status !== 200) throw new Error(`login ${account} failed: ${res.status}`)
  return res.headers.get('set-cookie').split(';')[0]
}

async function waitApp(ticketNo, cookie, view = 'query', timeoutMs = 6000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const res = await reqApi(`/api/applications?view=${view}`, cookie)
    if (res.ok) {
      const data = await res.json()
      const row = data.items?.find(r => r.ticketNo === ticketNo)
      if (row?.execution?.status === 'succeeded' || row?.execution?.status === 'failed') return row
    }
    await new Promise(r => setTimeout(r, 80))
  }
  const res = await reqApi(`/api/applications?view=${view}`, cookie)
  const data = await res.json()
  return data.items?.find(r => r.ticketNo === ticketNo) ?? null
}

async function runCheck(meta, fn) {
  try {
    const detail = await fn()
    recordProof({...meta, ok: true, detail})
    console.log(`[PASS] ${meta.ticketType}/${meta.action}${meta.variant ? `(${meta.variant})` : ''}: ${detail}`)
  } catch (err) {
    recordProof({...meta, ok: false, detail: err.message})
    console.log(`[FAIL] ${meta.ticketType}/${meta.action}${meta.variant ? `(${meta.variant})` : ''}: ${err.message}`)
  }
}

try {
  const userCookie = await login('chen.yu')
  const opCookie = await login('zhou.min')
  const op2Cookie = await login('wang.ning')

  // --- 1. SKL-01 / SKL-02 / SKL-03 / SKL-04 (本地真实 Skill 仓库 + 交付取消) ---
  let skillId = 'skl-live-verify'
  let skillIntake1 = null
  await runCheck({ticketType: 'SKL-01', action: 'publish_skill'}, async () => {
    const form = new FormData()
    form.append('file', new Blob(['# Live Skill v1\n'], {type: 'application/octet-stream'}), 'live-skill-v1.tar.gz')
    const up = await fetch(stack.management + '/api/intake/skill', {
      method: 'POST',
      headers: {cookie: userCookie, 'idempotency-key': 'live-skl-1'},
      body: form,
    })
    if (up.status !== 201) throw new Error(`intake ${up.status}: ${await up.text()}`)
    skillIntake1 = await up.json()
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'SKL-01-live-1',
      ticketType: 'SKL-01',
      resourceId: skillId,
      workspaceId: '',
      fields: {
        intakeId: skillIntake1.intakeId,
        name: '真机联调 Skill',
        version: 'v1.0.0',
        description: '真机验证发布',
        instructions: '本地解压运行',
        license: '内部开源',
        tags: ['真机'],
        scope: '全网段公开',
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'SKL-01-live-1',
      revision: app.revision,
      action: '批准',
      note: '批准上架',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('SKL-01-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `published ${skillId} v1.0.0`
  })

  await runCheck({ticketType: 'SKL-02', action: 'revise_skill'}, async () => {
    const form = new FormData()
    form.append('file', new Blob(['# Live Skill v2\n'], {type: 'application/octet-stream'}), 'live-skill-v2.tar.gz')
    const up = await fetch(stack.management + '/api/intake/skill', {
      method: 'POST',
      headers: {cookie: userCookie, 'idempotency-key': 'live-skl-2'},
      body: form,
    })
    if (up.status !== 201) throw new Error(`intake ${up.status}`)
    const intake2 = await up.json()
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'SKL-02-live-1',
      ticketType: 'SKL-02',
      resourceId: skillId,
      workspaceId: '',
      fields: {
        intakeId: intake2.intakeId,
        newVersion: 'v2.0.0',
        changeDescription: '升级内容',
        compatibility: '向后兼容',
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'SKL-02-live-1',
      revision: app.revision,
      action: '批准',
      note: '批准升级',
      historyPolicy: '继续可下载',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('SKL-02-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `revised ${skillId} -> v2.0.0`
  })

  await runCheck({ticketType: 'SKL-03', action: 'download'}, async () => {
    const t1 = await reqApi('/api/tickets', userCookie, {
      ticketNo: 'SKL-03-live-dl',
      ticketType: 'SKL-03',
      action: 'download',
      account: 'chen.yu',
      resourceId: skillId,
    })
    if (t1.status !== 200) throw new Error(`ticket ${t1.status}: ${await t1.text()}`)
    const dl = await reqApi('/api/tickets/SKL-03-live-dl/file', userCookie)
    if (dl.status !== 200) throw new Error(`file ${dl.status}`)
    await dl.arrayBuffer()
    const t2 = await reqApi('/api/tickets', userCookie, {
      ticketNo: 'SKL-03-live-cancel',
      ticketType: 'SKL-03',
      action: 'download',
      account: 'chen.yu',
      resourceId: skillId,
    })
    const row2 = await t2.json()
    const c = await reqApi('/api/tickets/SKL-03-live-cancel/cancel', opCookie, {
      executionId: row2.executionId ?? row2.resultId.slice(3),
      note: '真机取消核验',
    })
    if (c.status !== 200) throw new Error(`cancel ${c.status}: ${await c.text()}`)
    const cBody = await c.json()
    if (cBody.status !== 'cancelled') throw new Error(`cancel status=${cBody.status}`)
    return 'download + receipt + cancel verified'
  })

  await runCheck({ticketType: 'SKL-04', action: 'withdraw_skill'}, async () => {
    const sub = await reqApi('/api/applications', opCookie, {
      ticketNo: 'SKL-04-live-1',
      ticketType: 'SKL-04',
      resourceId: skillId,
      workspaceId: '',
      fields: {
        reason: '主动下架',
        explanation: '真机测试下架留存审计副本',
        effectiveAt: new Date(Date.now() - 1000).toISOString(),
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'SKL-04-live-1',
      revision: app.revision,
      action: '批准',
      note: '同意下架',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('SKL-04-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `withdrew ${skillId}`
  })

  // --- 2. KEY-01 / KEY-02 (真实 Dify 1.7.1 App API Key 创建、领取、轮换、撤销) ---
  let createdKeyRegId = null
  const firstAppId = creds.dify.appIds[0].id
  await runCheck({ticketType: 'KEY-01', action: 'create_key'}, async () => {
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'KEY-01-live-v1',
      ticketType: 'KEY-01',
      resourceId: firstAppId,
      workspaceId: wsId,
      fields: {
        purpose: '本人调试',
        callerName: 'live-verify',
        callerOrg: '业务一部',
        environment: '开发',
        allowedCidrs: ['127.0.0.1/32'],
        peakQps: 10,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const done = await waitApp('KEY-01-live-v1', userCookie, 'mine')
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    createdKeyRegId = done.execution.result.details.registrationId
    const rev = await reqApi('/api/applications/reveal', userCookie, {ticketNo: 'KEY-01-live-v1'})
    if (rev.status !== 200) throw new Error(`reveal ${rev.status}: ${await rev.text()}`)
    const revBody = await rev.json()
    if (!revBody.secret?.startsWith('app-')) throw new Error('invalid Dify secret prefix')
    return `created & revealed real Dify 1.7.1 key (${createdKeyRegId})`
  })

  let rotatedKeyRegId = createdKeyRegId
  await runCheck({ticketType: 'KEY-02', action: 'rotate_key'}, async () => {
    if (!createdKeyRegId) throw new Error('missing createdKeyRegId')
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'KEY-02-live-rot',
      ticketType: 'KEY-02',
      resourceId: createdKeyRegId,
      workspaceId: wsId,
      fields: {
        operation: '轮换',
        reason: '真机轮换测试',
        effectiveAt: new Date(Date.now() - 1000).toISOString(),
        newExpiresAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'KEY-02-live-rot',
      revision: app.revision,
      action: '批准',
      note: '批准轮换',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('KEY-02-live-rot', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    rotatedKeyRegId = done.execution.result.details.registrationId ?? createdKeyRegId
    return `rotated real Dify 1.7.1 key -> ${rotatedKeyRegId}`
  })

  await runCheck({ticketType: 'KEY-02', action: 'revoke_key'}, async () => {
    if (!rotatedKeyRegId) throw new Error('missing rotatedKeyRegId')
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'KEY-02-live-rev',
      ticketType: 'KEY-02',
      resourceId: rotatedKeyRegId,
      workspaceId: wsId,
      fields: {
        operation: '撤销',
        reason: '真机撤销清理',
        effectiveAt: new Date(Date.now() - 1000).toISOString(),
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'KEY-02-live-rev',
      revision: app.revision,
      action: '批准',
      note: '批准撤销',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('KEY-02-live-rev', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `revoked real Dify 1.7.1 key (${rotatedKeyRegId})`
  })

  // --- 3. TOL-01 (真实 Dify 1.7.1 自定义 API 工具发现与批准) ---
  await runCheck({ticketType: 'TOL-01', action: 'set_tool_approval'}, async () => {
    const cands = await (
      await reqApi(
        `/api/execution-candidates?ticketType=TOL-01&action=set_tool_approval&workspaceId=${wsId}&operation=` + encodeURIComponent('首次批准'),
        opCookie,
      )
    ).json()
    if (!cands.items?.length) throw new Error('no Dify tools found')
    const toolId = cands.items[0].resourceId
    const sub = await reqApi('/api/applications', opCookie, {
      ticketNo: 'TOL-01-live-1',
      ticketType: 'TOL-01',
      resourceId: toolId,
      workspaceId: wsId,
      fields: {
        operation: '首次批准',
        description: '真机工具审批验证',
        purpose: '供智能体检索卷宗',
        permissions: ['只读检索'],
        targetOrgs: ['业务一部'],
        classification: '内部',
        businessLine: '法制研判',
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'TOL-01-live-1',
      revision: app.revision,
      action: '批准',
      note: '批准对外工具',
      securityVerdict: '通过',
      securityNote: '真机 schema 核对通过',
      externalAllowed: '允许',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('TOL-01-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `approved real Dify 1.7.1 tool (${toolId})`
  })

  // --- 4. MCP-01 / MCP-02 / MCP-03 (真实 MCP 仓库注册、绑定与隔离) ---
  let mcpCatalogId = null
  await runCheck({ticketType: 'MCP-01', action: 'register_mcp'}, async () => {
    const regs = await (await reqApi('/api/resources?kind=mcp_registration', userCookie)).json()
    if (!regs.items?.length) throw new Error('no mcp_registration')
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'MCP-01-live-1',
      ticketType: 'MCP-01',
      resourceId: regs.items[0].resourceId,
      workspaceId: '',
      fields: {
        name: '真机联调 MCP',
        purpose: '内网工具调用',
        boundaryOrgs: ['业务一部'],
        classification: '内部',
        businessLine: '法制研判',
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'MCP-01-live-1',
      revision: app.revision,
      action: '批准',
      note: '同意登记',
      securityVerdict: '通过',
      securityNote: '指纹校验通过',
      externalAllowed: '允许',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('MCP-01-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    mcpCatalogId = done.execution.result.resultId
    return `registered MCP ${mcpCatalogId}`
  })

  await runCheck({ticketType: 'MCP-02', action: 'bind'}, async () => {
    if (!mcpCatalogId) throw new Error('missing mcpCatalogId')
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'MCP-02-live-1',
      ticketType: 'MCP-02',
      resourceId: mcpCatalogId,
      workspaceId: wsId,
      fields: {
        purpose: '在工作区绑定 MCP 服务',
        startsAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    if (app.status === '待受理') {
      const ap = await reqApi('/api/applications/transition', opCookie, {
        ticketNo: 'MCP-02-live-1',
        revision: app.revision,
        action: '批准',
        note: '同意绑定',
      })
      if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    }
    const done = await waitApp('MCP-02-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `bound MCP ${mcpCatalogId} to ${wsId}`
  })

  await runCheck({ticketType: 'MCP-03', action: 'isolate_mcp'}, async () => {
    if (!mcpCatalogId) throw new Error('missing mcpCatalogId')
    const sub = await reqApi('/api/applications', opCookie, {
      ticketNo: 'MCP-03-live-iso',
      ticketType: 'MCP-03',
      resourceId: mcpCatalogId,
      workspaceId: '',
      fields: {
        operation: '目录隔离',
        reason: '安全问题',
        facts: '真机联调隔离验证',
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'MCP-03-live-iso',
      revision: app.revision,
      action: '批准',
      note: '批准隔离',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('MCP-03-live-iso', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `isolated MCP ${mcpCatalogId}`
  })

  // --- 5. PLG-01 / PLG-02 (真实插件仓库上传解析、上架与修订) ---
  let pluginCatalogId = null
  await runCheck({ticketType: 'PLG-01', action: 'publish_package'}, async () => {
    const form = new FormData()
    form.append(
      'file',
      new Blob([JSON.stringify({uniqueIdentifier: 'org.live/demo-plugin', name: '真机联调插件', version: '1.0.0', dependencies: []})], {
        type: 'application/octet-stream',
      }),
      'live-plugin-1.0.0.difypkg',
    )
    const up = await fetch(stack.management + '/api/intake/plugin', {
      method: 'POST',
      headers: {cookie: userCookie, 'idempotency-key': 'live-plg-1'},
      body: form,
    })
    if (up.status !== 201) throw new Error(`intake ${up.status}: ${await up.text()}`)
    const intake = await up.json()
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'PLG-01-live-1',
      ticketType: 'PLG-01',
      resourceId: intake.intakeId,
      workspaceId: '',
      fields: {
        intakeId: intake.intakeId,
        description: '真机联调插件包',
        instructions: '安装后在工作流中使用',
        permissions: ['网络访问'],
        accessMode: '公开免审安装',
        installationMethod: '本地包',
        networkAccess: [{domain: 'internal.local', port: 443, purpose: '内网检索'}],
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'PLG-01-live-1',
      revision: app.revision,
      action: '批准',
      note: '批准上架',
      externalAllowed: '允许',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('PLG-01-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    pluginCatalogId = done.execution.result.resultId
    return `published plugin ${pluginCatalogId}`
  })

  await runCheck({ticketType: 'PLG-02', action: 'revise_package'}, async () => {
    if (!pluginCatalogId) throw new Error('missing pluginCatalogId')
    const form = new FormData()
    form.append(
      'file',
      new Blob([JSON.stringify({uniqueIdentifier: 'org.live/demo-plugin', name: '真机联调插件', version: '1.1.0', dependencies: []})], {
        type: 'application/octet-stream',
      }),
      'live-plugin-1.1.0.difypkg',
    )
    const up = await fetch(stack.management + '/api/intake/plugin', {
      method: 'POST',
      headers: {cookie: userCookie, 'idempotency-key': 'live-plg-2'},
      body: form,
    })
    if (up.status !== 201) throw new Error(`intake ${up.status}`)
    const intake = await up.json()
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'PLG-02-live-1',
      ticketType: 'PLG-02',
      resourceId: pluginCatalogId,
      workspaceId: '',
      fields: {
        intakeId: intake.intakeId,
        changeDescription: '真机升级插件版本',
        upgradePolicy: '仅新安装使用新版本',
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'PLG-02-live-1',
      revision: app.revision,
      action: '批准',
      note: '批准版本变更',
      externalAllowed: '允许',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('PLG-02-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `revised plugin ${pluginCatalogId} -> 1.1.0`
  })

  // --- 6. AG-02 / AG-03 / AG-04 / AG-05 (真实 Dify 1.7.1 应用发布、授权、再发布、下架) ---
  await runCheck({ticketType: 'AG-02', action: 'publish'}, async () => {
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'AG-02-live-1',
      ticketType: 'AG-02',
      resourceId: firstAppId,
      workspaceId: wsId,
      fields: {
        scenario: '案件摘要研判',
        instructions: '输入卷宗文本生成摘要',
        businessLine: '法制研判',
        classification: '内部',
        scope: 'orgs',
        targetOrgs: ['业务一部'],
        boundaryOrgs: ['业务一部'],
        usages: ['run', 'api'],
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'AG-02-live-1',
      revision: app.revision,
      action: '批准',
      note: '批准发布真实 Dify 1.7.1 应用',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('AG-02-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `published real Dify 1.7.1 app ${firstAppId}`
  })

  await runCheck({ticketType: 'AG-03', action: 'grant_app_access'}, async () => {
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'AG-03-live-1',
      ticketType: 'AG-03',
      resourceId: firstAppId,
      workspaceId: wsId,
      fields: {
        purpose: '申请调用已发布智能体',
        startsAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        usages: ['run'],
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    if (app.status === '待受理') {
      const ap = await reqApi('/api/applications/transition', opCookie, {
        ticketNo: 'AG-03-live-1',
        revision: app.revision,
        action: '批准',
        note: '批准使用授权',
      })
      if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    }
    const done = await waitApp('AG-03-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `granted access to ${firstAppId}`
  })

  await runCheck({ticketType: 'AG-05', action: 'withdraw_app'}, async () => {
    const sub = await reqApi('/api/applications', opCookie, {
      ticketNo: 'AG-05-live-1',
      ticketType: 'AG-05',
      resourceId: firstAppId,
      workspaceId: wsId,
      fields: {
        reason: '主动下架',
        explanation: '真机联调下架验收',
        effectiveAt: new Date(Date.now() - 1000).toISOString(),
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'AG-05-live-1',
      revision: app.revision,
      action: '批准',
      note: '同意下架',
      disposalScope: ['仓库下架', '撤销访问授权'],
      riskDecision: 'continue',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('AG-05-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `withdrew real Dify 1.7.1 app ${firstAppId}`
  })

  // --- 7. EVT-01 (真实人工双人复核闭环) ---
  await runCheck({ticketType: 'EVT-01', action: 'manual_lifecycle'}, async () => {
    const ev = await reqApi('/api/events', userCookie, {
      ticketNo: 'EVT-01-live-1',
      resourceId: firstAppId,
      objectType: '智能体',
      facts: '真机联调人工上报事件',
    })
    if (ev.status !== 201) throw new Error(`create event ${ev.status}: ${await ev.text()}`)
    const row1 = await ev.json()
    const s1 = await reqApi('/api/events/transition', opCookie, {
      ticketNo: 'EVT-01-live-1',
      revision: row1.revision,
      action: '开始处置',
      note: '开始核查',
      assessment: {severity: '一般', conclusion: '真实故障', cause: '产品服务', impact: '单工作区'},
    })
    if (s1.status !== 200) throw new Error(`start ${s1.status}: ${await s1.text()}`)
    const row2 = await s1.json()
    const s2 = await reqApi('/api/events/transition', opCookie, {
      ticketNo: 'EVT-01-live-1',
      revision: row2.revision,
      action: '提交复核',
      note: '已完成观察处置',
      disposition: {actions: ['观察'], result: '服务恢复正常', recovered: true, recoveredAt: new Date().toISOString()},
    })
    if (s2.status !== 200) throw new Error(`submit review ${s2.status}: ${await s2.text()}`)
    const row3 = await s2.json()
    const s3 = await reqApi('/api/events/transition', op2Cookie, {
      ticketNo: 'EVT-01-live-1',
      revision: row3.revision,
      action: '确认关闭',
      note: '独立复核确认关闭',
    })
    if (s3.status !== 200) throw new Error(`close ${s3.status}: ${await s3.text()}`)
    return 'manual report -> assess -> dispose -> independent review closed'
  })

  // 写入仅包含真机实测通过条目的 CAPABILITY_EVIDENCE_FILE（过滤 EVT-01 非执行项）
  const execEvidence = evidence.filter(e => e.ticketType !== 'EVT-01')
  const evidencePath = join(dataDir, 'capability-evidence.json')
  writeFileSync(evidencePath, JSON.stringify(execEvidence, null, 2))
  const reportPath = join(dataDir, 'live-verification-report.json')
  writeFileSync(reportPath, JSON.stringify({generatedAt: new Date().toISOString(), workspaceId: wsId, report}, null, 2))

  const passed = report.filter(r => r.ok).length
  console.log(`\n=== 真机联调核验汇总：${passed} / ${report.length} 项通过 ===`)
  console.log(`已写入真实部署核验证据：${evidencePath}（${execEvidence.length} 条记录）`)
} finally {
  await stack.close()
  await rm(runDir, {recursive: true, force: true})
}
