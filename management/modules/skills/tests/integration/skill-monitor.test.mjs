import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { skillMonitorReport, skillMonitorWindow } from '../../server/skill-monitor.mjs'
import { startManagement } from '../../../../app/server/service.mjs'
import { listen, json } from '../../../../../runtime/http.mjs'

const now = Date.parse('2026-11-19T10:00:00Z')
const at = minutes => new Date(now - minutes * 60000).toISOString()

test('Skill 监控时间窗口切分与参数校验', () => {
  const w1h = skillMonitorWindow('1h', now)
  assert.equal(w1h.range, '1h')
  assert.equal(w1h.bucketMs, 300000)
  assert.equal(w1h.toMs - w1h.fromMs, 3600000)

  const w24h = skillMonitorWindow('24h', now)
  assert.equal(w24h.range, '24h')
  assert.equal(w24h.bucketMs, 300000)
  assert.equal(w24h.toMs - w24h.fromMs, 86400000)

  const w7d = skillMonitorWindow('7d', now)
  assert.equal(w7d.range, '7d')
  assert.equal(w7d.bucketMs, 3600000)
  assert.equal(w7d.toMs - w7d.fromMs, 604800000)

  assert.throws(() => skillMonitorWindow('30d', now))
})

test('Skill 监控指标计算、状态统计、组织分布与去重', async () => {
  const tickets = [
    // 成功下载
    {
      ticketNo: 'SKL-03-01',
      command: {
        ticketType: 'SKL-03',
        action: 'download',
        account: 'chen.yu',
        org: '业务一部',
        resourceId: 'skl_doc',
        payload: { version: 'v2.1.0', sha256: 'a'.repeat(64) },
        executionId: 'exec-1',
      },
      state: { status: 'succeeded', updatedAt: at(10) },
      resultId: 'DL-exec-1',
      delivery: { status: 'confirmed', updatedAt: at(10) },
    },
    // 相同账户重复成功下载同一资源 -> 去重计数为 1
    {
      ticketNo: 'SKL-03-02',
      command: {
        ticketType: 'SKL-03',
        action: 'download',
        account: 'chen.yu',
        org: '业务一部',
        resourceId: 'skl_doc',
        payload: { version: 'v2.1.0', sha256: 'a'.repeat(64) },
        executionId: 'exec-2',
      },
      state: { status: 'succeeded', updatedAt: at(20) },
      resultId: 'DL-exec-2',
      delivery: { status: 'confirmed', updatedAt: at(20) },
    },
    // 另一账户在不同组织成功下载
    {
      ticketNo: 'SKL-03-03',
      command: {
        ticketType: 'SKL-03',
        action: 'download',
        account: 'lin.jie',
        org: '经侦支队',
        resourceId: 'skl_sheet',
        payload: { version: 'v1.8.2', sha256: 'b'.repeat(64) },
        executionId: 'exec-3',
      },
      state: { status: 'succeeded', updatedAt: at(15) },
      resultId: 'DL-exec-3',
      delivery: { status: 'confirmed', updatedAt: at(15) },
    },
    // 失败下载
    {
      ticketNo: 'SKL-03-04',
      command: {
        ticketType: 'SKL-03',
        action: 'download',
        account: 'wu.fan',
        org: '网安支队',
        resourceId: 'skl_doc',
        payload: { version: 'v2.1.0', sha256: 'a'.repeat(64) },
        executionId: 'exec-4',
      },
      state: { status: 'failed', updatedAt: at(30) },
      resultId: 'DL-exec-4',
      delivery: { status: 'sending', updatedAt: at(30) },
    },
  ]

  const applications = [
    { ticketType: 'SKL-01', status: '待审批', applicantOrg: '业务一部' },
    { ticketType: 'SKL-02', status: '待审批', applicantOrg: '网安支队' },
    { ticketType: 'SKL-04', status: '已完成', applicantOrg: '经侦支队' },
  ]

  // 模拟能力端响应目录
  const mockCap = async () => ({
    ok: true,
    json: async () => ({
      items: [
        { resourceId: 'skl_doc', name: '公文摘要 Skill', version: 'v2.1.0', status: 'available', sizeBytes: 1024 },
        { resourceId: 'skl_sheet', name: '表格分析 Skill', version: 'v1.8.2', status: 'available', sizeBytes: 2048 },
      ],
    }),
  })

  const adminIdentity = {
    account: 'li.qiang',
    roles: ['admin'],
    org: '系统管理组',
  }

  const query = new URLSearchParams('window=24h&page=1&pageSize=10')
  const report = await skillMonitorReport({
    query,
    now,
    cap: mockCap,
    headers: {},
    identity: adminIdentity,
    tickets,
    applications,
    directory: { byAccount: acc => ({ name: acc === 'chen.yu' ? '陈宇' : acc === 'lin.jie' ? '林杰' : acc }) },
  })

  // 指标卡断言
  assert.equal(report.metrics.publishedCount, 2)
  assert.equal(report.metrics.versionCount, 2)
  assert.equal(report.metrics.storageBytes, 3072)
  assert.equal(report.metrics.pendingCount, 2)
  assert.equal(report.metrics.withdrawnCount, 1)
  assert.equal(report.metrics.deliveryFailures, 1)

  // 去重人数断言：chen.yu 与 lin.jie 两个成功账户
  assert.equal(report.uniqueAccounts, 2)

  // 组织分布断言：业务一部 2 次，经侦支队 1 次
  assert.equal(report.orgDistribution.length, 2)
  assert.equal(report.orgDistribution[0].name, '业务一部')
  assert.equal(report.orgDistribution[0].value, 2)
  assert.equal(report.orgDistribution[1].name, '经侦支队')
  assert.equal(report.orgDistribution[1].value, 1)

  // 下载明细断言
  assert.equal(report.deliveries.total, 4)
  assert.equal(report.deliveries.items.length, 4)
  assert.equal(report.deliveries.items[0].name, '陈宇')

  // 搜索关键字测试
  const searchReport = await skillMonitorReport({
    query: new URLSearchParams('window=24h&q=表格分析'),
    now,
    cap: mockCap,
    headers: {},
    identity: adminIdentity,
    tickets,
    applications,
    directory: { byAccount: () => null },
  })
  assert.equal(searchReport.deliveries.total, 1)
  assert.equal(searchReport.deliveries.items[0].skillId, 'skl_sheet')

  // 能力端未采集降级测试：不补零，标明 not_collected
  const failingCap = async () => { throw new Error('Network error') }
  const degradedReport = await skillMonitorReport({
    query: new URLSearchParams('window=24h'),
    now,
    cap: failingCap,
    headers: {},
    identity: adminIdentity,
    tickets: [],
    applications: [],
  })
  assert.equal(degradedReport.metrics.publishedCount, null)
  assert.equal(degradedReport.metrics.versionCount, null)
  assert.equal(degradedReport.metrics.storageBytes, null)
  assert.equal(degradedReport.metrics.storageFormatted, null)
  assert.equal(degradedReport.sources.catalog, 'not_collected')
})

test('Skill 监控 HTTP 权限控制、组织隔离与会话安全', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'skill-monitor-test-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  // 启动 mock 能力服务
  const capServer = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, {
        items: [
          { resourceId: 'skl_doc', name: '公文摘要 Skill', version: 'v2.1.0', status: 'available', sizeBytes: 100 },
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

  const login = async account => {
    const res = await fetch(mgmt.url + '/api/demo-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account }),
    })
    return res.headers.get('set-cookie')?.split(';')[0]
  }

  // 1. 普通用户登录访问被拒绝 403
  const userCookie = await login('chen.yu')
  const userRes = await fetch(mgmt.url + '/api/skill-monitor', {
    headers: { cookie: userCookie },
  })
  assert.equal(userRes.status, 403)

  // 2. 运维人员访问本人组织成功 200
  const opsCookie = await login('zhou.min')
  const opsRes = await fetch(mgmt.url + '/api/skill-monitor', {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsRes.status, 200)
  const opsData = await opsRes.json()
  assert.equal(opsData.sources.catalog, 'collected')

  // 3. 运维人员跨组织查询被拒绝 403
  const opsCrossRes = await fetch(mgmt.url + '/api/skill-monitor?org=其他非法组织', {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsCrossRes.status, 403)

  // 4. 管理员可访问全量数据 200
  const adminCookie = await login('li.qiang')
  const adminRes = await fetch(mgmt.url + '/api/skill-monitor', {
    headers: { cookie: adminCookie },
  })
  assert.equal(adminRes.status, 200)
  const adminData = await adminRes.json()
  assert.equal(adminData.sources.catalog, 'collected')
})
