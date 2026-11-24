import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium, expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen, json} from '../../../../../runtime/http.mjs'
import {DEFAULT_USER_PASSWORD} from '../../../../platform/identity/public.server.mjs'

process.env.SERVICE_AUTO_RESTART = '0'
const dir = await mkdtemp(join(tmpdir(), 'svc-browser-'))
process.env.APP_DATA_DIR = dir
let browser, server, cap

try {
  cap = await listen((_req, res) => json(res, {error: {code: 'NOT_FOUND'}}, 404))
  process.env.CAPABILITY_URL = cap.url
  server = await createServer({cacheDir: join(dir, 'vite-cache'), server: {port: 0, host: '127.0.0.1'}})
  await server.listen()
  browser = await chromium.launch({channel: 'msedge', headless: true})

  const accounts = {运维人员: 'zhou.min', 用户: 'chen.yu', 系统管理员: 'li.qiang'}
  async function login(roleName) {
    const page = await browser.newPage()
    page.setDefaultTimeout(20000)
    await page.goto(server.resolvedUrls.local[0] + 'login')
    await page.getByPlaceholder('例如 chen.yu 或 chen.yu@kpw.com').fill(accounts[roleName])
    await page.locator('input[name="password"]').fill(DEFAULT_USER_PASSWORD)
    await page.getByRole('button', {name: '登录'}).click()
    await page.locator('.app-shell').waitFor()
    return page
  }

  const ops = await login('运维人员')
  await ops.getByRole('button', {name: '服务监控', exact: true}).click()
  const root = ops.getByTestId('service-monitor')
  await expect(root.getByRole('heading', {name: '服务监控', exact: true})).toBeVisible()
  await expect(root.getByRole('heading', {name: 'Dify 服务'})).toBeVisible()
  await expect(root.getByRole('heading', {name: 'RAGFlow 服务'})).toBeVisible()
  await expect(root.getByRole('heading', {name: '自动重启工单'})).toBeVisible()
  const report = await ops.evaluate(async () => {
    const response = await fetch('/api/service-monitor')
    return response.json()
  })
  if (report.availability === 'not_collected') {
    assert.equal(report.products.Dify.running, null)
    assert.equal(report.products.RAGFlow.unavailable, null)
    await expect(root.getByText('未采集').first()).toBeVisible()
  } else {
    assert.equal(typeof report.products.Dify.running, 'number')
    assert.equal(typeof report.products.RAGFlow.running, 'number')
    const names = [...report.products.Dify.services, ...report.products.RAGFlow.services].map(item => item.service)
    if (names.length === 0) await expect(root.getByText('已巡检，当前没有发现该产品的容器').first()).toBeVisible()
    else await expect(root.getByRole('cell', {name: names[0], exact: true})).toBeVisible()
  }

  const user = await login('用户')
  await expect(user.getByRole('button', {name: '服务监控', exact: true})).toHaveCount(0)

  const admin = await login('系统管理员')
  await admin.getByRole('button', {name: '服务监控', exact: true}).click()
  await expect(admin.getByTestId('service-monitor')).toBeVisible()
  await admin.getByTitle('刷新').click()
  await expect(admin.getByRole('heading', {name: 'Dify 服务'})).toBeVisible()
} finally {
  await browser?.close()
  await server?.close()
  await cap?.close()
  await rm(dir, {recursive: true, force: true})
}
