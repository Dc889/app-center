import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knowledgeMonitorReport, knowledgeMonitorWindow } from '../../server/knowledge-monitor.mjs'
import { startManagement } from '../../../../app/server/service.mjs'
import { listen, json } from '../../../../../runtime/http.mjs'

const now = Date.parse('2026-11-19T10:00:00Z')
const at = minutes => new Date(now - minutes * 60000).toISOString()

test('知识库监控时间窗口切分与参数校验', () => {
  const w1h = knowledgeMonitorWindow('1h', now)
  assert.equal(w1h.range, '1h')
  assert.equal(w1h.bucketMs, 300000)
  assert.equal(w1h.toMs - w1h.fromMs, 3600000)

  const w24h = knowledgeMonitorWindow('24h', now)
  assert.equal(w24h.range, '24h')
  assert.equal(w24h.bucketMs, 300000)
  assert.equal(w24h.toMs - w24h.fromMs, 86400000)

  const w7d = knowledgeMonitorWindow('7d', now)
  assert.equal(w7d.range, '7d')
  assert.equal(w7d.bucketMs, 3600000)
  assert.equal(w7d.toMs - w7d.fromMs, 604800000)

  assert.throws(() => knowledgeMonitorWindow('30d', now))
})

test('知识库监控指标计算、来源状态分布、逐文档审查与任务追踪', async () => {
  const applications = [
    // KB-01: 纳管已完成
    {
      ticketNo: 'KB-01-101',
      ticketType: 'KB-01',
      status: '已完成',
      account: 'chen.yu',
      org: '业务一部',
      resourceId: 'kb-case-01',
      createdAt: at(45),
      snapshot: {
        fields: {
          '来源系统': 'RAGFlow',
          '知识库名称': '经侦案例知识库',
        },
      },
    },
    // KB-02: 分享申请中，包含 2 篇文档审查，待审批
    {
      ticketNo: 'KB-02-102',
      ticketType: 'KB-02',
      status: '待审批',
      account: 'chen.yu',
      org: '业务一部',
      resourceId: 'kb-law-02',
      createdAt: at(25),
      snapshot: {
        fields: {
          '来源系统': 'Dify',
          '知识库名称': '政策法规语料库',
          '文档审查明细': [
            { documentId: 'doc-01', name: '刑法条文释义.pdf', sha256: 'a'.repeat(64), autoVerdict: '通过' },
            { documentId: 'doc-02', name: '内部涉密草案.docx', sha256: 'b'.repeat(64), autoVerdict: '不通过' },
          ],
        },
      },
      approvedFields: {},
    },
    // KB-04: 变更审查中，1 篇修改，待所有者提交
    {
      ticketNo: 'KB-04-103',
      ticketType: 'KB-04',
      status: '待所有者提交',
      account: 'lin.jie',
      org: '经侦支队',
      resourceId: 'kb-fraud-03',
      createdAt: at(15),
      snapshot: {
        fields: {
          '来源系统': 'RAGFlow',
          '知识库名称': '反诈话术资料库',
          '变更明细': [
            { documentId: 'doc-03', name: '电诈话术应对.pdf', sha256: 'c'.repeat(64), autoVerdict: '通过' },
          ],
        },
      },
    },
    // KB-05: 违规处置已完成（暂停分享）
    {
      ticketNo: 'KB-05-104',
      ticketType: 'KB-05',
      status: '已完成',
      account: 'wu.fan',
      org: '网安支队',
      resourceId: 'kb-sec-04',
      createdAt: at(50),
      submission: {
        fields: {
          reason: '内容违规',
          target: '暂停分享',
        },
      },
      snapshot: {
        fields: {
          '来源系统': 'Dify',
          '知识库名称': '公共安全语料库',
        },
      },
    },
  ]

  // 1. 无能力端目录时（安全降级为 null，不补伪零）
  const report1 = await knowledgeMonitorReport({
    query: new URLSearchParams({ window: '24h' }),
    now,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
    applications,
  })

  assert.equal(report1.metrics.managedCount, null)
  assert.equal(report1.metrics.buildingCount, null)
  assert.equal(report1.metrics.abnormalCount, null)
  assert.equal(report1.sources.catalog, 'not_collected')
  // 待确认文档：KB-02 的 2 篇 + KB-04 的 1 篇 = 3 篇
  assert.equal(report1.metrics.pendingDocCount, 3)
  assert.equal(report1.quantity.subsystems.source, 'not_collected')
  assert.equal(report1.quantity.warehouseListed, 0)
  assert.equal(report1.quantity.warehousePending, 1)
  assert.equal(report1.securityAudits.find(row => row.ticketNo === 'KB-02-102').scene, '上架审核')
  assert.equal(report1.securityAudits.find(row => row.ticketNo === 'KB-02-102').keywordScan, '未通过')
  assert.equal(report1.securityAudits.find(row => row.ticketNo === 'KB-02-102').subsystemScan, '未采集')

  // 2. 带有能力端盘点目录
  const mockCap = async path => {
    if (path.includes('/catalog?kind=knowledge')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { resourceId: 'kb-1', status: 'published' },
            { resourceId: 'kb-2', status: 'building' },
            { resourceId: 'kb-3', status: 'abnormal' },
          ],
        }),
      }
    }
    return { ok: false, status: 404 }
  }

  const report2 = await knowledgeMonitorReport({
    query: new URLSearchParams({ window: '24h' }),
    now,
    cap: mockCap,
    identity: { account: 'li.qiang', org: '信息技术处', roles: ['admin'] },
    applications,
  })

  assert.equal(report2.metrics.managedCount, 3)
  assert.equal(report2.metrics.sharedCount, 1)
  assert.equal(report2.metrics.buildingCount, 1)
  assert.equal(report2.metrics.abnormalCount, 1)
  assert.equal(report2.sources.catalog, 'collected')

  // 3. 来源分布验证
  const rSrc = report2.distribution.sources.find(s => s.name === 'RAGFlow')
  const dSrc = report2.distribution.sources.find(s => s.name === 'Dify')
  assert.ok(rSrc.value >= 2)
  assert.ok(dSrc.value >= 2)

  // 4. 文档审查追踪明细验证
  assert.ok(report2.documentAudits.length >= 3)
  const doc01 = report2.documentAudits.find(d => d.documentId === 'doc-01')
  assert.ok(doc01)
  assert.equal(doc01.autoVerdict, '通过')
  assert.equal(doc01.ticketNo, 'KB-02-102')

  // 5. 告警与处置追踪验证
  assert.equal(report2.alerts.length, 1)
  assert.equal(report2.alerts[0].reason, '内容违规')
  assert.equal(report2.alerts[0].operation, '暂停分享')
  assert.equal(report2.alerts[0].ticketNo, 'KB-05-104')
})

test('知识库监控 HTTP 鉴权与组织隔离', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'kb-mon-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  // 模拟能力服务
  const capServer = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, {
        items: [
          { resourceId: 'kb-test-1', status: 'published' },
          { resourceId: 'kb-test-2', status: 'building' },
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

  // 登录辅助函数
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
  const userRes = await fetch(`${baseUrl}/api/knowledge-monitor`, {
    headers: { cookie: userCookie },
  })
  assert.equal(userRes.status, 403)

  // 2. 运维人员访问跨组织拒绝 403
  const opsCrossRes = await fetch(`${baseUrl}/api/knowledge-monitor?org=${encodeURIComponent('业务一部')}`, {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsCrossRes.status, 403)

  // 3. 运维人员访问本组织允许 200
  const opsRes = await fetch(`${baseUrl}/api/knowledge-monitor`, {
    headers: { cookie: opsCookie },
  })
  assert.equal(opsRes.status, 200)
  const opsData = await opsRes.json()
  assert.ok(opsData.metrics)
  assert.equal(opsData.window, '24h')

  // 4. 管理员全量访问与按组织查询允许 200
  const adminRes = await fetch(`${baseUrl}/api/knowledge-monitor?org=${encodeURIComponent('业务一部')}`, {
    headers: { cookie: adminCookie },
  })
  assert.equal(adminRes.status, 200)
  const adminData = await adminRes.json()
  assert.ok(adminData.tasks)
  assert.ok(Array.isArray(adminData.distribution.sources))

  // 5. 来源系统筛选与搜索参数
  const filterRes = await fetch(`${baseUrl}/api/knowledge-monitor?sourceSystem=RAGFlow&q=经侦`, {
    headers: { cookie: adminCookie },
  })
  assert.equal(filterRes.status, 200)
  const filterData = await filterRes.json()
  assert.ok(filterData.tasks)
})
