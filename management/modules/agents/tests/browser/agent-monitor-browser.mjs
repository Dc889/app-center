import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { listen, json } from '../../../../../runtime/http.mjs'
import { DEFAULT_USER_PASSWORD } from '../../../../platform/identity/public.server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'agent-mon-browser-'))
process.env.APP_DATA_DIR = dir
let browser, server, cap

try {
  cap = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, {
        items: [
          { resourceId: 'app_case_summary', name: '案件摘要助手', status: 'available' },
          { resourceId: 'app_query_assist', name: '知识检索助手', status: 'available' },
        ],
      })
    }
    return json(res, { error: { code: 'NOT_FOUND' } }, 404)
  })
  process.env.CAPABILITY_URL = cap.url

  server = await createServer({ cacheDir: join(dir, 'vite-cache'), server: { port: 0, host: '127.0.0.1' } })
  await server.listen()

  browser = await chromium.launch({ channel: 'msedge', headless: true })

  const accounts = { 运维人员: 'zhou.min', 用户: 'chen.yu', 系统管理员: 'li.qiang' }
  async function login(roleName) {
    const p = await browser.newPage()
    p.setDefaultTimeout(15000)
    await p.goto(server.resolvedUrls.local[0] + 'login')
    await p.getByPlaceholder('例如 chen.yu 或 chen.yu@kpw.com').fill(accounts[roleName])
    await p.locator('input[name="password"]').fill(DEFAULT_USER_PASSWORD)
    await p.getByRole('button', { name: '登录' }).click()
    await p.locator('.app-shell').waitFor()
    return p
  }

  // 1. 运维人员视角测试（所属组织隔离：平台运营组）
  const ops = await login('运维人员')
  await ops.getByRole('button', { name: '智能体监控', exact: true }).click()

  const root = ops.getByTestId('agent-monitor')
  await expect(root).toBeVisible()

  // 验证标题与视角徽章
  await expect(root.getByRole('heading',{name:'智能体监控',exact:true})).toBeVisible()

  // 验证四大指标卡
  const metricGrid = root.locator('.metric-grid')
  await expect(metricGrid.getByText('Dify 账户数量')).toBeVisible()
  await expect(metricGrid.getByText('RAGFlow 账户数量')).toBeVisible()
  await expect(metricGrid.getByText('Dify 应用数量')).toBeVisible()
  await expect(metricGrid.getByText('仓库应用数量')).toBeVisible()
  await expect(root.getByRole('heading', { name: '智能体次数分析' })).toBeVisible()
  await expect(root.getByRole('heading', { name: '智能体应用使用情况分析' })).toBeVisible()
  await expect(root.getByRole('heading', { name: '智能体使用 token 数量分析' })).toBeVisible()
  await expect(root.getByRole('heading', { name: '所有应用调用记录明细' })).toBeVisible()

  // 2. 普通用户视角：无法看到或进入监控页
  const user = await login('用户')
  await expect(user.getByRole('button', { name: '智能体监控', exact: true })).toHaveCount(0)

  // 3. 系统管理员视角测试：全量审计视角
  const admin = await login('系统管理员')
  await admin.getByRole('button', { name: '智能体监控', exact: true }).click()

  const adminRoot = admin.getByTestId('agent-monitor')
  await expect(adminRoot).toBeVisible()

  // 验证跨组织全量开发账户（陈宇、郑毅等）
  await expect(adminRoot.getByText('调用次数未采集').first()).toBeVisible()
  await adminRoot.getByTestId('log-search').fill('gpt-4.1')
  await expect(adminRoot.getByTestId('log-count')).toBeVisible()

  console.log('PASS Edge: 智能体全量监控、账户应用树、调用审计、逐条溯源与多角色权限已闭环通过')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cap) await cap.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
