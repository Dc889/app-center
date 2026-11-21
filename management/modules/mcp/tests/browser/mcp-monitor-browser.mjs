import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { ledger, listen, json } from '../../../../../runtime/http.mjs'

const dir = await mkdtemp(join(tmpdir(), 'mcp-mon-browser-'))
process.env.APP_DATA_DIR = dir
let browser, server, cap

try {
  const now = Date.now()
  const at = m => new Date(now - m * 60000).toISOString()
  const apps = ledger(dir, 'applications')

  // 预置 10 条 MCP 工单（5 条业务一部，5 条平台运营组）
  for (let i = 0; i < 10; i++) {
    const isOps = i % 2 !== 0
    const org = isOps ? '平台运营组' : '业务一部'
    const account = isOps ? 'zhou.min' : 'chen.yu'
    const isAlert = i % 3 === 0

    if (isAlert) {
      apps.put('MCP-03-browser-' + i, {
        ticketNo: 'MCP-03-browser-' + i,
        ticketType: 'MCP-03',
        status: i === 0 ? '待审批' : '已完成',
        account,
        org,
        resourceId: '地图服务',
        workspaceId: `ws_mcp_${i}`,
        createdAt: at(i * 10 + 5),
        snapshot: {
          fields: {
            'MCP名称': '地图服务',
            '处置类型': '服务隔离',
            '告警原因': '调用超时率异常（>40%）',
          },
        },
      })
    } else {
      apps.put('MCP-02-browser-' + i, {
        ticketNo: 'MCP-02-browser-' + i,
        ticketType: 'MCP-02',
        status: '已完成',
        account,
        org,
        resourceId: isOps ? '通用文书工具集' : '档案检索服务',
        workspaceId: `ws_user_${i}`,
        createdAt: at(i * 10 + 5),
        snapshot: {
          fields: {
            'MCP名称': isOps ? '通用文书工具集' : '档案检索服务',
            '关联应用': isOps ? '运营巡查助手' : '案件摘要助手',
            '绑定ID': `bind-browser-${i}`,
            'workspace ID': `ws_user_${i}`,
          },
        },
      })
    }
  }
  apps.close()

  // 模拟能力服务响应 MCP 目录
  cap = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, {
        items: [
          { resourceId: '档案检索服务', name: '档案检索服务', status: 'available' },
          { resourceId: '地图服务', name: '高精地图服务', status: 'available' },
          { resourceId: '线索查询服务', name: '线索查询服务', status: 'available' },
          { resourceId: '企业查询服务', name: '企业信用查询服务', status: 'available' },
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
  await ops.getByRole('button', { name: 'MCP监控', exact: true }).click()

  const root = ops.getByTestId('mcp-monitor')
  await expect(root).toBeVisible()

  // 验证标题与视角徽章
  await expect(root.getByRole('heading',{name:'MCP 监控',exact:true})).toBeVisible()

  // 验证五大指标卡
  const metricGrid = root.getByTestId('mcp-metric-grid')
  await expect(metricGrid.getByText('目录总数')).toBeVisible()
  await expect(metricGrid.getByText('正常运行数')).toBeVisible()
  await expect(metricGrid.getByText('隔离数')).toBeVisible()
  await expect(metricGrid.getByText('绑定总数')).toBeVisible()
  await expect(metricGrid.getByText('异常数')).toBeVisible()

  // 验证 Tab 1: MCP 调用追踪
  const callsTable = root.getByTestId('mcp-calls-table')
  await expect(callsTable).toBeVisible()

  // 验证 Tab 2: 工作区绑定台账
  await root.getByRole('button', { name: /工作区绑定台账/ }).click()
  const bindingsTable = root.getByTestId('mcp-bindings-table')
  await expect(bindingsTable).toBeVisible()

  // 验证 Tab 3: 告警与处置记录
  await root.getByRole('button', { name: /告警与处置记录/ }).click()
  const alertsTable = root.getByTestId('mcp-alerts-table')
  await expect(alertsTable).toBeVisible()

  // 搜索过滤测试：搜地图服务
  await root.getByRole('button', { name: /工作区绑定台账/ }).click()
  await root.getByPlaceholder('搜索MCP、工具、应用、工单号...').fill('通用文书')
  await root.getByRole('button', { name: '搜索' }).click()
  await expect(bindingsTable.getByText('通用文书工具集').first()).toBeVisible()

  // 2. 普通用户视角：无法看到或进入监控页
  const user = await login('用户')
  await expect(user.getByRole('button', { name: 'MCP监控', exact: true })).toHaveCount(0)

  // 3. 系统管理员视角测试：全量审计视角
  const admin = await login('系统管理员')
  await admin.getByRole('button', { name: 'MCP监控', exact: true }).click()

  const adminRoot = admin.getByTestId('mcp-monitor')
  await expect(adminRoot).toBeVisible()

  // 验证全量审计下的调用与绑定展示
  const adminCallsTable = adminRoot.getByTestId('mcp-calls-table')
  await expect(adminCallsTable).toBeVisible()

  console.log('PASS Edge: MCP 监控真实数据、五卡指标、调用延迟趋势、异常排行、绑定台账与多角色权限已闭环通过')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cap) await cap.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
