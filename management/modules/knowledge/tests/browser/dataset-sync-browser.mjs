import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { listen, json, body } from '../../../../../runtime/http.mjs'
import { mockExecution } from '../../../../../tests/support/execution-state.mjs'

const dir = await mkdtemp(join(tmpdir(), 'kb-sync-browser-'))
process.env.APP_DATA_DIR = dir
process.env.INTERNAL_TOKEN = 'kb-sync-token'

let server, browser, capability, serial = 0
const commands = []
const states = new Map()

try {
  capability = await listen(async (req, res, path) => {
    const query = new URL(req.url, 'http://localhost').searchParams
    if (path.endsWith('/workspaces')) {
      return json(res, { items: [{ workspaceId: 'ws1', name: '一区' }, { workspaceId: 'ws2', name: '二区' }], nextCursor: null })
    }
    if (path === '/internal/v1/resources') {
      const kind = query.get('kind')
      const last = query.has('cursor')
      return json(res, {
        items: [{ resourceId: last ? 'ds_last' : 'ds_first', name: last ? '测试知识库' : '已有知识库', source: kind, workspaceId: kind === 'ragflow_dataset' ? null : query.get('workspaceId') }],
        nextCursor: last ? null : 'page2',
      })
    }
    if (path.startsWith('/internal/v1/resources/')) {
      const kind = path.split('/')[4]
      const isRag = kind === 'ragflow_dataset'
      return json(res, {
        resourceId: 'ds_last',
        workspaceId: isRag ? null : query.get('workspaceId'),
        snapshotId: 'snapshot-' + (++serial),
        capturedAt: new Date().toISOString(),
        data: { ownerAccount: 'chen.yu', ...(isRag ? { tenantId: 'tenant-rag-01' } : {}) },
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

  // 进入手工申请 -> KB-01 知识库纳管同步
  await page.getByRole('button', { name: '手工申请', exact: true }).click()
  await page.getByRole('button', { name: /^KB-01\b/ }).click()

  // 1. Dify 来源选择与快照
  await page.getByRole('button', { name: '读取可用工作区', exact: true }).click()
  await page.getByRole('option', { name: '一区 · ws1', exact: true }).waitFor({ state: 'attached' })
  await page.getByLabel('workspace ID', { exact: true }).selectOption('ws1')

  await page.getByRole('button', { name: '读取可选资源', exact: true }).click()
  await page.getByRole('option', { name: '测试知识库 · ds_last', exact: true }).waitFor({ state: 'attached' })
  await page.getByLabel('知识库', { exact: true }).selectOption('ds_last')
  await expect(page.getByText(/^快照 · snapshot-/)).toBeVisible()

  // 2. 切换到 RAGFlow 来源
  await page.getByLabel('来源系统', { exact: true }).selectOption('RAGFlow')
  await expect(page.getByRole('button', { name: '提交知识库同步', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '读取可选资源', exact: true }).click()
  await page.getByRole('option', { name: '测试知识库 · ds_last', exact: true }).waitFor({ state: 'attached' })
  await page.getByLabel('知识库', { exact: true }).selectOption('ds_last')
  await expect(page.getByText(/^快照 · snapshot-/)).toBeVisible()
  await expect(page.getByLabel('tenant ID', { exact: true })).toHaveValue('tenant-rag-01')

  // 3. 提交知识库同步
  const submitPromise = page.waitForResponse((r) => r.url().endsWith('/api/applications') && r.request().method() === 'POST')
  await page.getByRole('button', { name: '提交知识库同步', exact: true }).click()
  const res = await submitPromise
  assert.equal(res.status(), 201)

  const application = await res.json()
  assert.equal(application.ticketType, 'KB-01')
  assert.equal(application.command.resourceId, 'ds_last')

  console.log('PASS Edge: KB-01 知识库纳管同步 Dify/RAGFlow 来源切换、快照读取与提交已通过 Edge 页面验收')
} finally {
  await browser?.close()
  await server?.close()
  await capability?.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
