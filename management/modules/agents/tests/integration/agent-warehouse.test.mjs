import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentWarehouseReport } from '../../server/agent-warehouse.mjs'
import { startManagement } from '../../../../app/server/service.mjs'
import { listen, json } from '../../../../../runtime/http.mjs'

const now = Date.parse('2026-11-19T10:00:00Z')

const published = {
  ticketNo: 'AG-02-1001',
  ticketType: 'AG-02',
  status: '已完成',
  account: 'chen.yu',
  org: '业务一部',
  createdAt: now,
  updatedAt: now,
  submission: { resourceId: 'app-real', fields: { name: '已发布应用', description: '来自办结工单' } },
  snapshot: { data: { publicationVersionId: 'v1.0' } },
}

test('没有办结发布工单时，智能体仓库不展示演示应用', () => {
  const report = agentWarehouseReport({
    query: new URLSearchParams(),
    now,
    identity: { account: 'sun.ning', org: '治安支队', roles: ['user'] },
  })
  assert.equal(report.metrics.total, 0)
  assert.equal(report.items.length, 0)
  assert.equal(report.items.find(item => item.name === '案件摘要助手'), undefined)
})

test('智能体仓库只展示办结发布工单，用户看不到工单号，下架后用户不可见', () => {
  const userReport = agentWarehouseReport({
    query: new URLSearchParams(),
    now,
    identity: { account: 'sun.ning', org: '治安支队', roles: ['user'] },
    applications: [published],
  })
  assert.equal(userReport.metrics.total, 1)
  assert.equal(userReport.metrics.unavailableCount, 0)
  assert.equal(userReport.items[0].id, 'app-real')
  assert.equal(userReport.items[0].releases[0].ticket, '')

  const opsReport = agentWarehouseReport({
    query: new URLSearchParams(),
    now,
    identity: { account: 'op_zhoumin', org: '平台运营组', roles: ['operator'] },
    applications: [published, {
      ticketNo: 'AG-05-9901',
      ticketType: 'AG-05',
      status: '已完成',
      createdAt: now,
      updatedAt: now,
      submission: { resourceId: 'app-real', fields: { reason: '业务申请下架' } },
    }],
  })
  assert.equal(opsReport.items[0].directlyUsable, false)
  assert.equal(opsReport.items[0].releases[0].ticket, 'AG-05-9901')
  assert.equal(opsReport.metrics.unavailableCount, 1)

  const userAfterWithdraw = agentWarehouseReport({
    query: new URLSearchParams(),
    now,
    identity: { account: 'sun.ning', org: '治安支队', roles: ['user'] },
    applications: [published, {
      ticketNo: 'AG-05-9901',
      ticketType: 'AG-05',
      status: '已完成',
      submission: { resourceId: 'app-real', fields: { reason: '业务申请下架' } },
    }],
  })
  assert.equal(userAfterWithdraw.items.length, 0)
})

test('智能体仓库按名称筛选，再发布写入新版本', () => {
  const applications = [
    published,
    {
      ticketNo: 'AG-04-9902',
      ticketType: 'AG-04',
      status: '已完成',
      createdAt: now,
      updatedAt: now,
      submission: { resourceId: 'app-real', fields: { summary: '增加问答规则' } },
      snapshot: { data: { publicationVersionId: 'v1.3' } },
    },
  ]
  const report = agentWarehouseReport({
    query: new URLSearchParams('q=已发布'),
    now,
    identity: { account: 'li.qiang', org: '系统管理组', roles: ['admin'] },
    applications,
  })
  assert.equal(report.items.length, 1)
  assert.equal(report.items[0].releases[0].version, 'v1.3')
  assert.equal(report.items[0].releases[0].ticket, 'AG-04-9902')
  assert.equal(report.items[0].directlyUsable, true)
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
    assert.equal(bodyUser.items.length, 0)
    assert.equal(bodyUser.metrics.unavailableCount, 0)

    // 运维登录获取仓库 (zhou.min 平台运营组)
    const opsCookie = await login('zhou.min')
    const resOps = await fetch(mgmt.url + '/api/agent-warehouse', {
      headers: { Cookie: opsCookie },
    })
    assert.equal(resOps.status, 200)
    const bodyOps = await resOps.json()
    assert.equal(bodyOps.role, 'ops')
    assert.equal(bodyOps.items.length, 0)
    assert.equal(bodyOps.metrics.total, 0)
  } finally {
    if (mgmt) await mgmt.close()
    if (cap) await cap.close()
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})
