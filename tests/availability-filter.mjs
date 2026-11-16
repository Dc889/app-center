import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})

const expected = {
  知识库: { category: 'knowledge', available: 3, unavailable: 3 },
  插件: { category: 'plugins', available: 3, unavailable: 3 },
  '智能体与广场': { category: 'agents', available: 4, unavailable: 2 },
  MCP: { category: 'mcp', available: 3, unavailable: 3 },
  Skill: { category: 'skills', available: 3, unavailable: 2 },
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^运维人员/ }).click()

  for (const [label, counts] of Object.entries(expected)) {
    await page.locator('nav button').filter({ hasText: label }).first().click()
    const panel = page.getByTestId('availability-panel')
    await panel.waitFor()
    assert.equal(await panel.getAttribute('data-category'), counts.category)
    assert.equal(Number(await panel.getByTestId('available-count').innerText()), counts.available)
    assert.equal(Number(await panel.getByTestId('unavailable-count').innerText()), counts.unavailable)
    assert.equal(await panel.getByTestId('availability-table').locator('tbody tr').count(), counts.available + counts.unavailable)

    await panel.getByTestId('availability-status-filter').selectOption('不能用')
    assert.equal(await panel.getByTestId('availability-table').locator('tbody tr').count(), counts.unavailable)
    for (const row of await panel.getByTestId('availability-table').locator('tbody tr').all()) {
      assert.equal((await row.locator('td').nth(2).innerText()).trim(), '不能用')
    }

    await panel.getByTestId('availability-status-filter').selectOption('能用')
    assert.equal(await panel.getByTestId('availability-table').locator('tbody tr').count(), counts.available)
    for (const row of await panel.getByTestId('availability-table').locator('tbody tr').all()) {
      assert.equal((await row.locator('td').nth(2).innerText()).trim(), '能用')
    }
  }

  await page.locator('nav button').filter({ hasText: 'MCP' }).first().click()
  const toolPanel = page.getByTestId('availability-panel')
  await toolPanel.getByRole('button', { name: 'Skill', exact: true }).click()
  assert.equal(await toolPanel.getAttribute('data-category'), 'skills')
  assert.equal(await toolPanel.getByTestId('availability-table').locator('tbody tr').count(), 5)

  await page.locator('nav button').filter({ hasText: '智能体与广场' }).click()
  await page.getByTestId('organization-filter').selectOption('业务一部')
  assert.equal(await page.getByTestId('agent-call-table').locator('tbody tr').count(), 4)
  await page.screenshot({ path: 'browser-results/ops-availability-and-agent-filter.png', fullPage: true })

  const userPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await userPage.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' })
  await userPage.getByRole('button', { name: /^用户/ }).click()
  assert.equal(await userPage.getByTestId('availability-panel').count(), 0)
  assert(!(await userPage.locator('nav').innerText()).includes('知识库'))
  await userPage.close()

  assert.equal(errors.length, 0, `浏览器控制台错误：${errors.join('; ')}`)
  console.log('运维人员：知识库、插件、智能体、MCP/Skill 分栏均已核对')
  console.log('状态筛选：能用与不能用均实际过滤表格')
  console.log('智能体组织筛选：业务一部仍同步过滤为 4 次调用')
  console.log('用户身份：没有监控入口或可用性表')
} finally {
  await browser.close()
}
