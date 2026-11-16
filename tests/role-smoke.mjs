import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const baseUrl = 'http://127.0.0.1:5174'
const executablePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const outputDir = new URL('../browser-results/', import.meta.url)

const roles = [
  {
    name: '用户',
    pages: ['对话申请', '手工申请', '我的申请'],
    absent: ['统一概览', '我的待办', '工单查询', '工单类型'],
    screenshot: 'user.png',
  },
  {
    name: '运维人员',
    pages: [
      '统一概览', '知识库', '智能体与广场', '插件', 'MCP', 'Skill',
      '安全事件', '账号与集成', '审计追踪', '对话申请', '手工申请',
      '我的申请', '我的待办', '工单查询',
    ],
    absent: ['工单类型'],
    screenshot: 'ops.png',
  },
  {
    name: '系统管理员',
    pages: [
      '统一概览', '知识库', '智能体与广场', '插件', 'MCP', 'Skill',
      '安全事件', '账号与集成', '审计追踪', '对话申请', '手工申请',
      '我的申请', '我的待办', '工单查询', '工单类型',
    ],
    absent: [],
    screenshot: 'admin.png',
  },
]

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })

try {
  for (const role of roles) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: new RegExp(`^${role.name}`) }).click()
    await page.locator('.app-shell').waitFor()
    await page.screenshot({
      path: new URL(`${role.name === '用户' ? 'user' : role.name === '运维人员' ? 'ops' : 'admin'}-home.png`, outputDir).pathname.slice(1),
      fullPage: true,
    })

    const navText = await page.locator('nav').innerText()
    assert(!navText.includes('设置'), `${role.name}不应出现设置入口`)
    for (const hidden of role.absent) {
      assert(!navText.includes(hidden), `${role.name}不应看到“${hidden}”`)
    }

    for (const label of role.pages) {
      const entry = page.locator('nav button').filter({ hasText: label }).first()
      await entry.click()
      await page.waitForTimeout(80)
      assert(await page.locator('.page-header h1').isVisible(), `${role.name}打开“${label}”后页面标题不可见`)
    }

    await page.screenshot({ path: new URL(role.screenshot, outputDir).pathname.slice(1), fullPage: true })
    assert.equal(errors.length, 0, `${role.name}页面出现浏览器错误：${errors.join('; ')}`)
    console.log(`${role.name}: 已核对 ${role.pages.length} 个页面`)
    await page.close()
  }
} finally {
  await browser.close()
}
