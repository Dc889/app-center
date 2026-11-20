import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { listen, json } from '../../../../../runtime/http.mjs'

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

  async function login(roleName) {
    const p = await browser.newPage()
    p.setDefaultTimeout(15000)
    await p.goto(server.resolvedUrls.local[0])
    await p.getByRole('button', { name: new RegExp('^' + roleName) }).click()
    return p
  }

  // 1. 运维人员视角测试（所属组织隔离：平台运营组）
  const ops = await login('运维人员')
  await ops.getByRole('button', { name: '智能体监控', exact: true }).click()

  const root = ops.getByTestId('agent-monitor')
  await expect(root).toBeVisible()

  // 验证标题与视角徽章
  await expect(root.getByText(/按账户查看 Dify 上的全部智能体、应用数量和调用记录/)).toBeVisible()
  await expect(root.getByText(/运维视角（所属组织隔离）/)).toBeVisible()

  // 验证四大指标卡
  const metricGrid = root.locator('.metric-grid')
  await expect(metricGrid.getByText('Dify 账户')).toBeVisible()
  await expect(metricGrid.getByText('全部应用')).toBeVisible()
  await expect(metricGrid.getByText('未进仓库')).toBeVisible()
  await expect(metricGrid.getByText('调用记录')).toBeVisible()

  // 验证左侧账户树
  const accountTree = root.getByTestId('account-tree')
  await expect(accountTree).toBeVisible()
  await expect(accountTree.getByText('周敏')).toBeVisible()

  // 验证调用日志表格
  const logTable = root.getByTestId('invocation-log')
  await expect(logTable).toBeVisible()

  // 点击溯源按钮打开抽屉
  const firstTraceBtn = logTable.getByRole('button', { name: '溯源' }).first()
  await firstTraceBtn.click()

  const traceDrawer = root.getByTestId('invocation-trace')
  await expect(traceDrawer).toBeVisible()
  await expect(traceDrawer.getByText(/本次实际使用/)).toBeVisible()

  // 关闭抽屉
  await traceDrawer.getByLabel('关闭调用详情').click()
  await expect(traceDrawer).toHaveCount(0)

  // 2. 普通用户视角：无法看到或进入监控页
  const user = await login('用户')
  await expect(user.getByRole('button', { name: '智能体监控', exact: true })).toHaveCount(0)

  // 3. 系统管理员视角测试：全量审计视角
  const admin = await login('系统管理员')
  await admin.getByRole('button', { name: '智能体监控', exact: true }).click()

  const adminRoot = admin.getByTestId('agent-monitor')
  await expect(adminRoot).toBeVisible()
  await expect(adminRoot.getByText(/系统管理员视角（全量审计）/)).toBeVisible()

  // 验证跨组织全量开发账户（陈宇、郑毅等）
  const adminTree = adminRoot.getByTestId('account-tree')
  await expect(adminTree.getByText('陈宇')).toBeVisible()
  await expect(adminTree.getByText('郑毅')).toBeVisible()

  // 搜索过滤测试：搜 gpt-4.1
  await adminRoot.getByTestId('log-search').fill('gpt-4.1')
  await expect(adminRoot.getByTestId('log-count')).toBeVisible()

  console.log('PASS Edge: 智能体全量监控、账户应用树、调用审计、逐条溯源与多角色权限已闭环通过')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cap) await cap.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
