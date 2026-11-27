import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {chromium} from '@playwright/test'

export const LIVE_BASE = (process.env.LIVE_BASE_URL || 'http://192.168.0.7:8088').replace(/\/+$/, '')
export const ACCOUNTS = {
  user: {account: process.env.E2E_USER_ACCOUNT || 'tenant01@kpw.com', password: process.env.E2E_PASSWORD || 'Kpw@2026!', roleLabel: '普通租户(tenant01)'},
  ops: {account: process.env.E2E_OPS_ACCOUNT || 'zhou.min', password: process.env.E2E_PASSWORD || 'Kpw@2026!', roleLabel: '运维人员(zhou.min)'},
  admin: {account: process.env.E2E_ADMIN_ACCOUNT || 'li.qiang', password: process.env.E2E_PASSWORD || 'Kpw@2026!', roleLabel: '系统管理员(li.qiang)'},
}

const ARTIFACT_DIR = join(process.cwd(), 'tests', 'live-e2e', 'artifacts')
mkdirSync(ARTIFACT_DIR, {recursive: true})

export async function launchBrowser() {
  try {
    return await chromium.launch({channel: 'msedge', headless: process.env.E2E_HEADED !== '1'})
  } catch {
    return await chromium.launch({headless: process.env.E2E_HEADED !== '1'})
  }
}

export function attachHealthProbes(page) {
  const probe = {
    pageErrors: [],
    consoleErrors: [],
    httpErrors: [],
    ignoreHttpPredicates: [],
    reset() {
      this.pageErrors = []
      this.consoleErrors = []
      this.httpErrors = []
      this.ignoreHttpPredicates = []
    },
    allowHttp(predicate) {
      this.ignoreHttpPredicates.push(predicate)
    },
    assertClean(label = '') {
      const problems = []
      if (this.pageErrors.length) problems.push(`JS未捕获异常(${this.pageErrors.length}): ${this.pageErrors.slice(0, 3).join(' | ')}`)
      if (this.consoleErrors.length) problems.push(`Console报错(${this.consoleErrors.length}): ${this.consoleErrors.slice(0, 3).join(' | ')}`)
      if (this.httpErrors.length) {
        const list = this.httpErrors.slice(0, 4).map(e => `${e.status} ${e.method} ${e.path}${e.snippet ? ` (${e.snippet})` : ''}`)
        problems.push(`意外HTTP错误(${this.httpErrors.length}): ${list.join(' ; ')}`)
      }
      if (problems.length) {
        throw new Error(`${label ? `[${label}] ` : ''}${problems.join(' || ')}`)
      }
    },
  }

  page.on('pageerror', err => {
    probe.pageErrors.push(err?.message || String(err))
  })
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text()
      if (!txt.includes('Failed to load resource: the server responded with a status of')) {
        probe.consoleErrors.push(txt.slice(0, 200))
      }
    }
  })
  page.on('response', async res => {
    const status = res.status()
    if (status < 400) return
    const url = res.url()
    if (!url.startsWith(LIVE_BASE)) return
    const path = url.slice(LIVE_BASE.length)
    const method = res.request().method()
    if (probe.ignoreHttpPredicates.some(fn => fn({status, path, method}))) return
    let snippet = ''
    try {
      const txt = await res.text()
      snippet = txt.replace(/\s+/g, ' ').slice(0, 140)
    } catch {}
    probe.httpErrors.push({status, method, path, snippet})
  })

  return probe
}

export async function createRoleSession(browser, roleKey) {
  const cred = ACCOUNTS[roleKey]
  const context = await browser.newContext({viewport: {width: 1440, height: 900}})
  const page = await context.newPage()
  page.setDefaultTimeout(15000)

  // Fast hybrid login via real /api/auth/login inside the browser context (sets real HttpOnly cookie!)
  const loginRes = await context.request.post(`${LIVE_BASE}/api/auth/login`, {
    data: {account: cred.account, password: cred.password},
  })
  if (!loginRes.ok()) {
    throw new Error(`角色 ${cred.roleLabel} 登录失败: HTTP ${loginRes.status()} ${await loginRes.text()}`)
  }
  const sessionData = await loginRes.json()
  const probe = attachHealthProbes(page)
  await page.goto(`${LIVE_BASE}/`, {waitUntil: 'domcontentloaded'})
  await page.waitForSelector('.app-shell', {timeout: 15000})
  probe.reset()
  return {roleKey, cred, context, page, request: context.request, probe, sessionData}
}

export function createReporter() {
  const results = []
  return {
    results,
    async run(suite, name, fn, screenshotPage = null) {
      const started = Date.now()
      try {
        const detail = await fn()
        const ms = Date.now() - started
        results.push({suite, name, status: 'PASS', ms, detail: detail || ''})
        console.log(`  \x1b[32mPASS\x1b[0m [${suite}] ${name} (${ms}ms)${detail ? ` — ${detail}` : ''}`)
      } catch (err) {
        const ms = Date.now() - started
        const message = err instanceof Error ? err.message : String(err)
        let screenshotPath = ''
        if (screenshotPage) {
          const safeName = `${suite}-${name}`.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 80)
          screenshotPath = join(ARTIFACT_DIR, `FAIL_${safeName}.png`)
          try { await screenshotPage.screenshot({path: screenshotPath, fullPage: false}) } catch { screenshotPath = '' }
        }
        results.push({suite, name, status: 'FAIL', ms, error: message, screenshotPath})
        console.log(`  \x1b[31mFAIL\x1b[0m [${suite}] ${name} (${ms}ms)\n       ${message}${screenshotPath ? `\n       Screenshot: ${screenshotPath}` : ''}`)
      }
    },
    writeMarkdown() {
      const passed = results.filter(r => r.status === 'PASS').length
      const failed = results.filter(r => r.status === 'FAIL').length
      const lines = [
        `# Live Hybrid E2E & 状态矩阵回归报告`,
        ``,
        `- **目标环境**：${LIVE_BASE}`,
        `- **执行时间**：${new Date().toLocaleString('zh-CN', {hour12: false})}`,
        `- **总计**：${results.length} 项 | **通过**：${passed} | **失败**：${failed}`,
        ``,
        `| 套件 | 用例名称 | 状态 | 耗时 | 详情 / 失败原因 |`,
        `| :--- | :--- | :---: | :---: | :--- |`,
        ...results.map(r => {
          const info = r.status === 'PASS'
            ? (r.detail || '—')
            : `${r.error}${r.screenshotPath ? `（截图：${r.screenshotPath}）` : ''}`
          return `| ${r.suite} | ${r.name} | ${r.status === 'PASS' ? '✅ PASS' : '❌ FAIL'} | ${r.ms}ms | ${String(info).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')} |`
        }),
      ]
      const outPath = join(ARTIFACT_DIR, 'latest-report.md')
      writeFileSync(outPath, lines.join('\n'), 'utf8')
      return {passed, failed, outPath}
    },
  }
}
