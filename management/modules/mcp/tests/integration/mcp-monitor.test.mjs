import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mcpMonitorReport, mcpMonitorWindow } from '../../server/mcp-monitor.mjs'
import { startManagement } from '../../../../app/server/service.mjs'
import { listen, json } from '../../../../../runtime/http.mjs'

const now = Date.parse('2026-11-19T10:00:00Z')
const at = minutes => new Date(now - minutes * 60000).toISOString()

test('MCP 监控时间窗口切分与参数校验', () => {
  const w1h = mcpMonitorWindow('1h', now)
  assert.equal(w1h.range, '1h')
  assert.equal(w1h.bucketMs, 300000)
  assert.equal(w1h.toMs - w1h.fromMs, 3600000)

  const w24h = mcpMonitorWindow('24h', now)
  assert.equal(w24h.range, '24h')
  assert.equal(w24h.bucketMs, 300000)
  assert.equal(w24h.toMs - w24h.fromMs, 86400000)

  const w7d = mcpMonitorWindow('7d', now)
  assert.equal(w7d.range, '7d')
  assert.equal(w7d.bucketMs, 3600000)
  assert.equal(w7d.toMs - w7d.fromMs, 604800000)

  assert.throws(() => mcpMonitorWindow('30d', now))
})

test('MCP 监控指标计算、调用明细、绑定台账与异常排行', async () => {
  const applications = [
    // MCP-02 绑定工单
    {
      ticketNo: 'MCP-02-9901',
      ticketType: 'MCP-02',
      status: '已完成',
      account: 'chen.yu',
      org: '业务一部',
      resourceId: '档案检索服务',
      workspaceId: 'ws_84f2',
      createdAt: at(45),
      snapshot: {
        fields: {
          'MCP名称': '档案检索服务',
          '关联应用': '案件摘要助手',
          '绑定ID': 'bind-9901',
          'workspace ID': 'ws_84f2',
        },
      },
      submission: { fields: { name: '档案检索服务' } },
    },
    // MCP-03 隔离工单
    {
      ticketNo: 'MCP-03-9902',
      ticketType: 'MCP-03',
      status: '待审批',
      account: 'zheng.yi',
      org: '情指中心',
      resourceId: '地图服务',
      workspaceId: 'ws_12bb',
      createdAt: at(20),
      snapshot: {
        fields: {
          'MCP名称': '地图服务',
          '处置类型': '服务隔离',
          '告警原因': '调用超时率异常',
        },
      },
    },
  ]

  // 1. 无能力端目录时（安全降级为 null）
  const report1 = await mcpMonitorReport({
    query: new URLSearchParams('window=24h'),
    now,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
    applications,
  })

  assert.equal(report1.metrics.catalogCount, null)
  assert.equal(report1.metrics.activeCount, null)
  assert.equal(report1.sources.catalog, 'not_collected')
  assert.ok(report1.metrics.boundCount >= 1)
  assert.ok(report1.metrics.isolatedCount >= 1)
  assert.ok(report1.metrics.abnormalCount >= 1)

  // 2. 带有能力端目录
  const mockCap = async path => {
    if (path.includes('/catalog?kind=mcp')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { resourceId: '档案检索服务', status: 'available' },
            { resourceId: '地图服务', status: 'available' },
            { resourceId: '线索查询服务', status: 'available' },
          ],
        }),
      }
    }
    return { ok: false, status: 404 }
  }

  const report2 = await mcpMonitorReport({
    query: new URLSearchParams('window=24h'),
    now,
    cap: mockCap,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
    applications,
  })

  assert.equal(report2.metrics.catalogCount, 3)
  assert.equal(report2.metrics.activeCount, 3)
  assert.equal(report2.sources.catalog, 'collected')
  assert.equal(report2.calls.items.length, 0)
  assert.ok(report2.bindings.items.length >= 1)
  assert.ok(report2.alerts.length >= 1)
  assert.equal(report2.errorRanking.length, 0)

  // 4. 搜索过滤
  const reportSearch = await mcpMonitorReport({
    query: new URLSearchParams('window=24h&q=档案检索'),
    now,
    cap: mockCap,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
    applications,
  })
  assert.ok(reportSearch.calls.items.every(c => c.mcpName.includes('档案检索') || c.appName.includes('档案检索')))
})

test('MCP 监控 HTTP 鉴权与组织隔离', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-mon-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  const capServer = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, {
        items: [
          { resourceId: '档案检索服务', status: 'available' },
          { resourceId: '地图服务', status: 'available' },
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
  const userRes = await fetch(`${baseUrl}/api/mcp-monitor`, {
    headers: { cookie: userCookie },
  })
  assert.equal(userRes.status, 403)

  // 2. 运维人员跨组织查询拒绝 403
  const opsCrossRes = await fetch(`${baseUrl}/api/mcp-monitor?org=${encodeURIComponent('业务一部')}`, {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsCrossRes.status, 403)

  // 3. 运维人员访问所属组织允许 200
  const opsRes = await fetch(`${baseUrl}/api/mcp-monitor`, {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsRes.status, 200)
  const opsData = await opsRes.json()
  assert.ok(opsData.metrics)
  assert.equal(opsData.window, '24h')

  // 4. 管理员全量访问允许 200
  const adminRes = await fetch(`${baseUrl}/api/mcp-monitor?org=${encodeURIComponent('业务一部')}`, {
    headers: { cookie: adminCookie },
  })
  assert.equal(adminRes.status, 200)
  const adminData = await adminRes.json()
  assert.ok(adminData.calls)
  assert.ok(adminData.bindings)
  assert.ok(adminData.alerts)

  // 5. 搜索参数测试
  const searchRes = await fetch(`${baseUrl}/api/mcp-monitor?q=search_archive`, {
    headers: { cookie: adminCookie },
  })
  assert.equal(searchRes.status, 200)
})
