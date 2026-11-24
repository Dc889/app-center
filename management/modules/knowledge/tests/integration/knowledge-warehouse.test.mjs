import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {knowledgeWarehouseReport} from '../../server/knowledge-warehouse.mjs'
import {startManagement} from '../../../../app/server/service.mjs'
import {json, listen} from '../../../../../runtime/http.mjs'

const now = Date.parse('2026-11-23T02:00:00Z')
const user = {account: 'chen.yu', org: '业务一部', roles: ['user']}
const outsider = {account: 'sun.ning', org: '治安支队', roles: ['user']}
const operator = {account: 'zhou.min', org: '平台运营组', roles: ['operator']}

const published = {
  ticketNo: 'KB-02-1001',
  ticketType: 'KB-02',
  status: '已完成',
  account: 'chen.yu',
  org: '业务一部',
  createdAt: '2026-11-23T01:00:00Z',
  submission: {resourceId: 'kb-shared', fields: {name: '反诈话术资料库', sourceSystem: 'Dify', description: '共享话术', shareMode: '共享目录', boundaryOrgs: ['业务一部']}},
}

test('没有办结发布工单时，知识库仓库不展示演示知识库', () => {
  const report = knowledgeWarehouseReport({query: new URLSearchParams(), now, identity: outsider})
  assert.equal(report.metrics.total, 0)
  assert.equal(report.items.length, 0)
  assert.equal(report.ranking.length, 0)
  assert.equal(report.metrics.downloadCount, null)
})

test('共享目录可直接使用，指定组织对范围外用户显示待申请，目录下架后普通用户不可见', () => {
  const restricted = {
    ticketNo: 'KB-02-1002',
    ticketType: 'KB-02',
    status: '已完成',
    account: 'li.jie',
    org: '刑侦',
    createdAt: '2026-11-23T01:10:00Z',
    submission: {resourceId: 'kb-org', fields: {name: '刑侦卷宗库', sourceSystem: 'RAGFlow', shareMode: '指定组织', targetOrgs: ['刑侦'], description: '限组织'}},
  }
  const own = knowledgeWarehouseReport({query: new URLSearchParams(), now, identity: user, applications: [published, restricted]})
  assert.equal(own.items.find(item => item.id === 'kb-shared').directlyUsable, true)
  assert.equal(own.items.find(item => item.id === 'kb-org').directlyUsable, false)
  assert.deepEqual(own.items.find(item => item.id === 'kb-org').methods, ['检索使用', '编排绑定'])

  const withdrawn = knowledgeWarehouseReport({
    query: new URLSearchParams(),
    now,
    identity: user,
    applications: [published, {ticketNo: 'KB-05-9', ticketType: 'KB-05', status: '已完成', createdAt: '2026-11-23T01:20:00Z', submission: {resourceId: 'kb-shared', fields: {target: '整个知识库'}}, approvedFields: {'处置动作': ['目录下架']}}],
  })
  assert.equal(withdrawn.items.length, 0)

  const staff = knowledgeWarehouseReport({
    query: new URLSearchParams(),
    now,
    identity: operator,
    applications: [published, {ticketNo: 'KB-05-9', ticketType: 'KB-05', status: '已完成', createdAt: '2026-11-23T01:20:00Z', submission: {resourceId: 'kb-shared', fields: {target: '整个知识库'}}, approvedFields: {'处置动作': ['目录下架']}}],
  })
  assert.equal(staff.items[0].unavailable, true)
  assert.equal(staff.items[0].ticketNo, 'KB-05-9')
  assert.equal(staff.items[0].directlyUsable, false)
})

test('下载次数只采用已采集数字，缺失保持未采集且不参与名次', () => {
  const second = {...published, ticketNo: 'KB-02-1003', submission: {resourceId: 'kb-plain', fields: {name: '无统计库', sourceSystem: 'Dify', shareMode: '共享目录'}}}
  const report = knowledgeWarehouseReport({
    query: new URLSearchParams(),
    now,
    identity: user,
    applications: [published, second],
    catalogItems: [{resourceId: 'kb-shared', name: '反诈话术资料库', status: 'published', data: {downloadCount: 8}}],
  })
  assert.equal(report.ranking[0].id, 'kb-shared')
  assert.equal(report.ranking[0].count, 8)
  assert.equal(report.ranking[1].count, null)
  assert.equal(report.metrics.downloadCount, 8)
  const filtered = knowledgeWarehouseReport({query: new URLSearchParams('q=无统计&method=编排绑定'), now, identity: user, applications: [published, second]})
  assert.deepEqual(filtered.items.map(item => item.id), ['kb-plain'])
})

test('知识库仓库接口按会话鉴权，未登录拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-warehouse-'))
  let cap, mgmt
  try {
    cap = await listen((req, res) => json(res, {items: []}))
    mgmt = await startManagement({dir, token: 'secret-token', executor: cap.url})
    assert.equal((await fetch(mgmt.url + '/api/knowledge-warehouse')).status, 403)
    const login = await fetch(mgmt.url + '/api/demo-session', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({account: 'chen.yu'})})
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const report = await fetch(mgmt.url + '/api/knowledge-warehouse', {headers: {cookie}})
    assert.equal(report.status, 200)
    const body = await report.json()
    assert.equal(body.role, 'user')
    assert.equal(body.items.length, 0)
  } finally {
    await mgmt?.close()
    await cap?.close()
    await rm(dir, {recursive: true, force: true})
  }
})
