import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium, expect} from '@playwright/test'
import {createServer} from 'vite'

const dir = await mkdtemp(join(tmpdir(), 'routing-browser-'))
process.env.APP_DATA_DIR = dir
let server, browser

try {
  server = await createServer({cacheDir: join(dir, 'vite-cache'), server: {port: 0, host: '127.0.0.1'}})
  await server.listen()
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')

  browser = await chromium.launch({channel: 'msedge', headless: true})

  // 1. 未登录访问根路径自动规范至 /login，登录后同步路由、支持前进后退、F5 刷新保活与登出回退
  const admin = await browser.newPage()
  admin.setDefaultTimeout(15000)
  await admin.goto(base + '/')
  await expect(admin).toHaveURL(base + '/login')
  await admin.getByRole('button', {name: /^系统管理员/}).click()
  await expect(admin).toHaveURL(base + '/overview')
  await expect(admin.locator('main[data-view="overview"]')).toBeVisible()
  await expect(admin).toHaveTitle('统一概览 · 应用中心')

  // 切换菜单同步 URL
  await admin.locator('.nav-item[data-view="knowledge"]').click()
  await expect(admin).toHaveURL(base + '/knowledge')
  await expect(admin.locator('main[data-view="knowledge"]')).toBeVisible()

  // 手工申请与子类型深链
  await admin.locator('.nav-item[data-view="manual"]').click()
  await expect(admin).toHaveURL(base + '/manual')
  await admin.locator('[data-ticket-type="TOL-01"]').click()
  await expect(admin).toHaveURL(base + '/manual/TOL-01')
  await expect(admin.locator('.form-title .type-code')).toHaveText('TOL-01')
  await expect(admin).toHaveTitle('手工申请 · TOL-01 · 应用中心')

  // 浏览器后退 / 前进
  await admin.goBack()
  await expect(admin).toHaveURL(base + '/manual')
  await admin.goBack()
  await expect(admin).toHaveURL(base + '/knowledge')
  await expect(admin.locator('main[data-view="knowledge"]')).toBeVisible()
  await admin.goForward()
  await expect(admin).toHaveURL(base + '/manual')
  await admin.goForward()
  await expect(admin).toHaveURL(base + '/manual/TOL-01')
  await expect(admin.locator('.form-title .type-code')).toHaveText('TOL-01')

  // F5 刷新保持登录态与当前深链页面
  await admin.reload()
  await expect(admin).toHaveURL(base + '/manual/TOL-01')
  await expect(admin.locator('.app-shell')).toBeVisible()
  await expect(admin.locator('.form-title .type-code')).toHaveText('TOL-01')

  // 退出登录回到 /login，刷新不再自动恢复会话
  await admin.locator('.user-trigger').click()
  await admin.getByRole('button', {name: /退出登录/}).click()
  await expect(admin).toHaveURL(base + '/login')
  await admin.reload()
  await expect(admin).toHaveURL(base + '/login')
  await expect(admin.getByRole('button', {name: /^系统管理员/})).toBeVisible()
  await admin.close()

  // 2. 深链直达（未登录访问 /knowledge，运维登录后直达 /knowledge）
  const ops = await browser.newPage()
  ops.setDefaultTimeout(15000)
  await ops.goto(base + '/knowledge')
  await ops.getByRole('button', {name: /^运维人员/}).click()
  await expect(ops).toHaveURL(base + '/knowledge')
  await expect(ops.locator('main[data-view="knowledge"]')).toBeVisible()
  await ops.close()

  // 3. 角色越权路由守卫（普通用户直访 /audit 登录后回落至 /agents）
  const user = await browser.newPage()
  user.setDefaultTimeout(15000)
  await user.goto(base + '/audit')
  await user.getByRole('button', {name: /^用户/}).click()
  await expect(user).toHaveURL(base + '/agents')
  await expect(user.locator('main[data-view="agents"]')).toBeVisible()
  await user.close()

  console.log('PASS Edge: 全站 URL 路由同步、前进后退、F5 刷新会话恢复、手工工单深链与角色守卫已闭环通过')
} finally {
  await browser?.close()
  await server?.close()
  await rm(dir, {recursive: true, force: true}).catch(() => {})
}
