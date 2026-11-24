import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseDockerPs} from '../../server/service-probe.mjs'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen, json} from '../../../../../runtime/http.mjs'

const now = Date.parse('2026-11-23T08:00:00Z')

function container(id, name, image, state, status, project, service) {
  return JSON.stringify({
    ID: id,
    Names: name,
    Image: image,
    State: state,
    Status: status,
    Labels: `com.docker.compose.project=${project},com.docker.compose.service=${service}`,
  })
}

const sample = [
  container('a'.repeat(12), 'docker-api-1', 'langgenius/dify-api:1.7.1', 'running', 'Up 2 hours (healthy)', 'docker', 'api'),
  container('b'.repeat(12), 'docker-worker-1', 'langgenius/dify-api:1.7.1', 'exited', 'Exited (1) 3 minutes ago', 'docker', 'worker'),
  container('c'.repeat(12), 'docker-redis-1', 'redis:6', 'running', 'Up 2 hours', 'docker', 'redis'),
  container('d'.repeat(12), 'docker-init-1', 'langgenius/dify-api:1.7.1', 'exited', 'Exited (0) 2 hours ago', 'docker', 'init_permissions'),
  container('e'.repeat(12), 'ragflow-cpu-1', 'infiniflow/ragflow:v0.22.1', 'running', 'Up 1 hour (healthy)', 'ragflow', 'ragflow-cpu'),
  container('f'.repeat(12), 'ragflow-mysql-1', 'mysql:8.0', 'exited', 'Exited (137) 1 minute ago', 'ragflow', 'mysql'),
  container('1'.repeat(12), 'app-center-mysql', 'mysql:8.0.39', 'running', 'Up 5 hours', 'app-center', 'mysql'),
].join('\n')

test('服务巡检只纳入 Dify 和 RAGFlow 容器，初始化任务正常退出不重启', () => {
  const services = parseDockerPs(sample)
  const names = services.map(item => item.service).sort()
  assert.deepEqual(names, ['api', 'init_permissions', 'mysql', 'ragflow-cpu', 'redis', 'worker'])
  assert.equal(services.find(item => item.service === 'worker').status, '不可用')
  assert.equal(services.find(item => item.service === 'worker').restartable, true)
  assert.equal(services.find(item => item.service === 'init_permissions').status, '已结束')
  assert.equal(services.find(item => item.service === 'init_permissions').restartable, false)
  assert.equal(services.find(item => item.service === 'redis').product, 'Dify')
  assert.equal(services.find(item => item.service === 'mysql').product, 'RAGFlow')
  assert.equal(services.some(item => item.containerName === 'app-center-mysql'), false)
})

test('不可用容器自动建单、自动审批并只重启一次', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'svc-monitor-'))
  t.after(async () => { await rm(dir, {recursive: true, force: true}).catch(() => {}) })
  const cap = await listen((_req, res) => json(res, {error: {code: 'NOT_FOUND'}}, 404), {token: 'test-token'})
  t.after(async () => { await cap.close() })
  const restarted = []
  const mgmt = await startManagement({
    dir,
    token: 'test-token',
    executor: cap.url,
    now: () => now,
    serviceProbe: async () => sample,
    serviceRestart: async containerId => { restarted.push(containerId) },
    serviceAutoRestart: true,
  })
  t.after(async () => { await mgmt.close() })

  async function login(account) {
    const res = await fetch(`${mgmt.url}/api/demo-session`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({account}),
    })
    assert.equal(res.status, 200)
    return res.headers.get('set-cookie')?.split(';')[0] || ''
  }

  const userCookie = await login('chen.yu')
  const opsCookie = await login('zhou.min')
  const adminCookie = await login('li.qiang')
  assert.equal((await fetch(`${mgmt.url}/api/service-monitor`, {headers: {cookie: userCookie}})).status, 403)

  const first = await fetch(`${mgmt.url}/api/service-monitor`, {headers: {cookie: opsCookie}})
  assert.equal(first.status, 200)
  const report = await first.json()
  assert.equal(report.availability, 'collected')
  assert.equal(report.products.Dify.running, 2)
  assert.equal(report.products.Dify.unavailable, 1)
  assert.equal(report.products.RAGFlow.unavailable, 1)
  assert.deepEqual(restarted.slice().sort(), ['b'.repeat(12), 'f'.repeat(12)].sort())
  assert.equal(report.restarts.length, 2)
  assert.ok(report.restarts.every(row => row.status === '已完成' && row.approvalMode === '自动审批'))

  const second = await fetch(`${mgmt.url}/api/service-monitor`, {headers: {cookie: opsCookie}})
  assert.equal(second.status, 200)
  assert.equal(restarted.length, 2)

  const query = await fetch(`${mgmt.url}/api/applications?view=query`, {headers: {cookie: adminCookie}})
  const applications = await query.json()
  assert.equal(applications.items.filter(row => row.ticketType === 'SVC-01' && row.status === '已完成').length, 2)
  const todo = await fetch(`${mgmt.url}/api/applications?view=todo`, {headers: {cookie: opsCookie}})
  const pending = await todo.json()
  assert.equal(pending.items.filter(row => row.ticketType === 'SVC-01').length, 0)
})

test('Docker 不可用时服务监控显示未采集且不重启', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'svc-missing-'))
  t.after(async () => { await rm(dir, {recursive: true, force: true}).catch(() => {}) })
  const cap = await listen((_req, res) => json(res, {}), {token: 'test-token'})
  t.after(async () => { await cap.close() })
  let called = false
  const mgmt = await startManagement({
    dir,
    token: 'test-token',
    executor: cap.url,
    now: () => now,
    serviceProbe: async () => { throw new Error('docker missing') },
    serviceRestart: async () => { called = true },
    serviceAutoRestart: true,
  })
  t.after(async () => { await mgmt.close() })
  const login = await fetch(`${mgmt.url}/api/demo-session`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({account: 'zhou.min'}),
  })
  const cookie = login.headers.get('set-cookie')?.split(';')[0] || ''
  const response = await fetch(`${mgmt.url}/api/service-monitor`, {headers: {cookie}})
  const report = await response.json()
  assert.equal(report.availability, 'not_collected')
  assert.equal(report.products.Dify.running, null)
  assert.equal(report.products.RAGFlow.unavailable, null)
  assert.equal(called, false)
})
