import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'dialogue-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='dialogue-browser'
let server,browser,capability,writes=0
try {
  capability=await listen((req,res)=>{
    if(req.method==='POST'){writes++;return json(res,{error:{code:'NO_WRITES_EXPECTED'}},409)}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  const base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000);await page.goto(base)
  await page.getByRole('button',{name:/^用户/}).click();await page.locator('.app-shell').waitFor()
  await page.getByRole('button',{name:'对话申请',exact:true}).click()
  await page.getByLabel('申请描述',{exact:true}).fill('帮我处理一下')
  await page.getByRole('button',{name:'发送申请描述',exact:true}).click()
  await page.getByText('没有匹配到当前目录中的工单类型',{exact:false}).waitFor()
  await page.getByLabel('申请描述',{exact:true}).fill('账号开通')
  await page.getByRole('button',{name:'发送申请描述',exact:true}).click()
  await expect(page.getByRole('button',{name:/^候选 · ACC/})).toHaveCount(0)
  await page.getByLabel('申请描述',{exact:true}).fill('我想报告一个插件安全事件，对象是 plugin-daemon')
  await page.getByRole('button',{name:'发送申请描述',exact:true}).click()
  await expect(page.getByText('EVT-01 告警研判与处置',{exact:true})).toBeVisible()
  await expect(page.getByLabel('资源 ID',{exact:true})).toHaveValue('plugin-daemon')
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/drafts') && r.request().method()==='POST')
  await page.getByRole('button',{name:'保存草稿',exact:true}).click()
  const row=await(await saved).json()
  assert.equal(row.ticketType,'EVT-01')
  assert.equal(row.fields.resourceId,'plugin-daemon')
  assert.equal(row.fields.objectType,'插件')
  for(const forbidden of ['snapshot','context','scan','secret','反诈话术资料库'])assert.equal(JSON.stringify(row.fields).includes(forbidden),false,forbidden)
  const submitted=page.waitForResponse(r=>r.url().endsWith('/api/events') && r.request().method()==='POST')
  await page.getByRole('button',{name:/提交申请/}).click()
  const response=await submitted
  assert.equal(response.status(),201)
  const event=await response.json()
  assert.equal(event.status,'未研判')
  assert.equal(event.creationMode,'人工报告')
  assert.equal(writes,0)
  const archived=(await(await page.request.get(base+'api/drafts')).json()).items.find(item=>item.draftId===row.draftId)
  assert.equal(archived.status,'submitted')
  assert.equal(archived.submission.ticketNo,event.ticketNo)
  console.log('PASS Edge: 对话只匹配当前目录，草稿不含产品快照，事件提交走原接口且零执行下发',event.ticketNo)
}finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
