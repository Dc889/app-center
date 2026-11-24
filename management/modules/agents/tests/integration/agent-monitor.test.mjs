import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentMonitorReport } from '../../server/agent-monitor.mjs'
import { startManagement } from '../../../../app/server/service.mjs'
import { listen, json } from '../../../../../runtime/http.mjs'

const now = Date.parse('2026-11-19T10:00:00Z')

test('智能体监控指标统计、开发账户树、过滤选项与调用记录', async () => {
  // 1. 管理员查询全量
  const report = await agentMonitorReport({
    query: new URLSearchParams('window=24h'),
    now,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
  })

  assert.equal(report.metrics.accountCount, 0)
  assert.equal(report.metrics.totalAppCount, 0)
  assert.equal(report.metrics.callCount, 0)
  assert.equal(report.accountGroups.length, 0)
  assert.equal(report.logs.items.length, 0)

  // 2. 账户过滤测试
  const chenReport = await agentMonitorReport({
    query: new URLSearchParams('account=chen.yu'),
    now,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
  })
  assert.equal(chenReport.logs.items.length, 0)

  // 3. 应用过滤测试
  const appReport = await agentMonitorReport({
    query: new URLSearchParams('appName=案件摘要助手'),
    now,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
  })
  assert.equal(appReport.logs.items.length, 0)

  // 4. 搜索测试
  const searchReport = await agentMonitorReport({
    query: new URLSearchParams('q=gpt-4.1'),
    now,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
  })
  assert.equal(searchReport.logs.items.length, 0)
  assert.equal(report.analysis.runDistribution, null)
  assert.equal(report.overview.difyAccountCount, null)
  assert.equal(report.overview.ragflowAccountCount, null)
  assert.equal(report.overview.warehouseAppCount, 0)
})

test('智能体监控按已采集调用划分次数和 token 区间', async () => {
  const cap = async path => {
    if (path.includes('/resources?kind=dify_app')) return { ok: true, json: async () => ({ items: [{ resourceId: 'app-hot', name: '高频助手', ownerAccount: 'chen.yu', data: { description: '摘要应用', versions: [{ version: 'v2', publishedAt: '2026-11-01T00:00:00Z' }] } }] }) }
    if (path.includes('/resources?kind=ragflow_account')) return { ok: true, json: async () => ({ items: [{ resourceId: 'rf-1' }, { resourceId: 'rf-2' }] }) }
    if (path.includes('/agent-invocations')) return { ok: true, json: async () => ({ availability: 'collected', profiles: [{ appId: 'app-hot', description: '摘要应用', versions: [{ version: 'v2', publishedAt: '2026-11-01T00:00:00Z' }] }], items: [
      { appId: 'app-hot', appName: '高频助手', time: '2026-11-19T09:00:00Z', sourceIp: '10.0.0.8', model: 'gpt', tokens: 12000 },
      { appId: 'app-hot', appName: '高频助手', time: '2026-11-19T09:10:00Z', sourceIp: '10.0.0.9', model: 'gpt', tokens: 3000 },
    ] }) }
    return { ok: false, json: async () => ({}) }
  }
  const report = await agentMonitorReport({
    query: new URLSearchParams('usageApp=app-hot'),
    now,
    cap,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
    applications: [],
  })
  assert.equal(report.overview.ragflowAccountCount, 2)
  assert.equal(report.overview.difyAppCount, 1)
  assert.equal(report.analysis.runDistribution.find(row => row.label === '小于1万').count, 1)
  assert.equal(report.analysis.tokenRanking[0].totalTokens, 15000)
  assert.equal(report.analysis.usage.ipDistribution.length, 2)
  assert.equal(report.analysis.usage.iterationCount, 1)
  assert.equal(report.analysis.usage.description, '摘要应用')
})

test('智能体监控 HTTP 鉴权与组织隔离', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-mon-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  const capServer = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, {
        items: [
          { resourceId: 'app_case_summary', name: '案件摘要助手', status: 'available' },
        ],
      })
    }
    return json(res, { error: { code: 'NOT_FOUND' } }, 404)
  }, { token: 'test-token' })
  t.after(async () => { await capServer.close() })

  const mgmt = await startManagement({
    dir,
    token: 'test-token',
    executor: capServer.url,
    now: () => now,
  })
  t.after(async () => { await mgmt.close() })

  const baseUrl = mgmt.url

  async function login(account) {
    const res = await fetch(`${baseUrl}/api/demo-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account }),
    })
    assert.equal(res.status, 200)
    return res.headers.get('set-cookie')?.split(';')[0] || ''
  }

  const userCookie = await login('chen.yu')      // 普通用户 (业务一部)
  const opsCookie = await login('zhou.min')       // 运维人员 (平台运营组)
  const adminCookie = await login('li.qiang')     // 系统管理员 (信息技术处)

  // 1. 普通用户访问拒绝 403
  const userRes = await fetch(`${baseUrl}/api/agent-monitor`, {
    headers: { cookie: userCookie },
  })
  assert.equal(userRes.status, 403)

  // 2. 运维人员跨组织查询拒绝 403
  const opsCrossRes = await fetch(`${baseUrl}/api/agent-monitor?org=${encodeURIComponent('业务一部')}`, {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsCrossRes.status, 403)

  // 3. 运维人员访问所属组织允许 200
  const opsRes = await fetch(`${baseUrl}/api/agent-monitor`, {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsRes.status, 200)
  const opsData = await opsRes.json()
  assert.ok(opsData.metrics)
  // 运维视角只看平台运营组的账户
  assert.ok(opsData.accountGroups.every(g => g.org === '平台运营组'))

  // 4. 管理员全量访问允许 200
  const adminRes = await fetch(`${baseUrl}/api/agent-monitor`, {
    headers: { cookie: adminCookie },
  })
  assert.equal(adminRes.status, 200)
  const adminData = await adminRes.json()
  assert.equal(adminData.accountGroups.length, 0)
})
