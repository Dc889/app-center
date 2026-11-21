import {mkdir, mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve, join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'

// Isolated UI review only: no production ledgers, credentials or product write operations.
const label = process.env.UI_REVIEW_LABEL ?? 'current'
const output = resolve('.local-data', 'ui-review', label)
const state = await mkdtemp(join(tmpdir(), 'app-center-ui-review-'))
await mkdir(output, {recursive: true})
process.env.APP_DATA_DIR = state
process.env.CAPABILITY_STRICT_UPSTREAM = '1'
for (const key of ['DIFY_API_BASE','DIFY_API_URL','DIFY_CONSOLE_TOKEN','DIFY_API_KEY','RAGFLOW_API_BASE','RAGFLOW_API_URL',
  'RAGFLOW_API_KEY','RAGFLOW_TOKEN','CAPABILITY_EVIDENCE_FILE','CAPABILITY_URL','MANAGEMENT_URL']) delete process.env[key]
let server, browser
const rows = [], errors = []
try {
  server = await createServer({cacheDir: join(state, 'vite-cache'), server: {port: 0, host: '127.0.0.1'}})
  await server.listen()
  browser = await chromium.launch({channel: 'msedge', headless: true})
  const origin = server.resolvedUrls.local[0]
  async function snapshot(page, name, width = 1440) {
    await page.setViewportSize({width, height: 1000})
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(200)
    const audit = await page.evaluate(() => {
      const visible = el => {const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'}
      const main = document.querySelector('.page-content') ?? document.querySelector('main')
      const overflows = [...(main?.querySelectorAll('input,select,textarea,h1,h2,h3,h4,.panel,.metric-card,.manual-form,.catalog-pane') ?? [])]
        .filter(visible).filter(el => {const r = el.getBoundingClientRect(); return r.right > innerWidth + 2 || r.left < -2})
        .map(el => ({tag: el.tagName, className: el.className, text: el.textContent?.trim().slice(0, 60)}))
      const clippedTitles = [...(main?.querySelectorAll('h1,h2,h3,h4') ?? [])].filter(visible)
        .filter(el => el.scrollWidth > el.clientWidth + 2 && ['hidden','clip'].includes(getComputedStyle(el).overflowX))
        .map(el => el.textContent?.trim())
      const cards = [...(main?.querySelectorAll('.panel,.metric-card,.manual-form,.catalog-pane,.agent-card,.type-editor') ?? [])].filter(visible)
        .map(el => {const s = getComputedStyle(el); return {className: el.className, radius: s.borderRadius, padding: s.padding, border: s.borderColor}})
      const gutters = [...(main?.querySelectorAll('.dashboard-grid,.metric-grid,.manual-layout,.warehouse-layout,.agent-grid,.monitor-layout') ?? [])].filter(visible)
        .map(el => {const s = getComputedStyle(el); return {className: el.className, rowGap: s.rowGap, columnGap: s.columnGap}})
      return {pageOverflow: document.documentElement.scrollWidth > innerWidth + 2, overflows, clippedTitles, cards, gutters,
        heading: main?.querySelector('h1,h2')?.textContent?.trim() ?? '', titleCount: main?.querySelectorAll('h1').length ?? 0}
    })
    const file = `${name}-${width}.png`
    await page.screenshot({path: join(output, file), fullPage: true, animations: 'disabled'})
    rows.push({name, width, file, ...audit})
  }
  const loginPage = await browser.newPage({viewport: {width: 1440, height: 1000}})
  await loginPage.goto(origin); await snapshot(loginPage, 'login'); await snapshot(loginPage, 'login', 768); await loginPage.close()
  for (const [role, roleName] of [['user','用户'],['ops','运维人员'],['admin','系统管理员']]) {
    if (process.env.UI_REVIEW_ROLE && process.env.UI_REVIEW_ROLE !== role) continue
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}})
    page.on('pageerror', error => errors.push({role, message: error.message}))
    await page.goto(origin)
    await page.getByRole('button', {name: new RegExp('^' + roleName)}).click()
    await page.locator('.sidebar').waitFor()
    const views = await page.locator('.nav-item').evaluateAll(items => items.map(item => item.getAttribute('data-view')))
    for (const view of views) {
      if (process.env.UI_REVIEW_VIEWS && !process.env.UI_REVIEW_VIEWS.split(',').includes(view)) continue
      await page.locator(`.nav-item[data-view="${view}"]`).click()
      await page.waitForTimeout(400)
      await snapshot(page, `${role}-${view}`)
      if (role === 'admin') await snapshot(page, `${role}-${view}`, 1180)
      if (role === 'admin' && ['manual','overview','knowledge','agents','audit','chat'].includes(view)) {
        await snapshot(page, `${role}-${view}`, 1024)
        await snapshot(page, `${role}-${view}`, 768)
      }
    }
    if (role === 'admin' && process.env.UI_REVIEW_SKIP_FORMS !== '1') {
      await page.locator('.nav-item[data-view="manual"]').click()
      const types = await page.locator('[data-ticket-type]').evaluateAll(items => items.map(item => item.getAttribute('data-ticket-type')))
      for (const code of types) {
        await page.locator(`[data-ticket-type="${code}"]`).click()
        await page.waitForTimeout(300)
        await snapshot(page, `form-${code}`)
        await snapshot(page, `form-${code}`, 1180)
      }
      console.log(`Reviewed ${types.length} application forms.`)
    }
    console.log(`Reviewed ${role}: ${views.length} navigation pages.`)
    await page.close()
  }
  const report = {capturedAt: new Date().toISOString(), label, scope: 'isolated UI state; empty/unavailable data, no product mutations',
    total: rows.length, errors, rows, issues: rows.filter(row => row.pageOverflow || row.overflows.length || row.clippedTitles.length)}
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({captures: rows.length, pageErrors: errors.length, pagesWithLayoutIssues: report.issues.length, output}))
  if (process.env.UI_REVIEW_ENFORCE === '1' && (errors.length || report.issues.length)) process.exitCode = 1
} finally {
  await browser?.close(); await server?.close()
  await rm(state, {recursive: true, force: true})
}
