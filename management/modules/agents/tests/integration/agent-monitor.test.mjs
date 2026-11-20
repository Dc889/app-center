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

  assert.ok(report.metrics.accountCount >= 7)
  assert.ok(report.metrics.totalAppCount >= 10)
  assert.ok(report.metrics.outsideAppCount >= 2)
  assert.ok(report.metrics.callCount >= 50)
  assert.ok(report.metrics.failedCallCount >= 1)

  // 账户应用树
  assert.ok(report.accountGroups.length >= 7)
  const chenGroup = report.accountGroups.find(g => g.account === 'chen.yu')
  assert.ok(chenGroup)
  assert.ok(chenGroup.apps.some(a => a.name === '案件摘要助手'))
  assert.ok(chenGroup.useCount > 0)

  // 选项集
  assert.ok(report.filterOptions.ipOptions.length > 0)
  assert.ok(report.filterOptions.modelOptions.length > 0)
  assert.ok(report.filterOptions.knowledgeOptions.length > 0)
  assert.ok(report.filterOptions.mcpOptions.length > 0)
  assert.ok(report.filterOptions.pluginOptions.length > 0)

  // 2. 账户过滤测试
  const chenReport = await agentMonitorReport({
    query: new URLSearchParams('account=chen.yu'),
    now,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
  })
  assert.ok(chenReport.logs.items.every(l => l.ownerAccount === 'chen.yu'))

  // 3. 应用过滤测试
  const appReport = await agentMonitorReport({
    query: new URLSearchParams('appName=案件摘要助手'),
    now,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
  })
  assert.ok(appReport.logs.items.every(l => l.appName === '案件摘要助手'))

  // 4. 搜索测试
  const searchReport = await agentMonitorReport({
    query: new URLSearchParams('q=gpt-4.1'),
    now,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
  })
  assert.ok(searchReport.logs.items.length > 0)
  assert.ok(searchReport.logs.items.every(l =>
    l.models.some(m => m.includes('gpt-4.1')) || l.modelLabels.some(m => m.includes('gpt-4.1'))
  ))
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
  assert.ok(adminData.accountGroups.length >= 7)
})
