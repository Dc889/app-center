import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { listen, json, body } from '../../../../../runtime/http.mjs'
import { mockExecution } from '../../../../../tests/support/execution-state.mjs'

const dir = await mkdtemp(join(tmpdir(), 'agent-sync-browser-'))
process.env.APP_DATA_DIR = dir
process.env.INTERNAL_TOKEN = 'agent-sync-token'

let server, browser, capability, owner = 'chen.yu', serial = 0
const commands = []
const states = new Map()

try {
  capability = await listen(async (req, res, path) => {
    const query = new URL(req.url, 'http://localhost').searchParams
    if (path.endsWith('/workspaces')) {
      return json(res, { items: [{ workspaceId: 'ws1', name: '一区' }, { workspaceId: 'ws2', name: '二区' }], nextCursor: null })
    }
    if (path === '/internal/v1/resources') {
      const last = query.has('cursor')
      return json(res, {
        items: [{ resourceId: last ? 'app_last' : 'app_first', name: last ? '待纳管应用' : '已有应用', source: 'dify_app', workspaceId: query.get('workspaceId') }],
        nextCursor: last ? null : 'page2',
      })
    }
    if (path.startsWith('/internal/v1/resources/')) {
      return json(res, {
        resourceId: 'app_last',
        workspaceId: query.get('workspaceId'),
        snapshotId: 'snapshot-' + (++serial),
        capturedAt: new Date().toISOString(),
        data: { ownerAccount: owner, webSiteEnabled: false },
      })
    }
    if (path.endsWith('/executions') && req.method === 'POST') {
      const command = await body(req)
      commands.push(command)
      const state = mockExecution(command, { status: 'succeeded', result: { resultId: command.resourceId } })
      states.set(command.executionId, state)
      return json(res, state)
    }
    const state = states.get(path.split('/').at(-1))
    return state ? json(res, state) : json(res, { error: { code: 'NOT_FOUND' } }, 404)
  })
  process.env.CAPABILITY_URL = capability.url

  server = await createServer({ cacheDir: join(dir, 'vite-cache'), server: { port: 0, host: '127.0.0.1' } })
  await server.listen()
  const base = server.resolvedUrls.local[0]

  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)

  await page.goto(base)
  await page.getByRole('button', { name: /^用户/ }).click()

  // 进入手工申请 -> AG-01 智能体纳管
  await page.getByRole('button', { name: '手工申请', exact: true }).click()
  await page.getByRole('button', { name: /^AG-01\b/ }).click()

  // 读取工作区并选择 ws1
  await page.getByRole('button', { name: '读取可用工作区', exact: true }).click()
  await page.getByRole('option', { name: '二区 · ws2', exact: true }).waitFor({ state: 'attached' })
  await page.getByLabel('工作区 ID', { exact: true }).selectOption('ws1')

  // 读取可选资源并选择 app_last
  await page.getByRole('button', { name: '读取可选资源', exact: true }).click()
  await page.getByRole('option', { name: '待纳管应用 · app_last', exact: true }).waitFor({ state: 'attached' })
  await page.getByLabel('Dify应用 ID', { exact: true }).selectOption('app_last')

  // 验证快照展示
  await expect(page.getByText(/^快照 · snapshot-/)).toBeVisible()

  // 草稿保存与恢复测试
  await page.getByRole('button', { name: '保存申请草稿', exact: true }).click()
  await page.getByText('申请草稿已保存', { exact: true }).waitFor()

  await page.getByRole('button', { name: '我的申请', exact: true }).click()
  await page.getByRole('button', { name: '手工申请', exact: true }).click()
  await page.getByRole('button', { name: /^AG-01\b/ }).click()

  await page.getByRole('button', { name: /恢复草稿 · app_last/ }).click()
  await page.getByText('已恢复草稿，资源与上传引用需重新核验', { exact: true }).waitFor()

  // 恢复后须重新校验资源
  await page.getByRole('button', { name: '读取可用工作区', exact: true }).click()
  await page.getByLabel('工作区 ID', { exact: true }).selectOption('ws1')
  await page.getByRole('button', { name: '读取可选资源', exact: true }).click()
  await page.getByLabel('Dify应用 ID', { exact: true }).selectOption('app_last')
  await expect(page.getByText(/^快照 · snapshot-/)).toBeVisible()

  // 提交纳管
  const submitPromise = page.waitForResponse((r) => r.url().endsWith('/api/applications') && r.request().method() === 'POST')
  await page.getByRole('button', { name: '提交本人纳管同步', exact: true }).click()
  const res = await submitPromise
  assert.equal(res.status(), 201)

  const application = await res.json()
  assert.equal(application.ticketType, 'AG-01')
  assert.equal(application.command.resourceId, 'app_last')

  console.log('PASS Edge: AG-01 智能体纳管同步工作区选择、快照复核、草稿恢复与提交已通过 Edge 页面验收')
} finally {
  await browser?.close()
  await server?.close()
  await capability?.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
