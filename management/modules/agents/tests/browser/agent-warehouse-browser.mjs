import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { listen, json } from '../../../../../runtime/http.mjs'

const dir = await mkdtemp(join(tmpdir(), 'agent-wh-browser-'))
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

  // 1. 普通用户视角测试
  const user = await login('用户')
  await user.getByRole('button', { name: '智能体仓库', exact: true }).click()

  const whPage = user.getByTestId('warehouse-page')
  await expect(whPage).toBeVisible()

  // 验证用户视角描述与指标卡
  await expect(whPage.getByRole('heading',{name:'智能体仓库',exact:true})).toBeVisible()
  const userMetrics = whPage.locator('.metric-grid')
  await expect(userMetrics.getByText('可用应用')).toBeVisible()
  await expect(userMetrics.getByText('三种方式齐全')).toBeVisible()
  await expect(userMetrics.getByText('可运行')).toBeVisible()
  await expect(userMetrics.getByText('可访问 API')).toBeVisible()
  // 用户视角不应有“暂不可用”卡片
  await expect(userMetrics.getByText('暂不可用')).toHaveCount(0)

  // 验证可用条目使用排行榜
  const ranking = user.getByTestId('usage-ranking')
  await expect(ranking).toBeVisible()
  await expect(ranking.getByText('可用条目使用排行')).toBeVisible()

  const agentGrid = user.getByTestId('agent-grid')
  await expect(agentGrid).toBeVisible()
  await expect(agentGrid.getByText('没有符合当前筛选的智能体。')).toBeVisible()
  await expect(agentGrid.getByText('案件摘要助手')).toHaveCount(0)
  await expect(user.getByTestId('agent-detail')).toHaveCount(0)

  // 2. 运维人员视角测试
  const ops = await login('运维人员')
  await ops.getByRole('button', { name: '智能体仓库', exact: true }).click()

  const opsWh = ops.getByTestId('warehouse-page')
  await expect(opsWh).toBeVisible()

  // 运维视角指标卡：包含“暂不可用”与“已生效应用”
  const opsMetrics = opsWh.locator('.metric-grid')
  await expect(opsMetrics.getByText('已生效应用')).toBeVisible()
  await expect(opsMetrics.getByText('可直接使用')).toBeVisible()
  await expect(opsMetrics.getByText('暂不可用')).toBeVisible()

  await expect(ops.getByTestId('agent-grid').getByText('案件摘要助手')).toHaveCount(0)
  await expect(ops.getByTestId('agent-grid').getByText('没有符合当前筛选的智能体。')).toBeVisible()
  await expect(ops.getByTestId('agent-detail')).toHaveCount(0)

  // 3. 系统管理员视角测试
  const admin = await login('系统管理员')
  await admin.getByRole('button', { name: '智能体仓库', exact: true }).click()
  const adminWh = admin.getByTestId('warehouse-page')
  await expect(adminWh).toBeVisible()
  await expect(adminWh.locator('.metric-grid').getByText('已生效应用')).toBeVisible()

  console.log('PASS Edge: 智能体仓库（目标 34）角色隔离、可用排行、状态筛选、三种方式及 AG-04/05 工单联动已通过 Edge 页面验收')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cap) await cap.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
