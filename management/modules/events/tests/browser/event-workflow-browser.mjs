import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'

const dir=await mkdtemp(join(tmpdir(),'event-browser-'))
process.env.APP_DATA_DIR=dir
delete process.env.CAPABILITY_URL
let server,browser
try {
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const base=server.resolvedUrls.local[0]
  async function login(role,account) {
    const page=await browser.newPage()
    await page.goto(base)
    if(account) await page.getByRole('combobox').selectOption(account)
    await page.getByRole('button',{name:new RegExp('^'+role)}).click()
    await page.locator('.app-shell').waitFor()
    return page
  }
  const user=await login('用户')
  await user.getByRole('button',{name:'手工申请',exact:true}).click()
  await user.getByRole('button',{name:/EVT-01.*告警研判/}).click()
  await user.getByRole('textbox',{name:'事件对象标识',exact:true}).fill('browser-event')
  await user.getByRole('button',{name:'检查',exact:true}).click()
  await user.getByText('还不能提交：人工事实说明',{exact:true}).waitFor()
  await user.getByPlaceholder('写一句看到的事实').fill('浏览器报告持续超时')
  await user.getByRole('button',{name:'检查',exact:true}).click()
  await user.getByText('必填项已填写，尚未提交',{exact:true}).waitFor()
  const eventResponse=user.waitForResponse(r=>r.url().endsWith('/api/events') && r.request().method()==='POST')
  await user.getByRole('button',{name:/提交申请/}).click()
  const data=await(await eventResponse).json()
  assert.equal(data.status,'未研判')
  const ops=await login('运维人员','zhou.min')
  await ops.getByRole('button',{name:/^我的待办/}).click()
  await ops.getByRole('button',{name:new RegExp(data.ticketNo)}).click()
  await ops.getByLabel('影响范围').fill('单个插件调用')
  await ops.getByLabel('办理依据').fill('已核对调用日志')
  await ops.getByRole('button',{name:'开始处置',exact:true}).click()
  await ops.getByLabel('处置结果').fill('观察期间调用恢复稳定')
  await ops.getByLabel('办理依据').fill('观察样本已确认')
  await ops.getByRole('button',{name:'提交复核',exact:true}).click()
  await ops.getByText('等待另一名运维人员复核',{exact:true}).waitFor()
  const reviewer=await login('运维人员','wang.ning')
  await reviewer.getByRole('button',{name:/^我的待办/}).click()
  await reviewer.getByRole('button',{name:new RegExp(data.ticketNo)}).click()
  await reviewer.getByLabel('办理依据').fill('独立核验后关闭')
  await reviewer.getByRole('button',{name:'确认关闭',exact:true}).click()
  await reviewer.getByRole('button',{name:new RegExp(data.ticketNo)}).waitFor({state:'detached'})
  await user.getByRole('button',{name:'我的申请',exact:true}).click()
  await user.getByRole('button',{name:new RegExp(data.ticketNo+'.*已关闭')}).waitFor()
  console.log('人工事件报告、研判、处置、双人复核关闭通过',data.ticketNo)
} finally {
  await browser?.close()
  await server?.close()
  await rm(dir,{recursive:true,force:true})
}
