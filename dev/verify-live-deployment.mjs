import {existsSync, readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {capabilityModules} from '../capability/app/modules.mjs'
import {createProofJournal, proofScope} from './live-verification/proofs.mjs'
import {liveProducts, skillArchive} from './live-verification/products.mjs'
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
delete process.env.CAPABILITY_EVIDENCE_FILE // Never inherit the evidence being checked.
process.env.RAGFLOW_EXTERNAL_ENDPOINT ??= 'http://host.docker.internal:9380/api/v1/dify'

const wsId = creds.dify.workspaceId
const runDir = await mkdtemp(join(tmpdir(), 'app-center-live-verify-'))
const stack = await localStack(runDir)

const products = liveProducts({dir: dataDir, credentials: creds})
const journal = createProofJournal({dir: dataDir, modules: capabilityModules, workspaceId: wsId, resourceRunId: products.runId})
let fixtureApps = [], fixtureDifyDataset, fixtureRagDataset, reviewTicket, alertTicket
const witness = (source, resourceId, assertion, observed = {}) => ({source, resourceId, assertion, observed, passed: true})
function records(module, name) {
  const file = join(runDir, `mod_${module}_${name}.sqlite`)
  if (!existsSync(file)) return []
  const db = new DatabaseSync(file, {readOnly: true})
  try {return db.prepare('SELECT body FROM records').all().map(row => JSON.parse(row.body))}
  finally {db.close()}
}
async function repository(kind, resourceId, suffix = '') {
  const res = await fetch(`${stack[kind]}/internal/v1/${kind === 'agent' ? 'agents' : kind === 'skill' ? 'skills' : 'plugins'}/${encodeURIComponent(resourceId)}${suffix}`, {headers: {authorization: `Bearer ${stack.token}`}})
  assert.equal(res.status, 200)
  return res.json()
}
async function readback(meta, before) {
  const id = fixtureApps[0].id
  if (meta.ticketType.startsWith('KEY-')) {
    const after = (await products.api('dify', `/console/api/apps/${id}/api-keys`)).data.map(row => row.id)
    if (meta.action === 'create_key') assert.equal(after.filter(key => !before.includes(key)).length, 1)
    else if (meta.action === 'rotate_key') {
      assert.equal(before.filter(key => !after.includes(key)).length, 1)
      assert.equal(after.filter(key => !before.includes(key)).length, 1)
    } else {assert.equal(before.filter(key => !after.includes(key)).length, 1); assert.equal(after.length, 0)}
    return [witness('Dify API key list', id, `key set transition: ${meta.action}`, {beforeKeyIds: before, afterKeyIds: after})]
  }
  if (meta.ticketType.startsWith('SKL-')) {
    const row = await repository('skill', 'skl-live-verify')
    assert.equal(row.status, meta.action === 'withdraw_skill' ? 'withdrawn' : 'available')
    if (meta.action === 'revise_skill') assert.ok((await repository('skill', row.resourceId, '/versions')).versions.length >= 2)
    // Download receipt is checked inside its scenario, including content digest and cancellation.
    return [witness('Skill repository readback', row.resourceId, `${meta.action}: status and persisted version`, {status: row.status, version: row.version, sha256: row.sha256, sizeBytes: row.sizeBytes})]
  }
  if (meta.ticketType.startsWith('AG-')) {
    const appId = meta.action === 'sync_app' ? fixtureApps[1].id : id
    const source = await products.api('dify', `/console/api/apps/${appId}`)
    assert.ok(source.workflow?.id)
    if (meta.action === 'sync_app') assert.ok(records('agents', 'synced-apps').some(row => row.resourceId === appId))
    else {
      const row = await repository('agent', id)
      assert.equal(row.status, meta.action === 'withdraw_app' ? 'withdrawn' : 'active')
      assert.equal(row.publicationVersionId, source.workflow.id)
      if (meta.action === 'republish') assert.ok(row.revision >= 2)
      if (meta.action === 'grant_app_access') assert.ok(records('agents', 'grants').find(row => row.catalogResourceId === id)?.items.includes('chen.yu'))
    }
    return [witness('Dify app and capability ledger readback', appId, meta.action, {sourceWorkflowId: source.workflow.id, catalog: meta.action === 'sync_app' ? records('agents', 'synced-apps').find(row => row.resourceId === appId) : await repository('agent', id)})]
  }
  if (meta.action === 'set_tool_approval') {
    const rows = records('tools', 'approvals')
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'approved')
    const providers = await products.api('dify', '/console/api/workspaces/current/tools/api')
    assert.ok(providers.some(provider => provider.tools?.some(tool => (tool.id || tool.name) === rows[0].toolId)))
    return [witness('Dify tool and approval ledger readback', rows[0].toolId, 'approved discovered real tool', {status: rows[0].status, fingerprint: rows[0].fingerprint, revision: rows[0].revision})]
  }
  if (meta.action === 'sync_dataset' || meta.action === 'publish_dataset') {
    const row = records('knowledge', 'datasets').find(row => row.sourceResourceId === fixtureDifyDataset)
    assert.ok(row)
    if (meta.action === 'publish_dataset') {assert.equal(row.status, '已发布'); assert.ok(row.documents.length > 0)}
    const docs = await products.api('dify', `/console/api/datasets/${fixtureDifyDataset}/documents`)
    assert.ok(docs.data.length > 0)
    return [witness('Dify documents and knowledge ledger readback', fixtureDifyDataset, meta.action, {catalogResourceId: row.resourceId, status: row.status, revision: row.revision, documentIds: docs.data.map(doc => doc.id), manifestSha256: row.manifestSha256})]
  }
  if (meta.ticketType === 'KB-03' && meta.variant === 'Dify同workspace授权') {
    const binding = records('knowledge', 'bindings').find(row => row.sourceResourceId === fixtureDifyDataset)
    assert.ok(binding?.productRef?.granteeAccountId)
    const product = await products.api('dify', `/console/api/datasets/${fixtureDifyDataset}`)
    assert.equal(product.permission, 'partial_members')
    assert.ok(product.partial_member_list.includes(binding.productRef.granteeAccountId))
    return [witness('Dify member ACL and owned binding readback', fixtureDifyDataset, 'retrieval grant only; application wiring remains unverified',
      {permission: product.permission, memberIds: product.partial_member_list, bindingId: binding.bindingId, addedMemberIds: binding.productRef.addedMemberIds})]
  }
  if (['review_dataset_changes', 'pause_share', 'dispose_dataset'].includes(meta.action)) {
    const row = records('knowledge', 'datasets').find(item => item.sourceResourceId === fixtureDifyDataset)
    const docs = await products.api('dify', `/console/api/datasets/${fixtureDifyDataset}/documents`)
    const source = await products.api('dify', `/console/api/datasets/${fixtureDifyDataset}`)
    if (meta.action === 'review_dataset_changes') {
      assert.equal(row.lastReviewVerdict, '通过'); assert.equal(row.status, '已发布'); assert.equal(row.documents.length, 2)
    } else if (meta.action === 'pause_share') {
      assert.equal(row.status, '暂停分享'); assert.ok(docs.data.every(doc => doc.enabled)); assert.equal(source.permission, 'partial_members')
    } else {
      assert.equal(row.status, '已下架'); assert.ok(docs.data.length === 2 && docs.data.every(doc => doc.enabled === false))
      const bindings = records('knowledge', 'bindings').filter(binding => binding.sourceResourceId === fixtureDifyDataset)
      assert.equal(bindings.length, 1); assert.equal(bindings[0].status, 'revoked'); assert.equal(source.permission, 'only_me')
    }
    return [witness('Knowledge catalog, Dify documents and native ACL readback', fixtureDifyDataset, meta.action,
      {catalogResourceId: row.resourceId, status: row.status, revision: row.revision, permission: source.permission,
        documents: docs.data.map(doc => ({id: doc.id, enabled: doc.enabled})), manifestSha256: row.manifestSha256})]
  }
  // Unimplemented postconditions cannot silently promote a successful HTTP response.
  return []
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
  meta = {...meta, workspaceId: proofScope(meta.ticketType, wsId)}
  try {
    if (meta.ticketType.startsWith('MCP-')) throw Object.assign(new Error('缺少真实模型中心技术注册及连接核验'), {code: 'MODEL_CENTER_UNCONFIGURED'})
    if (meta.ticketType.startsWith('PLG-')) throw Object.assign(new Error('缺少真实可安装 difypkg；不使用 JSON 改扩展名冒充安装包'), {code: 'REAL_PLUGIN_PACKAGE_REQUIRED'})
    if (meta.ticketType === 'KB-03' && meta.variant !== 'Dify同workspace授权') throw Object.assign(new Error('授权范围和外部检索效果尚待独立读回核验'), {code: 'BINDING_EFFECT_NOT_VERIFIED'})
    const before = meta.ticketType.startsWith('KEY-') ? (await products.api('dify', `/console/api/apps/${fixtureApps[0].id}/api-keys`)).data.map(row => row.id) : null
    const detail = await fn()
    const witnesses = meta.ticketType === 'EVT-01' ? [] : await readback(meta, before)
    if (meta.ticketType === 'KB-03') {
      journal.record(meta, {ok: false, reasonCode: 'TARGET_APPLICATION_BINDING_UNIMPLEMENTED', detail, witnesses})
      console.log(`[PARTIAL] ${meta.ticketType}/${meta.variant}: native retrieval ACL proven; full branch remains unverified`)
      return
    }
    journal.record(meta, {ok: true, detail, witnesses})
    console.log(`[${witnesses.length || meta.ticketType === 'EVT-01' ? 'PASS' : 'UNVERIFIED'}] ${meta.ticketType}/${meta.action}`)
  } catch (err) {
    journal.record(meta, {reasonCode: err.code === 'ERR_ASSERTION' ? 'STATE_READBACK_FAILED' : typeof err.code === 'string' ? err.code : 'CHECK_FAILED', detail: String(err.message).replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').replace(/app-[A-Za-z0-9]{20,}/g, '[redacted key]')})
    console.log(`[UNVERIFIED] ${meta.ticketType}/${meta.action}: ${err.code ?? 'CHECK_FAILED'}`)
  }
}

try {
  fixtureApps = [await products.app(), await products.app()]
  fixtureDifyDataset = await products.dataset('dify')
  fixtureRagDataset = await products.dataset('ragflow')
  const difyOwner = fixtureApps[0].created_by
  const ragSource = await products.api('ragflow', `/api/v1/datasets?id=${fixtureRagDataset}`)
  assert.ok(difyOwner && ragSource.data[0]?.created_by)
  process.env.DIFY_OWNER_ACCOUNT_MAP = JSON.stringify({[difyOwner]: 'chen.yu'})
  process.env.RAGFLOW_OWNER_ACCOUNT_MAP = JSON.stringify({[ragSource.data[0].created_by]: 'chen.yu'})
  // Replace only the in-memory run selection; the saved product inventory is unchanged.
  creds.dify.appIds = fixtureApps.map(app => ({id: app.id}))
  creds.dify.datasets = [{id: fixtureDifyDataset}]
  creds.ragflow.datasets = [{id: fixtureRagDataset}]
  const userCookie = await login('chen.yu')
  const opCookie = await login('zhou.min')
  const op2Cookie = await login('wang.ning')

  // --- 1. SKL-01 / SKL-02 / SKL-03 / SKL-04 (本地真实 Skill 仓库 + 交付取消) ---
  let skillId = 'skl-live-verify'
  let skillIntake1 = null
  await runCheck({ticketType: 'SKL-01', action: 'publish_skill'}, async () => {
    const form = new FormData()
    form.append('file', new Blob([skillArchive('1')], {type: 'application/octet-stream'}), 'live-skill-v1.tar.gz')
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
    form.append('file', new Blob([skillArchive('2')], {type: 'application/octet-stream'}), 'live-skill-v2.tar.gz')
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
    const delivered = Buffer.from(await dl.arrayBuffer())
    assert.ok(delivered.equals(skillArchive('2')))
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

  // --- 8. AG-01 / AG-04 (真实 Dify 应用纳管同步、再发布) ---
  const agApp2 = creds.dify.appIds[1].id
  await runCheck({ticketType: 'AG-01', action: 'sync_app'}, async () => {
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'AG-01-live-1',
      ticketType: 'AG-01',
      resourceId: agApp2,
      workspaceId: wsId,
      fields: {},
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const done = await waitApp('AG-01-live-1', userCookie, 'mine')
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `synced real Dify 1.7.1 app ${agApp2}`
  })

  await runCheck({ticketType: 'AG-04', action: 'republish'}, async () => {
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'AG-04-live-1',
      ticketType: 'AG-04',
      resourceId: firstAppId,
      workspaceId: wsId,
      fields: {changeDescription: '真机再发布验证'},
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'AG-04-live-1',
      revision: app.revision,
      action: '批准',
      note: '批准再发布',
      riskDecision: 'continue',
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('AG-04-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `republished ${firstAppId}`
  })

  // --- 9. KB-01 ~ KB-05 (真实 Dify 1.7.1 + RAGFlow 0.22.1 知识库) ---
  async function syncDataset(no, sourceSystem, resourceId, scopeId) {
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: no,
      ticketType: 'KB-01',
      resourceId,
      workspaceId: scopeId,
      fields: {sourceSystem},
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const done = await waitApp(no, userCookie, 'mine')
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return done.execution.result.resultId
  }
  let difyKbId = null
  let ragKbId = null
  await runCheck({ticketType: 'KB-01', action: 'sync_dataset'}, async () => {
    difyKbId = await syncDataset('KB-01-live-dify', 'Dify', creds.dify.datasets[0].id, wsId)
    ragKbId = await syncDataset('KB-01-live-rag', 'RAGFlow', creds.ragflow.datasets[0].id, creds.ragflow.tenantId)
    return `synced Dify ${difyKbId} + RAGFlow ${ragKbId}`
  })

  await runCheck({ticketType: 'KB-02', action: 'publish_dataset'}, async () => {
    if (!difyKbId) throw new Error('missing difyKbId')
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'KB-02-live-1',
      ticketType: 'KB-02',
      resourceId: difyKbId,
      workspaceId: wsId,
      fields: {
        sourceSystem: 'Dify',
        shareMode: '共享目录',
        purpose: '供业务检索使用',
        name: '真机联调法规知识库',
        description: '真机发布验证',
        tags: ['真机'],
        boundaryOrgs: ['业务一部'],
        classification: '内部',
        businessLine: '法制研判',
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    const confirmations = (app.snapshot?.fields?.['文档审查明细'] ?? []).map(d => ({documentId: d.documentId, sha256: d.sha256, verdict: '通过'}))
    const ap = await reqApi('/api/applications/transition', opCookie, {
      ticketNo: 'KB-02-live-1',
      revision: app.revision,
      action: '批准',
      note: '逐文档复核通过',
      confirmations,
    })
    if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    const done = await waitApp('KB-02-live-1', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `published ${difyKbId}`
  })

  await runCheck({ticketType: 'KB-03', action: 'bind_dataset', variant: 'Dify同workspace授权'}, async () => {
    if (!difyKbId) throw new Error('missing difyKbId')
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'KB-03-live-same',
      ticketType: 'KB-03',
      resourceId: difyKbId,
      workspaceId: wsId,
      fields: {
        purpose: '同区绑定知识库',
        permission: '检索使用',
        startsAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    if (app.status === '待受理') {
      const ap = await reqApi('/api/applications/transition', opCookie, {ticketNo: 'KB-03-live-same', revision: app.revision, action: '批准', note: '同意绑定'})
      if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    }
    const done = await waitApp('KB-03-live-same', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution)}`)
    return `same-workspace bind ${difyKbId}`
  })

  await runCheck({ticketType: 'KB-03', action: 'bind_dataset', variant: 'RAGFlow外部知识库'}, async () => {
    if (!ragKbId) throw new Error('missing ragKbId')
    const sub = await reqApi('/api/applications', userCookie, {
      ticketNo: 'KB-03-live-rag',
      ticketType: 'KB-03',
      resourceId: ragKbId,
      workspaceId: wsId,
      fields: {
        purpose: '以外部知识库接入 RAGFlow',
        permission: '检索使用',
        startsAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    })
    if (sub.status !== 201) throw new Error(`submit ${sub.status}: ${await sub.text()}`)
    const app = await sub.json()
    if (app.status === '待受理') {
      const ap = await reqApi('/api/applications/transition', opCookie, {ticketNo: 'KB-03-live-rag', revision: app.revision, action: '批准', note: '同意接入'})
      if (ap.status !== 200) throw new Error(`approve ${ap.status}: ${await ap.text()}`)
    }
    const done = await waitApp('KB-03-live-rag', opCookie)
    if (done?.execution?.status !== 'succeeded') throw new Error(`exec ${JSON.stringify(done?.execution?.result)}`)
    return `RAGFlow external bind ${ragKbId}`
  })

  // --- 10. Real change -> owner submission -> per-document review -> pause -> native disposal ---
  await runCheck({ticketType: 'KB-04', action: 'review_dataset_changes'}, async () => {
    assert.ok(difyKbId)
    await products.addDifyDocument(fixtureDifyDataset, 'review-change')
    const event = await fetch(stack.management + '/internal/v1/dataset-changes', {
      method: 'POST', headers: {authorization: `Bearer ${stack.token}`, 'content-type': 'application/json'},
      body: JSON.stringify({sourceEventId: `change-${products.runId}`, resourceId: difyKbId}),
    })
    if (event.status !== 201) throw new Error(`change event HTTP ${event.status}: ${await event.text()}`)
    let row = await event.json(); reviewTicket = row
    const submit = await reqApi('/api/applications/transition', userCookie, {ticketNo: row.ticketNo, revision: row.revision,
      action: '提交变更审查', note: '本轮隔离测试新增真实文档'})
    if (submit.status !== 200) throw new Error(`owner review submit HTTP ${submit.status}: ${await submit.text()}`)
    row = await submit.json()
    const confirmations = row.snapshot.fields['文档审查明细'].map(doc => ({documentId: doc.documentId, sha256: doc.sha256, verdict: '通过'}))
    assert.equal(confirmations.length, 1)
    const approve = await reqApi('/api/applications/transition', opCookie, {ticketNo: row.ticketNo, revision: row.revision,
      action: '确认审查', note: '核验新增测试文档和源指纹', reviewVerdict: '通过', confirmations})
    if (approve.status !== 200) throw new Error(`document review HTTP ${approve.status}: ${await approve.text()}`)
    const done = await waitApp(row.ticketNo, opCookie)
    assert.equal(done?.execution?.status, 'succeeded'); assert.ok(!done.deliveryBlocked)
    assert.equal(done.execution.result.details.values['新目录状态'], '保持发布')
    return 'real indexed document addition -> owner -> operator confirmation -> persisted manifest and canonical result'
  })

  await runCheck({ticketType: 'KB-05', action: 'pause_share'}, async () => {
    assert.ok(reviewTicket?.snapshot?.fields?.['处置证据事件ID'])
    const alert = await fetch(stack.management + '/internal/v1/dataset-alerts', {
      method: 'POST', headers: {authorization: `Bearer ${stack.token}`, 'content-type': 'application/json'},
      body: JSON.stringify({sourceEventId: reviewTicket.snapshot.fields['处置证据事件ID'], resourceId: difyKbId,
        fields: {target: '整库', documentIds: [], reason: '内容违规', facts: '隔离测试目录与文档的原生处置验收'}}),
    })
    if (alert.status !== 201) throw new Error(`alert HTTP ${alert.status}: ${await alert.text()}`)
    const row = await alert.json()
    alertTicket = await waitApp(row.ticketNo, opCookie)
    assert.equal(alertTicket?.execution?.status, 'succeeded'); assert.ok(!alertTicket.deliveryBlocked)
    assert.equal(alertTicket.status, '待运维确认')
    return 'trusted alert -> pause node -> platform sharing paused; native documents unchanged until approved disposal'
  })

  await runCheck({ticketType: 'KB-05', action: 'dispose_dataset'}, async () => {
    assert.ok(alertTicket)
    const approve = await reqApi('/api/applications/transition', opCookie, {ticketNo: alertTicket.ticketNo, revision: alertTicket.revision,
      action: '批准', note: '逐项核对原生文档停用及本次授权撤销', dispositionActions: ['目录下架', '撤销未到期授权', '停用文档'], recoveryCondition: '重新核验后另行发布'})
    if (approve.status !== 200) throw new Error(`disposal HTTP ${approve.status}: ${await approve.text()}`)
    const done = await waitApp(alertTicket.ticketNo, opCookie)
    assert.equal(done?.execution?.status, 'succeeded'); assert.ok(!done.deliveryBlocked)
    assert.equal(done.execution.result.details['已执行节点数'], 4)
    return 'approved native member delta revoked + both real documents disabled + catalog withdrawn; all effects read back'
  })

  const summary = journal.save()
  console.log(`\n部署分支核验：${summary.verified}/${summary.total} verified；其余明确未核验。EVT 另计。`)
  if (summary.verified !== summary.total) process.exitCode = 1
} finally {
  const cleaned = await products.close()
  if (!cleaned) {
    journal.invalidate('CLEANUP_FAILED')
    console.error('测试资源清理未全部通过，请按 live-resources 日志查证。')
    process.exitCode = 1
  }
  journal.save()
  await stack.close()
  await rm(runDir, {recursive: true, force: true})
}
