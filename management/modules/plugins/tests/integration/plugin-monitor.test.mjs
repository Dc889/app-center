import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pluginMonitorReport, pluginMonitorWindow } from '../../server/plugin-monitor.mjs'
import { startManagement } from '../../../../app/server/service.mjs'
import { listen, json } from '../../../../../runtime/http.mjs'

const now = Date.parse('2026-11-19T10:00:00Z')
const at = minutes => new Date(now - minutes * 60000).toISOString()

test('插件监控时间窗口切分与参数校验', () => {
  const w1h = pluginMonitorWindow('1h', now)
  assert.equal(w1h.range, '1h')
  assert.equal(w1h.bucketMs, 300000)
  assert.equal(w1h.toMs - w1h.fromMs, 3600000)

  const w24h = pluginMonitorWindow('24h', now)
  assert.equal(w24h.range, '24h')
  assert.equal(w24h.bucketMs, 300000)
  assert.equal(w24h.toMs - w24h.fromMs, 86400000)

  const w7d = pluginMonitorWindow('7d', now)
  assert.equal(w7d.range, '7d')
  assert.equal(w7d.bucketMs, 3600000)
  assert.equal(w7d.toMs - w7d.fromMs, 604800000)

  assert.throws(() => pluginMonitorWindow('30d', now))
})

test('插件监控指标计算、自动禁用记录、安装实例与错误排行', async () => {
  const applications = [
    // PLG-03 安装实例（运行中）
    {
      ticketNo: 'PLG-03-01',
      ticketType: 'PLG-03',
      status: '已完成',
      account: 'chen.yu',
      org: '业务一部',
      resourceId: 'document-parser',
      workspaceId: 'ws_84f2',
      createdAt: at(40),
      snapshot: {
        fields: {
          '插件名称': 'document-parser',
          '版本号': '2.4.1',
          '安装实例ID': 'inst-dp-01',
          'workspace ID': 'ws_84f2',
        },
      },
      submission: { fields: { name: 'document-parser', operation: '安装' } },
    },
    // PLG-03 安装实例（待升级）
    {
      ticketNo: 'PLG-03-02',
      ticketType: 'PLG-03',
      status: '待审批',
      account: 'chen.yu',
      org: '业务一部',
      resourceId: 'browser-agent',
      workspaceId: 'ws_291a',
      createdAt: at(30),
      snapshot: {
        fields: {
          '插件名称': 'browser-agent',
          '版本号': '1.8.3',
          '安装实例ID': 'inst-ba-02',
          'workspace ID': 'ws_291a',
        },
      },
      submission: { fields: { name: 'browser-agent', operation: '升级' } },
    },
    // PLG-04 自动禁用记录（待确认）
    {
      ticketNo: 'PLG-04-03',
      ticketType: 'PLG-04',
      status: '待运维确认',
      account: 'lin.jie',
      org: '经侦支队',
      resourceId: 'document-parser',
      workspaceId: 'ws_70ce',
      createdAt: at(15),
      snapshot: {
        fields: {
          '插件名称': 'document-parser',
          '版本号': '2.4.1',
          '安装实例ID': 'inst-dp-03',
          'workspace ID': 'ws_70ce',
          '触发规则': '失败率',
          '实测值': '46.8%',
        },
      },
    },
  ]

  // 1. 无能力端目录时（安全降级为 null）
  const report1 = await pluginMonitorReport({
    query: new URLSearchParams('window=24h'),
    now,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
    applications,
  })

  assert.equal(report1.metrics.publishedCount, null)
  assert.equal(report1.sources.catalog, 'not_collected')
  assert.equal(report1.metrics.installedCount, 3)
  assert.equal(report1.metrics.disabledCount, 1)
  assert.equal(report1.metrics.upgradableCount, 1)
  assert.equal(report1.metrics.vulnerableCount, 1)

  // 2. 带有能力端目录
  const mockCap = async path => {
    if (path.includes('/catalog?kind=plugin')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { resourceId: 'document-parser', status: 'available' },
            { resourceId: 'browser-agent', status: 'available' },
          ],
        }),
      }
    }
    return { ok: false, status: 404 }
  }

  const report2 = await pluginMonitorReport({
    query: new URLSearchParams('window=24h'),
    now,
    cap: mockCap,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
    applications,
  })

  assert.equal(report2.metrics.publishedCount, 2)
  assert.equal(report2.sources.catalog, 'collected')
  assert.ok(report2.disables.items.length >= 1)
  assert.equal(report2.disables.items[0].pluginName, 'document-parser')
  assert.equal(report2.disables.items[0].actualValue, '46.8%')

  // 3. 错误排行
  const dpErr = report2.errorRanking.find(r => r.name === 'document-parser')
  assert.ok(dpErr && dpErr.value >= 1)
})

test('插件监控 HTTP 鉴权与组织隔离', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'plg-mon-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  const capServer = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, {
        items: [
          { resourceId: 'document-parser', status: 'available' },
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
  const userRes = await fetch(`${baseUrl}/api/plugin-monitor`, {
    headers: { cookie: userCookie },
  })
  assert.equal(userRes.status, 403)

  // 2. 运维人员跨组织查询拒绝 403
  const opsCrossRes = await fetch(`${baseUrl}/api/plugin-monitor?org=${encodeURIComponent('业务一部')}`, {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsCrossRes.status, 403)

  // 3. 运维人员访问所属组织允许 200
  const opsRes = await fetch(`${baseUrl}/api/plugin-monitor`, {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsRes.status, 200)
  const opsData = await opsRes.json()
  assert.ok(opsData.metrics)
  assert.equal(opsData.window, '24h')

  // 4. 管理员全量访问允许 200
  const adminRes = await fetch(`${baseUrl}/api/plugin-monitor?org=${encodeURIComponent('业务一部')}`, {
    headers: { cookie: adminCookie },
  })
  assert.equal(adminRes.status, 200)
  const adminData = await adminRes.json()
  assert.ok(adminData.disables)
  assert.ok(adminData.instances)

  // 5. 搜索过滤参数测试
  const searchRes = await fetch(`${baseUrl}/api/plugin-monitor?q=document`, {
    headers: { cookie: adminCookie },
  })
  assert.equal(searchRes.status, 200)
})
