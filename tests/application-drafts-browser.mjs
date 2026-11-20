import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {body,json,listen} from '../runtime/http.mjs'
import {mockExecution} from './support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'drafts-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='draft-browser'
let server,browser,capability
const commands=[],states=new Map()
try {
  capability=await listen(async(req,res,path)=>{
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'ws',name:'本人工作区'}],nextCursor:null})
    if(path.endsWith('/resources'))return json(res,{items:[{resourceId:'app',name:'本人应用',source:'dify',workspaceId:'ws'}],nextCursor:null})
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'key-context',ticketType:'KEY-01',action:'create_key',resourceId:'app',
      fields:{'Dify应用ID':'app','所有者账户名':'chen.yu','Dify API地址':'https://dify.example/v1'},preconditions:[]})
    if(path.endsWith('/executions') && req.method==='POST') {
      const c=await body(req);commands.push(c)
      const state=mockExecution(c,{status:'succeeded',result:{resultId:'key',details:{registrationId:'registration','密钥后四位':'1234'}}})
      states.set(c.executionId,state);return json(res,state)
    }
    const row=states.get(path.split('/').at(-1));return row?json(res,row):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  const base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000);await page.goto(base)
  await page.getByRole('button',{name:/^用户/}).click();await page.locator('.app-shell').waitFor()
  async function open(){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:/KEY-01/}).click()}
  async function selectResource(){
    await page.getByRole('button',{name:'读取可用工作区',exact:true}).click()
    await page.getByRole('option',{name:'本人工作区 · ws',exact:true}).waitFor({state:'attached'})
    await page.getByLabel('工作区 ID',{exact:true}).selectOption('ws')
    await page.getByRole('button',{name:'读取可选资源',exact:true}).click()
    await page.getByRole('option',{name:'本人应用 · app',exact:true}).waitFor({state:'attached'})
    await page.getByLabel('Dify应用 ID',{exact:true}).selectOption('app')
  }
  await open()
  await selectResource()
  await page.getByLabel('调用方名称',{exact:true}).fill('草稿原始名称')
  await page.getByLabel('调用方组织',{exact:true}).fill('业务一部')
  await page.getByLabel('允许来源CIDR（逗号分隔）',{exact:true}).fill('10.0.0.0/8')
  await page.getByLabel('有效期截止时间',{exact:true}).fill('2027-01-01T12:00')
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/drafts') && r.request().method()==='POST')
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click()
  const saveResponse=await saved;assert.equal(saveResponse.status(),200);const draft=await saveResponse.json()
  assert.ok(draft.fields.expiresAt.endsWith('Z'));assert.equal(commands.length,0)
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open()
  let restore=page.waitForResponse(r=>r.url().endsWith('/api/drafts/restore'))
  await page.getByRole('button',{name:/恢复草稿 · app/}).click()
  assert.equal((await restore).status(),200)
  await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('调用方名称',{exact:true}).inputValue(),'草稿原始名称')
  assert.equal(await page.getByLabel('有效期截止时间',{exact:true}).inputValue(),'2027-01-01T12:00')
  const changed=await page.request.post(base+'api/drafts',{data:{draftId:draft.draftId,revision:draft.revision,ticketType:'KEY-01',fields:{...draft.fields,callerName:'另一个窗口的名称'}}})
  assert.equal(changed.status(),200)
  const conflict=page.waitForResponse(r=>r.url().endsWith('/api/drafts') && r.request().method()==='POST')
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();assert.equal((await conflict).status(),409)
  await page.getByText('草稿已更新，请重新读取',{exact:true}).waitFor()
  const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/drafts') && r.request().method()==='GET')
  await page.getByRole('button',{name:'刷新申请草稿',exact:true}).click();await refreshed
  restore=page.waitForResponse(r=>r.url().endsWith('/api/drafts/restore'))
  await page.getByRole('button',{name:/恢复草稿 · app/}).click()
  assert.equal((await restore).status(),200)
  await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('调用方名称',{exact:true}).inputValue(),'另一个窗口的名称')
  assert.equal(await page.getByLabel('Dify应用 ID',{exact:true}).inputValue(),'')
  await selectResource()
  const submission=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST')
  await page.getByRole('button',{name:'提交密钥创建登记',exact:true}).click()
  const accepted=await submission;assert.equal(accepted.status(),201);const row=await accepted.json()
  const items=(await(await page.request.get(base+'api/drafts')).json()).items
  assert.equal(items[0].status,'submitted');assert.equal(items[0].submission.ticketNo,row.ticketNo)
  assert.equal(await page.getByRole('button',{name:/恢复草稿 · app/}).count(),0)
  await page.getByRole('button',{name:'新建申请草稿',exact:true}).click()
  assert.equal(await page.getByLabel('Dify应用 ID',{exact:true}).inputValue(),'')
  console.log('PASS Edge: 跨页面恢复、UTC时间、并发冲突、显式恢复新版及提交归档，不恢复凭证或产品快照')
}finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
