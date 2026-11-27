import {createReporter, createRoleSession, launchBrowser, LIVE_BASE} from './helpers.mjs'
import {runStateMatrix} from './state-matrix.mjs'
import {runBrowserHybrid} from './browser-hybrid.mjs'

console.log(`\n=== App Center Live Hybrid E2E & 状态矩阵回归 ===`)
console.log(`Target: ${LIVE_BASE}\n`)

const browser = await launchBrowser()
const reporter = createReporter()
let sessions = null

try {
  console.log('1) 并行初始化 3 角色浏览器会话（免切换登录）...')
  const [user, ops, admin] = await Promise.all([
    createRoleSession(browser, 'user'),
    createRoleSession(browser, 'ops'),
    createRoleSession(browser, 'admin'),
  ])
  sessions = {user, ops, admin}
  console.log('   已就绪: tenant01 (user) / zhou.min (ops) / li.qiang (admin)\n')

  console.log('2) 运行状态矩阵与越权接口校验...')
  await runStateMatrix(sessions, reporter)

  console.log('\n3) 运行多角色真实浏览器混合 E2E 体检...')
  await runBrowserHybrid(sessions, reporter)
} finally {
  if (sessions) {
    await Promise.allSettled([
      sessions.user.context.close(),
      sessions.ops.context.close(),
      sessions.admin.context.close(),
    ])
  }
  await browser.close()
}

const summary = reporter.writeMarkdown()
console.log(`\n========================================`)
console.log(`汇总: 通过 ${summary.passed} | 失败 ${summary.failed}`)
console.log(`详细报告: ${summary.outPath}`)
console.log(`========================================\n`)
process.exit(summary.failed > 0 ? 1 : 0)
