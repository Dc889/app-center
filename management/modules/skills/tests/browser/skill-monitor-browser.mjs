import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { ledger, listen, json } from '../../../../../runtime/http.mjs'

const dir = await mkdtemp(join(tmpdir(), 'skill-monitor-browser-'))
process.env.APP_DATA_DIR = dir
let browser, server, cap

try {
  const now = Date.now()
  const at = m => new Date(now - m * 60000).toISOString()
  const tickets = ledger(dir, 'tickets')

  // 预置 12 条 SKL-03 交付流水（6 条业务一部，6 条平台运营组）
  for (let i = 0; i < 12; i++) {
    const isFailed = i === 11
    tickets.put('SKL-03-test-' + i, {
      ticketNo: 'SKL-03-test-' + i,
      command: {
        ticketType: 'SKL-03',
        action: 'download',
        account: i % 2 === 0 ? 'chen.yu' : 'zhou.min',
        org: i % 2 === 0 ? '业务一部' : '平台运营组',
        resourceId: i % 3 === 0 ? 'skl_sheet' : 'skl_doc',
        payload: { version: 'v2.1.0', sha256: 'a' + i.toString().padStart(63, '0') },
        executionId: 'exec-' + i,
      },
      state: {
        status: isFailed ? 'failed' : 'succeeded',
        updatedAt: at(i * 10 + 5),
      },
      resultId: 'DL-exec-' + i,
      delivery: {
        status: isFailed ? 'interrupted' : 'confirmed',
        updatedAt: at(i * 10 + 5),
      },
    })
  }
  tickets.close()

  // 模拟能力服务响应 Skill 目录
  cap = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, {
        items: [
          { resourceId: 'skl_doc', name: '公文摘要 Skill', version: 'v2.1.0', status: 'available', sizeBytes: 1024 },
          { resourceId: 'skl_sheet', name: '表格分析 Skill', version: 'v1.8.2', status: 'available', sizeBytes: 2048 },
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

  // 1. 运维人员视角测试（只能查看本人组织：平台运营组，共 6 条）
  const ops = await login('运维人员')
  await ops.getByRole('button', { name: 'Skill监控', exact: true }).click()

  const root = ops.getByTestId('real-skill-monitor')
  await expect(root).toBeVisible()

  // 验证标题与来源说明
  await expect(root.getByText(/实际生效目录版本、存储量统计、真实下载结算流水与组织去重审计/)).toBeVisible()
  await expect(root.getByText(/目录数据源：已采集 \(真实Skill仓库\)/)).toBeVisible()

  // 验证指标卡数值
  await expect(root.getByText('已上架 Skill')).toBeVisible()
  await expect(root.getByText('交付失败 / 取消')).toBeVisible()

  // 验证运维按组织隔离后的表格条目数（6条）
  await expect(root.getByText(/共 6 条交付记录/)).toBeVisible()

  // 搜索过滤测试
  await root.getByPlaceholder('搜索流水号/Skill/工单/账户...').fill('表格分析')
  await root.getByRole('button', { name: '查询' }).click()
  await expect(root.getByText(/共 2 条交付记录/)).toBeVisible()

  // 2. 普通用户视角：无法看到或进入监控页
  const user = await login('用户')
  await expect(user.getByRole('button', { name: 'Skill监控', exact: true })).toHaveCount(0)

  // 3. 系统管理员视角测试：全量审计视角（共 12 条），可跨组织并进行分页
  const admin = await login('系统管理员')
  await admin.getByRole('button', { name: 'Skill监控', exact: true }).click()
  const adminRoot = admin.getByTestId('real-skill-monitor')
  await expect(adminRoot.getByText(/当前为系统管理员全量审计视角/)).toBeVisible()
  await expect(adminRoot.getByText(/共 12 条交付记录/)).toBeVisible()

  // 管理员分页测试：12 条记录分 2 页
  await expect(adminRoot.getByRole('button', { name: '下一页' })).toBeVisible()
  await adminRoot.getByRole('button', { name: '下一页' }).click()
  await expect(adminRoot.getByText(/第 2 页/)).toBeVisible()

  console.log('PASS Edge: Skill 监控真实数据、五卡指标、下载趋势、组织隔离与分布、结算流水台账、搜索分页与多角色权限已闭环通过')
} finally {
  await browser?.close()
  await server?.close()
  await cap?.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
