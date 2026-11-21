import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { listen, json } from '../../../../../runtime/http.mjs'

const dir = await mkdtemp(join(tmpdir(), 'account-mon-browser-'))
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
  await ops.getByRole('button', { name: '账号与集成', exact: true }).click()

  const root = ops.getByTestId('account-monitor')
  await expect(root).toBeVisible()

  // 验证标题与视角徽章
  await expect(root.getByRole('heading',{name:'账号与集成监控',exact:true})).toBeVisible()

  // 验证五大指标卡
  const metricGrid = root.getByTestId('account-metric-grid')
  await expect(metricGrid).toBeVisible()
  await expect(metricGrid.getByText('映射总数')).toBeVisible()
  await expect(metricGrid.getByText('三方一致')).toBeVisible()
  await expect(metricGrid.getByText('缺 RAGFlow')).toBeVisible()
  await expect(metricGrid.getByText('缺 Dify')).toBeVisible()
  await expect(metricGrid.getByText('差异与冲突')).toBeVisible()

  // 验证默认 Tab：账号映射核对，并验证所属组织用户周敏在表格中
  const mappingsTable = root.getByTestId('account-mappings-table')
  await expect(mappingsTable).toBeVisible()
  await expect(mappingsTable.getByText('周敏')).toBeVisible()

  // 运维人员组织隔离：不应看到非本组普通账号，如 孙宁
  await expect(mappingsTable.getByText('孙宁')).toHaveCount(0)

  // 验证 Tab 2 切换：同步作业台账
  const syncTabBtn = root.getByRole('button', { name: /同步作业台账/ })
  await syncTabBtn.click()
  const syncTable = root.getByTestId('account-sync-table')
  await expect(syncTable).toBeVisible()
  await expect(syncTable.getByText('JOB-SYNC-9021')).toBeVisible()

  // 验证 Tab 3 切换：接口健康与探针
  const probesTabBtn = root.getByRole('button', { name: /接口健康与探针/ })
  await probesTabBtn.click()
  const probesTable = root.getByTestId('account-probes-table')
  await expect(probesTable).toBeVisible()
  await expect(probesTable.getByText('RAGFlow User API')).toBeVisible()
  await expect(probesTable.getByText('Dify Auth API')).toBeVisible()

  // 切回 Tab 1
  const mapTabBtn = root.getByRole('button', { name: /账号映射核对/ })
  await mapTabBtn.click()
  await expect(mappingsTable).toBeVisible()

  // 搜索过滤测试：输入 zhou.min
  const searchInput = root.getByLabel('搜索账号映射')
  await searchInput.fill('zhou.min')
  await root.getByRole('button', { name: '搜索' }).click()
  await expect(mappingsTable.getByText('zhou.min')).toBeVisible()

  // 2. 普通用户视角：无法看到或进入账号与集成监控页
  const user = await login('用户')
  await expect(user.getByRole('button', { name: '账号与集成', exact: true })).toHaveCount(0)

  // 3. 系统管理员视角测试：全量审计视角
  const admin = await login('系统管理员')
  await admin.getByRole('button', { name: '账号与集成', exact: true }).click()

  const adminRoot = admin.getByTestId('account-monitor')
  await expect(adminRoot).toBeVisible()

  // 系统管理员可查全量组织人员：孙宁、唐雨、高峰等跨组织账户
  const adminMappingsTable = adminRoot.getByTestId('account-mappings-table')
  await expect(adminMappingsTable).toBeVisible()
  await expect(adminMappingsTable.getByText('孙宁')).toBeVisible()
  await expect(adminMappingsTable.getByText('高峰')).toBeVisible()

  console.log('PASS Edge: 账号与集成监控、五卡指标、三Tab切换、探针台账、搜索过滤与角色权限隔离已闭环通过')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cap) await cap.close()
}
