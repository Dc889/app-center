import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const dir = await mkdtemp(join(tmpdir(), 'skill-browser-'))
process.env.APP_DATA_DIR = dir
delete process.env.CAPABILITY_URL
let server, browser
try {
  server = await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0, host:'127.0.0.1'}})
  await server.listen()
  browser = await chromium.launch({channel:'msedge',headless:true})
  const page = await browser.newPage()
  await page.goto(server.resolvedUrls.local[0])
  await page.getByRole('button',{name:/^用户/}).click()
  const directory=page.waitForResponse(r=>r.url().includes('/api/catalog?kind=skill'))
  await page.getByRole('button',{name:'Skill仓库',exact:true}).click()
  const visible=(await(await directory).json()).items
  await page.locator('[data-testid="catalog-warehouse"] .agent-card').first().waitFor()
  assert.equal(await page.locator('[data-testid="catalog-warehouse"] .agent-card').count(),visible.length)
  for(const item of visible)assert.ok(await page.locator('[data-testid="catalog-warehouse"] .agent-card').filter({hasText:item.name}).count()>0)
  await page.getByRole('button',{name:'手工申请',exact:true}).click()
  await page.getByRole('button',{name:/SKL-03.*Skill 下载/}).click()
  await page.getByLabel('Skill目录',{exact:true}).selectOption({label:'公文摘要 Skill · skl_doc'})
  await page.getByRole('button',{name:/提交申请/}).click()
  await page.getByText('等待领取文件',{exact:true}).waitFor()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button',{name:'领取文件'}).click()
  const file = await downloadEvent
  assert.equal(await file.failure(),null)
  const bytes = await readFile(await file.path())
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'656085df494bea2c4bec3c08e164ff66927cd3373abbc3b6e1e5451ffcf0a1e1')
  const result = page.locator('.read-source').filter({hasText:'执行完成'})
  await result.waitFor()
  const ticketNo = (await result.innerText()).match(/SKL-03-[A-Za-z0-9-]+/)?.[0]
  assert.ok(ticketNo)
  await page.getByRole('button',{name:'我的申请',exact:true}).click()
  const row = page.getByRole('row').filter({hasText:ticketNo})
  await row.waitFor()
  assert.match(await row.innerText(),/已完成/)
  await row.getByRole('button',{name:'打开工单'}).click()
  await page.getByRole('heading',{name:'执行工单详情'}).waitFor()
  await page.getByRole('textbox',{name:'搜索执行工单'}).fill('no-such-ticket')
  assert.equal(await row.count(),0)
  const adminPage = await browser.newPage()
  await adminPage.goto(server.resolvedUrls.local[0])
  await adminPage.getByRole('button',{name:/^系统管理员/}).click()
  await adminPage.getByRole('button',{name:'工单查询',exact:true}).click()
  const adminRow=adminPage.getByRole('row').filter({hasText:ticketNo})
  await adminRow.getByRole('button',{name:'打开工单'}).click()
  await adminPage.getByRole('heading',{name:'执行工单详情'}).waitFor()
  assert.equal((await adminPage.request.get(server.resolvedUrls.local[0]+'api/tickets/'+ticketNo+'/file')).status(),404)
  assert.equal((await page.request.get(server.resolvedUrls.local[0]+'api/tickets?view=query')).status(),403)
  await adminPage.getByRole('button',{name:'审计追踪',exact:true}).click()
  await adminPage.getByRole('heading',{name:'管理端审计记录'}).waitFor()
  await adminPage.getByRole('textbox',{name:'搜索审计记录'}).fill(ticketNo)
  await adminPage.getByRole('cell',{name:'确认文件回执',exact:true}).waitFor()
  const exportEvent=adminPage.waitForEvent('download')
  await adminPage.getByRole('button',{name:'导出当前筛选',exact:true}).click()
  const auditFile=await exportEvent
  const exported=JSON.parse(await readFile(await auditFile.path(),'utf8'))
  assert.ok(exported.length>0)
  assert.ok(exported.every(entry=>entry.reference===ticketNo))
  assert.ok(exported.some(entry=>entry.action==='确认文件回执'))
  await adminPage.getByRole('button',{name:'工单类型',exact:true}).click()
  await adminPage.getByLabel('类型编码',{exact:true}).fill('EVT-01')
  await adminPage.getByLabel('类型名称',{exact:true}).fill('事件办理')
  await adminPage.getByRole('button',{name:'保存草稿',exact:true}).click()
  await adminPage.getByText('草稿已保存',{exact:true}).waitFor()
  await adminPage.getByRole('button',{name:'发布版本',exact:true}).click()
  await adminPage.getByText('版本已发布',{exact:true}).waitFor()
  await adminPage.getByRole('button',{name:'停用版本',exact:true}).click()
  await adminPage.getByText('版本已停用',{exact:true}).waitFor()
  const blocked=await page.request.post(server.resolvedUrls.local[0]+'api/events',{data:{ticketNo:'EVT-01-disabled',resourceId:'sample',objectType:'插件',facts:'test'}})
  assert.equal(blocked.status(),409)
  console.log('Skill 交付与我的申请状态通过浏览器验收',ticketNo)
} finally {
  await browser?.close()
  await server?.close()
  await rm(dir,{recursive:true,force:true})
}
