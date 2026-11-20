import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'

const dir=await mkdtemp(join(tmpdir(),'event-attachment-'))
process.env.APP_DATA_DIR=dir
delete process.env.CAPABILITY_URL
let server,browser
try {
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const base=server.resolvedUrls.local[0]
  async function login(role,account){const page=await browser.newPage();await page.goto(base);if(account)await page.getByRole('combobox').selectOption(account);await page.getByRole('button',{name:new RegExp('^'+role)}).click();await page.locator('.app-shell').waitFor();return page}
  const user=await login('用户')
  await user.getByRole('button',{name:'手工申请',exact:true}).click()
  await user.getByRole('button',{name:/EVT-01.*告警研判/}).click()
  await user.getByRole('textbox',{name:'事件对象标识',exact:true}).fill('plugin-object')
  await user.getByPlaceholder('写一句看到的事实').fill('附件与对象名称验收')
  const created=user.waitForResponse(response=>response.url().endsWith('/api/events') && response.request().method()==='POST')
  await user.getByRole('button',{name:/提交申请/}).click()
  const event=await(await created).json()
  const ops=await login('运维人员','zhou.min')
  await ops.getByRole('button',{name:/^我的待办/}).click()
  await ops.getByRole('button',{name:new RegExp(event.ticketNo)}).click()
  await expect(ops.getByText('目录对象名称 · 未采集',{exact:true})).toBeVisible()
  await ops.getByLabel('事件附件',{exact:true}).setInputFiles({name:'evidence.txt',mimeType:'text/plain',buffer:Buffer.from('evidence')})
  await expect(ops.getByRole('link',{name:'evidence.txt',exact:true})).toBeVisible()
  await ops.getByLabel('影响范围').fill('单个对象')
  await ops.getByLabel('办理依据').fill('开始处置以便创建关联草稿')
  const transitioned=ops.waitForResponse(response=>response.url().endsWith('/api/events/transition'))
  await ops.getByRole('button',{name:'开始处置',exact:true}).click()
  const transition=await transitioned
  assert.equal(transition.status(),200,await transition.text())
  await expect(ops.getByRole('button',{name:new RegExp(event.ticketNo+'.*处理中')})).toBeVisible()
  await ops.getByRole('listbox',{name:'处置动作',exact:true}).selectOption(['停用文档'])
  await ops.getByRole('button',{name:'创建关联处置草稿',exact:true}).click()
  await expect(ops.getByText(/已创建 KB-05 草稿/)).toBeVisible()
  console.log('PASS event desk: 对象名称、附件登记、关联处置草稿',event.ticketNo)
} finally {
  await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})
}
