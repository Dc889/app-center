import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^运维人员/ }).click()
  await page.locator('nav button').filter({ hasText: '智能体与广场' }).click()
  await page.getByTestId('agent-call-table').waitFor()

  const expectedHeaders = [
    '时间', '调用方式', '用户账户名', '用户组织', '密钥登记 ID', '调用方名称',
    '调用方组织', '来源 IP', '应用名', 'Dify 运行 ID', '耗时', '结果',
  ]
  assert.deepEqual(
    await page.getByTestId('agent-call-table').locator('thead th').allTextContents(),
    expectedHeaders,
  )
  assert.equal(await page.getByTestId('agent-call-table').locator('tbody tr').count(), 18)
  assert.equal(await page.getByTestId('call-trend-chart').getAttribute('data-total'), '18')
  assert.equal(await page.getByTestId('organization-chart').getAttribute('data-bars'), '6')
  assert.equal(await page.getByTestId('result-chart').getAttribute('data-success'), '14')
  assert.equal(await page.getByTestId('result-chart').getAttribute('data-failure'), '4')

  await page.getByTestId('organization-filter').selectOption('业务一部')
  assert.equal(await page.getByTestId('agent-call-table').locator('tbody tr').count(), 4)
  assert.equal(await page.getByTestId('call-trend-chart').getAttribute('data-total'), '4')
  assert.equal(await page.getByTestId('organization-chart').getAttribute('data-bars'), '1')
  assert.equal(await page.getByTestId('organization-chart').getAttribute('data-total'), '4')
  assert.equal(await page.getByTestId('result-chart').getAttribute('data-success'), '3')
  assert.equal(await page.getByTestId('result-chart').getAttribute('data-failure'), '1')

  for (const row of await page.getByTestId('agent-call-table').locator('tbody tr').all()) {
    const cells = await row.locator('td').allTextContents()
    assert(cells[3] === '业务一部' || cells[6] === '业务一部')
  }

  await page.getByTestId('organization-filter').selectOption('情指中心')
  assert.equal(await page.getByTestId('agent-call-table').locator('tbody tr').count(), 3)
  assert.equal(await page.getByTestId('call-trend-chart').getAttribute('data-total'), '3')
  assert.equal(await page.getByTestId('organization-chart').getAttribute('data-bars'), '1')
  assert.equal(await page.getByTestId('result-chart').getAttribute('data-success'), '2')
  assert.equal(await page.getByTestId('result-chart').getAttribute('data-failure'), '1')
  await page.screenshot({ path: 'browser-results/agent-calls-filtered.png', fullPage: true })

  const userPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await userPage.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' })
  await userPage.getByRole('button', { name: /^用户/ }).click()
  assert(!(await userPage.locator('nav').innerText()).includes('智能体与广场'))
  await userPage.close()

  assert.equal(errors.length, 0, `浏览器控制台错误：${errors.join('; ')}`)
  console.log('全部组织：18 次，6 个组织，成功 14 / 失败 4')
  console.log('业务一部：4 次，成功 3 / 失败 1，表格与图表同步过滤')
  console.log('情指中心：3 次，成功 2 / 失败 1，表格与图表同步过滤')
  console.log('用户身份：未显示智能体与广场入口')
} finally {
  await browser.close()
}
