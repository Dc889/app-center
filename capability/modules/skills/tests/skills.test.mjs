import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {capabilityModule} from '../public.mjs'
import {createRegistry} from '../../../platform/registry/public.mjs'
import {startExecutionServer} from '../../../platform/execution/public.mjs'
import {startSkill} from '../../../repositories/skill/public.mjs'
import {listen, json} from '../../../../runtime/http.mjs'

const DOC_SHA256 = '656085df494bea2c4bec3c08e164ff66927cd3373abbc3b6e1e5451ffcf0a1e1'

test('skills 模块导出结构契约与动作登记', () => {
  assert.equal(capabilityModule.id, 'skills')
  assert.equal(Array.isArray(capabilityModule.actions), true)
  assert.equal(capabilityModule.actions.length, 4)
  const downloadAction = capabilityModule.actions.find(a => a.action === 'download')
  assert.ok(downloadAction)
  assert.equal(downloadAction.ticketType, 'SKL-03')
  assert.equal(downloadAction.ticketTypeVersion, '1')
  assert.equal(typeof downloadAction.execute, 'function')
  assert.equal(typeof downloadAction.cancel, 'function')
})

test('skills download 动作调用仓库建立交付预留', async () => {
  const downloadAction = capabilityModule.actions.find(a => a.action === 'download')
  const mockCalls = []
  const mockSkill = async (path, method, body, headers) => {
    mockCalls.push({path, method, body, headers})
    return {
      json: async () => ({
        resultId: 'DL-test-exec',
        version: 'v2.1.0',
        sha256: DOC_SHA256,
        filename: 'skl_doc.txt',
        sizeBytes: 99,
      }),
    }
  }

  const command = {
    executionId: 'exec-skill-01',
    resourceId: 'skl_doc',
    account: 'chen.yu',
    org: '业务一部',
    payload: {version: 'v2.1.0', sha256: DOC_SHA256},
  }
  const state = {status: 'queued', delivery: null}

  await downloadAction.execute({command, state, skill: mockSkill})

  assert.equal(state.status, 'awaiting_delivery')
  assert.ok(state.delivery)
  assert.equal(state.delivery.resultId, 'DL-test-exec')
  assert.equal(mockCalls.length, 1)
  assert.equal(mockCalls[0].path, '/deliveries')
  assert.equal(mockCalls[0].method, 'POST')
  assert.equal(mockCalls[0].headers['Idempotency-Key'], 'exec-skill-01:reserve')
})

test('skills 目录与候选资源读取', async () => {
  const resItems = await capabilityModule.resources.skill()
  assert.ok(Array.isArray(resItems))
  assert.ok(resItems.some(i => i.resourceId === 'skl_doc'))

  let catalogResult = null
  const mockReq = {url: 'http://localhost/catalog?kind=skill', headers: {}}
  const mockRes = {
    writeHead() {},
    end(str) {
      catalogResult = JSON.parse(str)
    },
  }
  const mockSkill = async () => ({
    json: async () => ({
      items: [{resourceId: 'skl_doc', name: '公文摘要 Skill', version: 'v2.1.0', sha256: 'abc', sizeBytes: 99, orgs: []}],
    }),
  })

  await capabilityModule.catalogs.skill.list({
    req: mockReq,
    res: mockRes,
    query: new URLSearchParams('kind=skill'),
    skill: mockSkill,
  })

  assert.ok(catalogResult)
  assert.ok(Array.isArray(catalogResult.items))
  assert.equal(catalogResult.items[0].resourceId, 'skl_doc')
})

test('SKL-03/download 取消闭环：联动管理端关闭与仓库作废预留，已取消拒绝拉取且已交付拒绝取消', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'skills-cancel-'))
  const skillRepo = await startSkill({dir, token: 'tok'})
  let blockClose = false
  const closeCalls = []
  const mgmt = await listen(
    (req, res, path) => {
      if (path.startsWith('/internal/v1/delivery-checks/') && path.endsWith('/close')) {
        closeCalls.push(path)
        if (blockClose) return json(res, {error: {code: 'DELIVERY_IN_PROGRESS'}}, 409)
        return json(res, {closed: true})
      }
      return json(res, {error: {code: 'NOT_FOUND'}}, 404)
    },
    {token: 'tok'},
  )
  const registry = createRegistry([capabilityModule], {
    actions: {'SKL-01': ['publish_skill'], 'SKL-02': ['revise_skill'], 'SKL-03': ['download'], 'SKL-04': ['withdraw_skill']},
    evidence: () => [],
  })
  const server = await startExecutionServer({dir, token: 'tok', skill: skillRepo.url, management: mgmt.url}, registry)
  t.after(async () => {
    await server.close()
    await skillRepo.close()
    await mgmt.close()
    await rm(dir, {recursive: true, force: true})
  })

  const headers = {
    authorization: 'Bearer tok',
    'content-type': 'application/json',
    'x-account': 'chen.yu',
    'x-org': encodeURIComponent('业务一部'),
  }
  const post = (path, data) => fetch(server.url + '/internal/v1' + path, {method: 'POST', headers, body: JSON.stringify(data)})

  // 1. 建立下载预留
  const exec1 = await (
    await post('/executions', {
      executionId: 'skl-cancel-1',
      ticketNo: 'SKL-03-c1',
      ticketType: 'SKL-03',
      ticketTypeVersion: '1',
      action: 'download',
      resourceId: 'skl_doc',
      account: 'chen.yu',
      org: '业务一部',
      payload: {version: 'v2.1.0', sha256: DOC_SHA256},
    })
  ).json()
  assert.equal(exec1.status, 'awaiting_delivery')
  const resultId = exec1.delivery.resultId

  // 2. 若管理端正在发送文件（返回 409），取消被阻止且状态不变
  blockClose = true
  assert.equal((await post('/executions/skl-cancel-1/cancel', {})).status, 409)
  blockClose = false

  // 3. 正常取消：关闭管理端检查 + 作废仓库预留 + 进入 cancelled 终态
  const cancelledResp = await post('/executions/skl-cancel-1/cancel', {})
  assert.equal(cancelledResp.status, 200)
  const cancelled = await cancelledResp.json()
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.delivery, null)
  assert.equal(cancelled.result.failureCode, 'CANCELLED_BEFORE_DELIVERY')
  assert.ok(cancelled.result.details.cancelledAt)
  assert.ok(closeCalls.includes(`/internal/v1/delivery-checks/${resultId}/close`))

  // 4. 已取消后再次取消返回 409，且仓库拒绝再拉取该预留文件
  assert.equal((await post('/executions/skl-cancel-1/cancel', {})).status, 409)
  const fileAfterCancel = await fetch(skillRepo.url + `/internal/v1/deliveries/${resultId}/file`, {
    headers: {authorization: 'Bearer tok'},
  })
  assert.equal(fileAfterCancel.status, 409)
})

test('SKL-01/02/04 全生命周期：上传扫描、上架、版本变更再审、历史下载策略、统计上下文与下架留存审计副本', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'skills-lifecycle-'))
  const skillRepo = await startSkill({dir, token: 'tok'})
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
    actions: {'SKL-01': ['publish_skill'], 'SKL-02': ['revise_skill'], 'SKL-03': ['download'], 'SKL-04': ['withdraw_skill']},
    evidence: () => [],
  })
  const server = await startExecutionServer({dir, token: 'tok', skill: skillRepo.url, management: mgmt.url}, registry)
  t.after(async () => {
    await server.close()
    await skillRepo.close()
    await mgmt.close()
    await rm(dir, {recursive: true, force: true})
  })

  const multipart = (filename, content) => {
    const boundary = '----SkillTestBoundary'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from(content),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    return {contentType: `multipart/form-data; boundary=${boundary}`, body}
  }

  const hdr = ({account = 'chen.yu', role = 'user', org = '业务一部', extra = {}} = {}) => ({
    authorization: 'Bearer tok',
    'x-account': account,
    'x-role': role,
    'x-org': encodeURIComponent(org),
    ...extra,
  })

  // 1. CAP-SKL-03: 恶意特征包被扫描拒绝
  const badPkg = multipart('bad.txt', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
  const badUpload = await (
    await fetch(server.url + '/internal/v1/intake/skill', {
      method: 'POST',
      headers: hdr({extra: {'content-type': badPkg.contentType, 'idempotency-key': 'k-bad'}}),
      body: badPkg.body,
    })
  ).json()
  assert.equal(badUpload.status, 'rejected')

  // 2. 合法包上传 + 幂等重放 + 他人不可读取
  const pkg1 = multipart('law-skill-v1.txt', 'law skill version 1 payload')
  const up1 = await (
    await fetch(server.url + '/internal/v1/intake/skill', {
      method: 'POST',
      headers: hdr({extra: {'content-type': pkg1.contentType, 'idempotency-key': 'k-v1'}}),
      body: pkg1.body,
    })
  ).json()
  assert.equal(up1.status, 'ready')
  const up1Replay = await (
    await fetch(server.url + '/internal/v1/intake/skill', {
      method: 'POST',
      headers: hdr({extra: {'content-type': pkg1.contentType, 'idempotency-key': 'k-v1'}}),
      body: pkg1.body,
    })
  ).json()
  assert.equal(up1Replay.intakeId, up1.intakeId)
  assert.equal((await fetch(server.url + `/internal/v1/intake/skill/${up1.intakeId}`, {headers: hdr({account: 'other.user'})})).status, 404)
  const intake1 = await (await fetch(server.url + `/internal/v1/intake/skill/${up1.intakeId}`, {headers: hdr()})).json()
  assert.equal(intake1.scan.verdict, 'passed')

  // 3. CAP-SKL-04: SKL-01 上架发布 + 目录详情/版本查询
  approvedInputs.set('exec-pub-1', {
    decisionRef: 'dec-pub-1',
    ticketType: 'SKL-01',
    action: 'publish_skill',
    resourceId: 'skl_law',
    fields: {
      intakeId: intake1.intakeId,
      'Skill名称': '法律法规速查 Skill',
      '版本号': 'v1.0.0',
      '审批文件指纹': intake1.sha256,
      '公开方式': '全员公开',
      '作者账户名': 'chen.yu',
    },
    preconditions: [{kind: 'skill', id: 'skl_law', revision: 0}],
  })
  const pubState = await (
    await fetch(server.url + '/internal/v1/executions', {
      method: 'POST',
      headers: hdr({extra: {'content-type': 'application/json'}}),
      body: JSON.stringify({
        executionId: 'exec-pub-1',
        ticketNo: 'SKL-01-law',
        ticketType: 'SKL-01',
        ticketTypeVersion: '1',
        action: 'publish_skill',
        resourceId: 'skl_law',
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-pub-1'},
      }),
    })
  ).json()
  assert.equal(pubState.status, 'succeeded')
  assert.equal(pubState.result.version, 'v1.0.0')

  const catDetail = await (await fetch(server.url + '/internal/v1/catalog/skill/skl_law', {headers: hdr()})).json()
  assert.equal(catDetail.data.version, 'v1.0.0')
  assert.ok(catDetail.actions.includes('download'))
  const catVersions = await (await fetch(server.url + '/internal/v1/catalog/skill/skl_law/versions', {headers: hdr()})).json()
  assert.equal(catVersions.versions.length, 1)

  // 4. CAP-SKL-05: SKL-02 上下文 + 变更再审（禁止历史版本下载）
  const ctx02 = await (await fetch(server.url + '/internal/v1/execution-contexts/SKL-02?action=revise_skill&resourceId=skl_law', {headers: hdr()})).json()
  assert.equal(ctx02.fields['原版本号'], 'v1.0.0')
  assert.equal(ctx02.fields['原文件SHA-256'], intake1.sha256)
  assert.deepEqual(ctx02.preconditions, [{kind: 'skill', id: 'skl_law', revision: 1}])

  const pkg2 = multipart('law-skill-v2.txt', 'law skill version 2 updated payload')
  const up2 = await (
    await fetch(server.url + '/internal/v1/intake/skill', {
      method: 'POST',
      headers: hdr({extra: {'content-type': pkg2.contentType, 'idempotency-key': 'k-v2'}}),
      body: pkg2.body,
    })
  ).json()
  const intake2 = await (await fetch(server.url + `/internal/v1/intake/skill/${up2.intakeId}`, {headers: hdr()})).json()

  approvedInputs.set('exec-rev-1', {
    decisionRef: 'dec-rev-1',
    ticketType: 'SKL-02',
    action: 'revise_skill',
    resourceId: 'skl_law',
    fields: {
      intakeId: intake2.intakeId,
      '原版本号': 'v1.0.0',
      '新版本号': 'v2.0.0',
      '新文件SHA-256': intake2.sha256,
      '历史版本下载策略': '禁止历史版本下载',
    },
    preconditions: [{kind: 'skill', id: 'skl_law', revision: 1}],
  })
  const revState = await (
    await fetch(server.url + '/internal/v1/executions', {
      method: 'POST',
      headers: hdr({extra: {'content-type': 'application/json'}}),
      body: JSON.stringify({
        executionId: 'exec-rev-1',
        ticketNo: 'SKL-02-law',
        ticketType: 'SKL-02',
        ticketTypeVersion: '1',
        action: 'revise_skill',
        resourceId: 'skl_law',
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-rev-1'},
      }),
    })
  ).json()
  assert.equal(revState.status, 'succeeded')
  assert.equal(revState.result.version, 'v2.0.0')

  const v1Info = await (await fetch(server.url + '/internal/v1/catalog/skill/skl_law?version=v1.0.0', {headers: hdr()})).json()
  assert.equal(v1Info.status, 'unavailable')

  // 5. CAP-SKL-06: SKL-04 上下文 + 下架保留审计副本并禁止新下载
  const ctx04 = await (await fetch(server.url + '/internal/v1/execution-contexts/SKL-04?action=withdraw_skill&resourceId=skl_law', {headers: hdr()})).json()
  assert.equal(ctx04.fields['Skill名称'], '法律法规速查 Skill')
  assert.equal(ctx04.fields['当前版本号'], 'v2.0.0')
  assert.equal(ctx04.fields['历史下载次数'], 0)
  assert.deepEqual(ctx04.preconditions, [{kind: 'skill', id: 'skl_law', revision: 2}])

  approvedInputs.set('exec-wd-1', {
    decisionRef: 'dec-wd-1',
    ticketType: 'SKL-04',
    action: 'withdraw_skill',
    resourceId: 'skl_law',
    fields: {},
    preconditions: [{kind: 'skill', id: 'skl_law', revision: 2}],
  })
  const wdState = await (
    await fetch(server.url + '/internal/v1/executions', {
      method: 'POST',
      headers: hdr({extra: {'content-type': 'application/json'}}),
      body: JSON.stringify({
        executionId: 'exec-wd-1',
        ticketNo: 'SKL-04-law',
        ticketType: 'SKL-04',
        ticketTypeVersion: '1',
        action: 'withdraw_skill',
        resourceId: 'skl_law',
        account: 'chen.yu',
        org: '业务一部',
        payload: {decisionRef: 'dec-wd-1'},
      }),
    })
  ).json()
  assert.equal(wdState.status, 'succeeded')
  assert.equal(wdState.result.details.status, 'withdrawn')
  assert.equal(wdState.result.details.auditCopyPreserved, true)

  // 下架后尝试新下载被拒
  const dlAfterWd = await (
    await fetch(server.url + '/internal/v1/executions', {
      method: 'POST',
      headers: hdr({extra: {'content-type': 'application/json'}}),
      body: JSON.stringify({
        executionId: 'exec-dl-after-wd',
        ticketNo: 'SKL-03-blocked',
        ticketType: 'SKL-03',
        ticketTypeVersion: '1',
        action: 'download',
        resourceId: 'skl_law',
        account: 'chen.yu',
        org: '业务一部',
        payload: {version: 'v2.0.0', sha256: intake2.sha256},
      }),
    })
  ).json()
  assert.equal(dlAfterWd.status, 'failed')
  assert.equal(dlAfterWd.result.failureCode, 'ACCESS_DENIED')
})
