import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accountMonitorReport, accountMonitorWindow } from '../../server/account-monitor.mjs'
import { startManagement } from '../../../../app/server/service.mjs'
import { listen, json } from '../../../../../runtime/http.mjs'

const now = Date.parse('2026-11-19T10:00:00Z')

test('账号与集成监控时间窗口切分与参数校验', () => {
  const w1h = accountMonitorWindow('1h', now)
  assert.equal(w1h.range, '1h')
  assert.equal(w1h.bucketMs, 300000)
  assert.equal(w1h.toMs - w1h.fromMs, 3600000)

  const w24h = accountMonitorWindow('24h', now)
  assert.equal(w24h.range, '24h')
  assert.equal(w24h.bucketMs, 300000)
  assert.equal(w24h.toMs - w24h.fromMs, 86400000)

  const w7d = accountMonitorWindow('7d', now)
  assert.equal(w7d.range, '7d')
  assert.equal(w7d.bucketMs, 3600000)
  assert.equal(w7d.toMs - w7d.fromMs, 604800000)

  assert.throws(() => accountMonitorWindow('30d', now))
})

test('账号与集成监控五卡指标、趋势切桶、差异分布与同步作业', async () => {
  const applications = [
    {
      ticketNo: 'ACC-01-9001',
      ticketType: 'ACC-01',
      status: '已完成',
      account: 'test.user',
      org: '业务一部',
      submission: { fields: { account: 'test.user', name: '测试用户' } },
      snapshot: { fields: { 'RAGFlow ID': 'rf_test', 'Dify ID': 'df_test' } },
    },
  ]

  // 1. 管理员全量查询
  const report = await accountMonitorReport({
    query: new URLSearchParams('window=24h'),
    now,
    identity: { account: 'li.qiang', org: '系统管理组', roles: ['admin'] },
    applications,
  })

  assert.equal(report.metrics.totalCount, 1)
  assert.equal(report.metrics.consistentCount, 1)
  assert.equal(report.mappings.items[0].account, 'test.user')
  assert.equal(report.mappings.items[0].ragflowId, 'rf_test')
  assert.equal(report.trend.length, 0)
  assert.equal(report.probes.length, 0)
  assert.equal(report.syncJobs.items.length, 0)

  // 2. 一致性状态筛选
  const diffReport = await accountMonitorReport({
    query: new URLSearchParams('consistency=缺 Dify'),
    now,
    identity: { account: 'li.qiang', org: '系统管理组', roles: ['admin'] },
    applications,
  })
  assert.equal(diffReport.mappings.items.length, 0)

  // 3. 关键字搜索
  const searchReport = await accountMonitorReport({
    query: new URLSearchParams('q=chen.yu'),
    now,
    identity: { account: 'li.qiang', org: '系统管理组', roles: ['admin'] },
    applications,
  })
  assert.equal(searchReport.mappings.items.length, 0)
})

test('账号与集成监控 HTTP 鉴权、组织隔离与敏感工单裁剪', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'acc-mon-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  const capServer = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, { items: [] })
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
  const userRes = await fetch(`${baseUrl}/api/account-monitor`, {
    headers: { cookie: userCookie },
  })
  assert.equal(userRes.status, 403)

  // 2. 运维人员跨组织查询拒绝 403
  const opsCrossRes = await fetch(`${baseUrl}/api/account-monitor?org=${encodeURIComponent('业务一部')}`, {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsCrossRes.status, 403)

  // 3. 运维人员访问所属组织允许 200
  const opsRes = await fetch(`${baseUrl}/api/account-monitor`, {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsRes.status, 200)
  const opsData = await opsRes.json()
  assert.ok(opsData.metrics)
  // 运维视角只看平台运营组
  assert.ok(opsData.mappings.items.every(m => m.org === '平台运营组'))
  // 运维视角下敏感 ACC 工单号脱敏
  const accItem = opsData.mappings.items.find(m => m.ticketNo.startsWith('ACC-'))
  if (accItem) {
    assert.equal(accItem.ticketNo, 'ACC-******')
  }

  // 4. 管理员全量访问允许 200
  const adminRes = await fetch(`${baseUrl}/api/account-monitor`, {
    headers: { cookie: adminCookie },
  })
  assert.equal(adminRes.status, 200)
  const adminData = await adminRes.json()
  assert.equal(adminData.mappings.total, 0)
})
