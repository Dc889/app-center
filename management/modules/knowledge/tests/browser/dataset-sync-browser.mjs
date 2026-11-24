import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { listen, json, body } from '../../../../../runtime/http.mjs'
import { mockExecution } from '../../../../../tests/support/execution-state.mjs'
import { DEFAULT_USER_PASSWORD } from '../../../../platform/identity/public.server.mjs'

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

  await page.goto(base + 'login')
  await page.getByPlaceholder('例如 chen.yu 或 chen.yu@kpw.com').fill('chen.yu')
  await page.locator('input[name="password"]').fill(DEFAULT_USER_PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.locator('.app-shell').waitFor()

  await page.getByRole('button', { name: '手工申请', exact: true }).click()
  await expect(page.getByRole('button', { name: /^KB-01\b/ })).toHaveCount(0)
  await page.getByRole('button', { name: '知识库', exact: true }).click()
  await expect(page.getByRole('button', { name: /^KB-01\b/ })).toHaveCount(0)
  await page.getByRole('button', { name: /^KB-02\b/ }).click()
  await expect(page.getByRole('heading', { name: '知识库分享申请', exact: true })).toBeVisible()
  await expect(page.getByText('申请部门', { exact: true })).toBeVisible()
  await expect(page.getByLabel('密级', { exact: true })).toBeVisible()
  await expect(page.getByLabel('申请说明', { exact: true })).toBeVisible()
  await expect(page.getByLabel('知识库搜索', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '提交申请', exact: true })).toBeVisible()
  await expect(page.getByLabel('源知识库 ID')).toHaveCount(0)

  console.log('PASS Edge: 个人知识库纳管不在申请目录，知识库分享申请显示部门、密级、申请说明和知识库名称')
} finally {
  await browser?.close()
  await server?.close()
  await capability?.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
