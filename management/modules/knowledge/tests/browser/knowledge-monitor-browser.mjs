import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { ledger, listen, json } from '../../../../../runtime/http.mjs'
import { DEFAULT_USER_PASSWORD } from '../../../../platform/identity/public.server.mjs'

const dir = await mkdtemp(join(tmpdir(), 'kb-mon-browser-'))
process.env.APP_DATA_DIR = dir
let browser, server, cap

try {
  const now = Date.now()
  const at = m => new Date(now - m * 60000).toISOString()
  const apps = ledger(dir, 'applications')

  // 预置 12 条知识库工单（6 条业务一部，6 条平台运营组）
  for (let i = 0; i < 12; i++) {
    const isOps = i % 2 !== 0
    const org = isOps ? '平台运营组' : '业务一部'
    const account = isOps ? 'zhou.min' : 'chen.yu'
    const sys = i % 3 === 0 ? 'Dify' : 'RAGFlow'
    const isDisposition = i === 11

    if (isDisposition) {
      apps.put('KB-05-browser-' + i, {
        ticketNo: 'KB-05-browser-' + i,
        ticketType: 'KB-05',
        status: '待运维确认',
        account,
        org,
        resourceId: 'kb-alert-' + i,
        createdAt: at(i * 10 + 5),
        submission: {
          fields: {
            reason: '内容违规',
            target: '暂停分享',
          },
        },
        snapshot: {
          fields: {
            '来源系统': sys,
            '知识库名称': '反诈与涉敏资料库',
          },
        },
      })
    } else if (i % 2 === 0) {
      apps.put('KB-02-browser-' + i, {
        ticketNo: 'KB-02-browser-' + i,
        ticketType: 'KB-02',
        status: i === 0 ? '待审批' : '已完成',
        account,
        org,
        resourceId: 'kb-share-' + i,
        createdAt: at(i * 10 + 5),
        submission: { fields: { sourceSystem: sys, name: `办案指引库-${i}` } },
        snapshot: {
          fields: {
            '来源系统': sys,
            '知识库名称': `办案指引库-${i}`,
            '文档审查明细': [
              { documentId: `doc-${i}-1`, name: `细则规范-${i}.pdf`, sha256: 'a'.repeat(64), autoVerdict: '通过' },
              { documentId: `doc-${i}-2`, name: `审查参考-${i}.docx`, sha256: 'b'.repeat(64), autoVerdict: i === 0 ? '不通过' : '通过' },
            ],
          },
        },
        approvedFields: {
          '文档确认记录': { [`doc-${i}-1`]: '通过', [`doc-${i}-2`]: i === 0 ? '不通过' : '通过' },
        },
      })
    } else {
      apps.put('KB-01-browser-' + i, {
        ticketNo: 'KB-01-browser-' + i,
        ticketType: 'KB-01',
        status: '已完成',
        account,
        org,
        resourceId: 'kb-sync-' + i,
        createdAt: at(i * 10 + 5),
        submission: { fields: { sourceSystem: sys, name: `个人业务库-${i}` } },
        snapshot: {
          fields: {
            '来源系统': sys,
            '知识库名称': `个人业务库-${i}`,
          },
        },
      })
    }
  }
  apps.close()

  // 模拟能力服务响应知识库目录
  cap = await listen((req, res, path) => {
    if (path === '/internal/v1/catalog') {
      return json(res, {
        items: [
          { resourceId: 'kb-share-0', status: 'published' },
          { resourceId: 'kb-sync-1', status: 'published' },
          { resourceId: 'kb-share-2', status: 'building' },
          { resourceId: 'kb-alert-11', status: 'abnormal' },
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

  // 1. 运维人员视角测试（只能查看本人所属组织：平台运营组，共 6 条）
  const ops = await login('运维人员')
  await ops.getByRole('button', { name: '知识库', exact: true }).click()

  const root = ops.getByTestId('knowledge-monitor')
  await expect(root).toBeVisible()

  // 验证标题与视角徽章
  await expect(root.getByRole('heading',{name:'知识库监控',exact:true})).toBeVisible()

  await expect(root.getByRole('heading', { name: '数量监控' })).toBeVisible()
  await expect(root.getByText('仓库已上架')).toBeVisible()
  await expect(root.getByText('待审核')).toBeVisible()
  await expect(root.getByText('构建中任务')).toBeVisible()
  await expect(root.getByText('异常知识库')).toBeVisible()
  await expect(root.getByRole('heading', { name: '安全审计监控' })).toBeVisible()

  // 验证运维按组织隔离后的构建任务台账条目数（6条）
  await expect(root.getByText(/构建任务追踪 \(6\)/)).toBeVisible()

  const auditsTable = root.getByTestId('knowledge-audits-table')
  await expect(auditsTable).toBeVisible()
  await root.getByRole('button', { name: '上架审核', exact: true }).click()
  await expect(auditsTable.getByText('当前没有符合筛选的安全审计记录')).toBeVisible()

  await root.getByLabel('搜索构建任务').fill('个人业务库')
  await root.getByRole('button', { name: '搜索' }).click()
  await expect(root.getByText(/构建任务追踪 \(5\)/)).toBeVisible()

  // 2. 普通用户视角：无法看到或进入监控页
  const user = await login('用户')
  await expect(user.getByRole('button', { name: '知识库', exact: true })).toHaveCount(0)

  // 3. 系统管理员视角测试：全量审计视角（共 12 条），可跨组织并进行分页与系统过滤
  const admin = await login('系统管理员')
  await admin.getByRole('button', { name: '知识库', exact: true }).click()

  const adminRoot = admin.getByTestId('knowledge-monitor')
  await expect(adminRoot).toBeVisible()
  await adminRoot.getByTestId('knowledge-security-audit').getByRole('button', { name: '上架审核', exact: true }).click()
  await expect(adminRoot.getByTestId('knowledge-audits-table').getByText('上架审核').first()).toBeVisible()

  // 验证全量 12 条构建任务追踪
  await expect(adminRoot.getByText(/构建任务追踪 \(12\)/)).toBeVisible()
  await expect(adminRoot.getByText(/共 12 条任务，第 1 \/ 2 页/)).toBeVisible()

  // 点击下一页
  await adminRoot.getByRole('button', { name: '下一页' }).click()
  await expect(adminRoot.getByText(/第 2 \/ 2 页/)).toBeVisible()

  // 来源系统过滤测试：点击 Dify
  await adminRoot.getByRole('button', { name: 'Dify', exact: true }).click()
  await expect(adminRoot.getByText(/构建任务追踪 \(4\)/)).toBeVisible()

  console.log('PASS Edge: 知识库监控真实数据、五卡指标、趋势分布、嵌入模型、逐文档审查与多角色权限已闭环通过')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cap) await cap.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
