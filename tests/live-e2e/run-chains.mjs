import {ACCOUNTS, LIVE_BASE, attachHealthProbes, createReporter, launchBrowser} from './helpers.mjs'
import {runAllBusinessChains} from './business-chains.mjs'

async function loginCustomSession(browser, account, password, roleLabel) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, acceptDownloads: true})
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const loginRes = await context.request.post(`${LIVE_BASE}/api/auth/login`, {
    data: {account, password},
  })
  if (!loginRes.ok()) {
    throw new Error(`${roleLabel} 登录失败: HTTP ${loginRes.status()} ${await loginRes.text()}`)
  }
  const sessionData = await loginRes.json()
  const probe = attachHealthProbes(page)
  await page.goto(`${LIVE_BASE}/`, {waitUntil: 'domcontentloaded'})
  await page.waitForSelector('.app-shell', {timeout: 15000})
  probe.reset()
  return {roleKey: roleLabel, context, page, request: context.request, probe, sessionData}
}

console.log(`\n=== App Center 7 大真业务闭环全链路自动化诊断（不修改业务代码） ===`)
console.log(`Target: ${LIVE_BASE}\n`)

const browser = await launchBrowser()
const reporter = createReporter()
let sessions = null

try {
  console.log('1) 初始化 4 角色跨部门常驻浏览器会话...')
  const pwd = process.env.E2E_PASSWORD || 'Kpw@2026!'
  const [t1, t2, ops, admin] = await Promise.all([
    loginCustomSession(browser, 'tenant01@kpw.com', pwd, '张伟(刑侦·生产方)'),
    loginCustomSession(browser, 'tenant02@kpw.com', pwd, '王芳(经侦·消费方)'),
    loginCustomSession(browser, ACCOUNTS.ops.account, pwd, '周敏(运营审核)'),
    loginCustomSession(browser, ACCOUNTS.admin.account, pwd, '李强(系统管理员)'),
  ])
  sessions = {t1, t2, ops, admin}
  console.log('   4 角色就绪：张伟(刑侦) / 王芳(经侦) / 周敏(运营) / 李强(管理员)\n')

  console.log('2) 逐条执行 7 大真业务闭环故事链（零内部ID盲盒 + 五维真实验收）...')
  await runAllBusinessChains(sessions, browser, reporter)
} finally {
  if (sessions) {
    await Promise.allSettled([
      sessions.t1.context.close(),
      sessions.t2.context.close(),
      sessions.ops.context.close(),
      sessions.admin.context.close(),
    ])
  }
  await browser.close()
}

const summary = reporter.writeMarkdown()
console.log(`\n=======================================================`)
console.log(`真业务闭环诊断汇总: 通过 ${summary.passed} | 检出缺陷(FAIL) ${summary.failed}`)
console.log(`详细图文报告: ${summary.outPath}`)
console.log(`=======================================================\n`)
process.exit(summary.failed > 0 ? 1 : 0)
