import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect, chromium} from '@playwright/test'
import {createServer} from 'vite'
import {json, listen} from '../../../../../runtime/http.mjs'
import {DEFAULT_USER_PASSWORD} from '../../../../platform/identity/public.server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'knowledge-warehouse-'))
process.env.APP_DATA_DIR = dir
let server, browser, capability
try {
  capability = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/internal/v1/resources' && url.searchParams.get('kind') === 'dify_dataset') {
      return json(res, {items: [
        {resourceId: 'kb-live', name: '反诈话术资料库', status: 'published', source: 'Dify', data: {description: '可直接检索', downloadCount: 8, shareMode: '共享目录'}},
        {resourceId: 'kb-old', name: '停用资料库', status: 'withdrawn', source: 'Dify', data: {description: '已下架', downloadCount: 1}},
      ]})
    }
    if (url.pathname === '/internal/v1/resources') return json(res, {items: []})
    return json(res, {error: {message: 'unsupported'}}, 404)
  })
  process.env.CAPABILITY_URL = capability.url
  server = await createServer({cacheDir: join(dir, 'vite-cache'), server: {port: 0, host: '127.0.0.1'}})
  await server.listen()
  browser = await chromium.launch({channel: 'msedge', headless: true})
  const base = server.resolvedUrls.local[0]
  const page = await browser.newPage()
  await page.goto(base + 'login')
  await page.getByPlaceholder('例如 chen.yu 或 chen.yu@kpw.com').fill('chen.yu')
  await page.locator('input[name="password"]').fill(DEFAULT_USER_PASSWORD)
  await page.getByRole('button', {name: '登录'}).click()
  await page.locator('.app-shell').waitFor()
  await page.getByRole('button', {name: '知识库仓库', exact: true}).click()
  await expect(page.getByRole('heading', {name: '知识库仓库'})).toBeVisible()
  await expect(page.getByRole('heading', {name: '下载次数排行榜'})).toBeVisible()
  await page.getByLabel('搜索知识库').fill('反诈')
  await expect(page.getByTestId('knowledge-card-kb-live')).toBeVisible()
  await expect(page.getByTestId('knowledge-card-kb-live').locator('.dify-tile-icon em')).toHaveText('可使用')
  await expect(page.getByTestId('knowledge-card-kb-old')).toHaveCount(0)
  await page.getByRole('button', {name: '可直接使用', exact: true}).click()
  await expect(page.getByTestId('knowledge-card-kb-live')).toBeVisible()
  await page.getByLabel('使用方式').selectOption('编排绑定')
  await expect(page.getByTestId('knowledge-card-kb-live')).toBeVisible()
  await page.getByLabel('使用方式').selectOption('使用方式')
  await page.getByRole('button', {name: '暂不可用', exact: true}).click()
  await expect(page.getByText('没有符合当前筛选的知识库。')).toBeVisible()
  const scroll = await page.getByTestId('knowledge-catalog-scroll').evaluate(node => getComputedStyle(node).overflowY)
  if (scroll !== 'auto' && scroll !== 'scroll') throw Error('知识库目录区域不能滚动')
  console.log('PASS knowledge warehouse: 排行、搜索、可用标签、使用方式筛选和矩形图标状态已在 Edge 验收')
} finally {
  await browser?.close()
  await server?.close()
  await capability?.close()
  await rm(dir, {recursive: true, force: true})
}
