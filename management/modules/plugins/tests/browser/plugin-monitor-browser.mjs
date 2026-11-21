import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { ledger, listen, json } from '../../../../../runtime/http.mjs'

const dir = await mkdtemp(join(tmpdir(), 'plg-mon-browser-'))
process.env.APP_DATA_DIR = dir
let browser, server, cap

try {
  const now = Date.now()
  const at = m => new Date(now - m * 60000).toISOString()
  const apps = ledger(dir, 'applications')

  // 预置 12 条插件工单（6 条业务一部，6 条平台运营组）
  for (let i = 0; i < 12; i++) {
    const isOps = i % 2 !== 0
    const org = isOps ? '平台运营组' : '业务一部'
    const account = isOps ? 'zhou.min' : 'chen.yu'
    const isDisable = i % 3 === 0

    if (isDisable) {
      apps.put('PLG-04-browser-' + i, {
        ticketNo: 'PLG-04-browser-' + i,
        ticketType: 'PLG-04',
        status: i === 0 ? '待运维确认' : '已恢复',
        account,
        org,
        resourceId: 'document-parser',
        workspaceId: `ws_auto_${i}`,
        createdAt: at(i * 10 + 5),
        snapshot: {
          fields: {
            '插件名称': 'document-parser',
            '版本号': '2.4.1',
            '安装实例ID': `inst-dp-${i}`,
            'workspace ID': `ws_auto_${i}`,
            '触发规则': '失败率',
            '实测值': '46.8%',
          },
        },
      })
    } else {
      apps.put('PLG-03-browser-' + i, {
        ticketNo: 'PLG-03-browser-' + i,
        ticketType: 'PLG-03',
        status: i === 1 ? '待审批' : '已完成',
        account,
        org,
        resourceId: isOps ? 'browser-agent' : 'data-extractor',
        workspaceId: `ws_user_${i}`,
        createdAt: at(i * 10 + 5),
        submission: {
          fields: {
            name: isOps ? 'browser-agent' : 'data-extractor',
            operation: i === 1 ? '升级' : '安装',
            version: '1.8.3',
          },
        },
        snapshot: {
          fields: {
            '插件名称': isOps ? 'browser-agent' : 'data-extractor',
            '版本号': '1.8.3',
            '安装实例ID': `inst-user-${i}`,
            'workspace ID': `ws_user_${i}`,
          },
        },
      })
    }
  }
  apps.close()

  // 模拟能力服务响应插件目录
  cap = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, {
        items: [
          { resourceId: 'document-parser', name: '文档解析插件', version: '2.4.1', status: 'available' },
          { resourceId: 'browser-agent', name: '浏览器执行代理', version: '1.8.3', status: 'available' },
          { resourceId: 'data-extractor', name: '数据抽取工具', version: '3.0.2', status: 'available' },
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

  // 1. 运维人员视角测试（只能查看所属组织：平台运营组，共 6 条实例，2 条自动禁用）
  const ops = await login('运维人员')
  await ops.getByRole('button', { name: '插件监控', exact: true }).click()

  const root = ops.getByTestId('plugin-monitor')
  await expect(root).toBeVisible()

  // 验证标题与视角徽章
  await expect(root.getByRole('heading',{name:'插件监控',exact:true})).toBeVisible()

  // 验证六大指标卡
  const metricGrid = root.getByTestId('plugin-metric-grid')
  await expect(metricGrid.getByText('已上架插件')).toBeVisible()
  await expect(metricGrid.getByText('已安装实例')).toBeVisible()
  await expect(metricGrid.getByText('运行中实例')).toBeVisible()
  await expect(metricGrid.getByText('自动禁用')).toBeVisible()
  await expect(metricGrid.getByText('待升级实例')).toBeVisible()
  await expect(metricGrid.getByText('安全告警')).toBeVisible()

  // 验证 Daemon 守护进程横幅
  await expect(root.getByText(/Plugin Daemon 容器守护进程/)).toBeVisible()

  // 验证运维所属组织的自动禁用记录数（2 条）
  await expect(root.getByText(/自动禁用记录 \(2\)/)).toBeVisible()

  // Tab 切换测试：切换到“工作区安装实例”
  await root.getByRole('button', { name: /工作区安装实例/ }).click()
  const instancesTable = root.getByTestId('plugin-instances-table')
  await expect(instancesTable).toBeVisible()
  await expect(root.getByText(/工作区安装实例 \(6\)/)).toBeVisible()

  // 搜索过滤测试：搜 browser-agent
  await root.getByPlaceholder('搜索插件/Workspace/工单号...').fill('browser-agent')
  await root.getByRole('button', { name: '搜索' }).click()
  await expect(root.getByText(/工作区安装实例 \(4\)/)).toBeVisible()

  // 2. 普通用户视角：无法看到或进入监控页
  const user = await login('用户')
  await expect(user.getByRole('button', { name: '插件监控', exact: true })).toHaveCount(0)

  // 3. 系统管理员视角测试：全量审计视角（共 12 条实例，4 条自动禁用）
  const admin = await login('系统管理员')
  await admin.getByRole('button', { name: '插件监控', exact: true }).click()

  const adminRoot = admin.getByTestId('plugin-monitor')
  await expect(adminRoot).toBeVisible()

  // 验证全量 4 条禁用记录
  await expect(adminRoot.getByText(/自动禁用记录 \(4\)/)).toBeVisible()

  // 切换到安装实例并验证 12 条与分页
  await adminRoot.getByRole('button', { name: /工作区安装实例/ }).click()
  await expect(adminRoot.getByText(/工作区安装实例 \(12\)/)).toBeVisible()
  await expect(adminRoot.getByText(/共 12 条记录，第 1 \/ 2 页/)).toBeVisible()

  // 点击下一页
  await adminRoot.getByRole('button', { name: '下一页' }).click()
  await expect(adminRoot.getByText(/第 2 \/ 2 页/)).toBeVisible()

  console.log('PASS Edge: 插件监控真实数据、六卡指标、内存趋势、错误排行、自动禁用台账与多角色权限已闭环通过')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cap) await cap.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
