import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentWarehouseReport } from '../../server/agent-warehouse.mjs'
import { startManagement } from '../../../../app/server/service.mjs'
import { listen, json } from '../../../../../runtime/http.mjs'

const now = Date.parse('2026-11-19T10:00:00Z')

test('智能体仓库角色隔离、组织可见性、工单号遮蔽与指标计算', () => {
  // 1. 普通用户视角（治安支队）
  const userReport = agentWarehouseReport({
    query: new URLSearchParams(),
    now,
    identity: { account: 'sun.ning', org: '治安支队', roles: ['user'] },
  })

  assert.ok(userReport.metrics.total > 0)
  assert.equal(userReport.metrics.unavailableCount, 0) // 用户视角看不到不可用条目
  assert.equal(userReport.metrics.total, userReport.metrics.usableCount)

  // 验证网安支队专属应用（app_clue_agent）对治安支队不可见
  const clueAgent = userReport.items.find(i => i.id === 'app_clue_agent')
  assert.equal(clueAgent, undefined)

  // 验证用户所属组织的专属/全局应用可见
  const dutyAgent = userReport.items.find(i => i.id === 'app_duty_qa')
  assert.ok(dutyAgent)
  assert.equal(dutyAgent.directlyUsable, true)

  // 验证用户无法看到工单号（脱敏防越权）
  for (const item of userReport.items) {
    for (const rel of item.releases) {
      assert.equal(rel.ticket, '')
    }
  }

  // 2. 运维人员视角（平台运营组）
  const opsReport = agentWarehouseReport({
    query: new URLSearchParams(),
    now,
    identity: { account: 'op_zhoumin', org: '平台运营组', roles: ['operator'] },
  })

  // 运维人员可见全量资产（包含下架与实验版）
  assert.ok(opsReport.metrics.total > userReport.metrics.total)
  assert.ok(opsReport.metrics.unavailableCount >= 2)

  const legacyDoc = opsReport.items.find(i => i.id === 'app_legacy_doc')
  assert.ok(legacyDoc)
  assert.equal(legacyDoc.directlyUsable, false)

  // 运维人员可见完整工单号
  const caseSummary = opsReport.items.find(i => i.id === 'app_case_summary')
  assert.ok(caseSummary)
  assert.equal(caseSummary.releases[0].ticket, 'AG-20261116-0142')
})

test('智能体仓库多维搜索、标签筛选、方式过滤与工单动态联动', () => {
  const applications = [
    {
      ticketNo: 'AG-05-9901',
      ticketType: 'AG-05',
      status: '已完成',
      submission: {
        resourceId: 'app_case_summary',
        fields: { reason: '业务系统升级，暂时下架' },
      },
    },
    {
      ticketNo: 'AG-04-9902',
      ticketType: 'AG-04',
      status: '已完成',
      submission: {
        resourceId: 'app_duty_qa',
        fields: { summary: '增加节假日排班智能问答规则' },
      },
      snapshot: {
        data: { publicationVersionId: 'v1.3' },
      },
    },
  ]

  // 动态联动验证：下架工单使应用不可用，再发布工单增加新版本
  const opsReport = agentWarehouseReport({
    query: new URLSearchParams(),
    now,
    identity: { account: 'li.qiang', org: '系统管理组', roles: ['admin'] },
    applications,
  })

  const caseSummary = opsReport.items.find(i => i.id === 'app_case_summary')
  assert.ok(caseSummary)
  assert.equal(caseSummary.directlyUsable, false)
  assert.match(caseSummary.unavailableReason, /AG-05-9901/)
  assert.equal(caseSummary.releases[0].ticket, 'AG-05-9901')

  const dutyQa = opsReport.items.find(i => i.id === 'app_duty_qa')
  assert.ok(dutyQa)
  assert.equal(dutyQa.releases[0].version, 'v1.3')
  assert.equal(dutyQa.releases[0].ticket, 'AG-04-9902')

  // 筛选过滤测试：搜索关键字
  const searchReport = agentWarehouseReport({
    query: new URLSearchParams('q=陈宇'),
    now,
    identity: { account: 'li.qiang', org: '系统管理组', roles: ['admin'] },
  })
  assert.ok(searchReport.items.every(i => i.developer.includes('陈宇') || i.developerAccount.includes('chen.yu')))

  // 筛选过滤测试：方式过滤 api
  const apiReport = agentWarehouseReport({
    query: new URLSearchParams('method=api'),
    now,
    identity: { account: 'li.qiang', org: '系统管理组', roles: ['admin'] },
  })
  assert.ok(apiReport.items.every(i => i.methods.includes('api')))

  // 筛选过滤测试：可用性过滤 暂不可用
  const unavailReport = agentWarehouseReport({
    query: new URLSearchParams('usable=暂不可用'),
    now,
    identity: { account: 'li.qiang', org: '系统管理组', roles: ['admin'] },
  })
  assert.ok(unavailReport.items.every(i => !i.directlyUsable))
})

test('智能体仓库 HTTP 服务端鉴权与端点测试', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-warehouse-test-'))
  let cap, mgmt
  try {
    cap = await listen((req, res) => json(res, { items: [] }))
    mgmt = await startManagement({ dir, token: 'secret-token', executor: cap.url })

    async function login(account) {
      const res = await fetch(`${mgmt.url}/api/demo-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account }),
      })
      assert.equal(res.status, 200)
      return res.headers.get('set-cookie')?.split(';')[0] || ''
    }

    // 未登录访问拒绝
    const unauth = await fetch(mgmt.url + '/api/agent-warehouse')
    assert.equal(unauth.status, 403)

    // 用户登录获取仓库 (chen.yu 普通用户 业务一部)
    const userCookie = await login('chen.yu')
    const resUser = await fetch(mgmt.url + '/api/agent-warehouse', {
      headers: { Cookie: userCookie },
    })
    assert.equal(resUser.status, 200)
    const bodyUser = await resUser.json()
    assert.equal(bodyUser.role, 'user')
    assert.ok(bodyUser.items.length > 0)
    assert.equal(bodyUser.metrics.unavailableCount, 0)

    // 运维登录获取仓库 (zhou.min 平台运营组)
    const opsCookie = await login('zhou.min')
    const resOps = await fetch(mgmt.url + '/api/agent-warehouse', {
      headers: { Cookie: opsCookie },
    })
    assert.equal(resOps.status, 200)
    const bodyOps = await resOps.json()
    assert.equal(bodyOps.role, 'ops')
    assert.ok(bodyOps.metrics.unavailableCount > 0)
  } finally {
    if (mgmt) await mgmt.close()
    if (cap) await cap.close()
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})
