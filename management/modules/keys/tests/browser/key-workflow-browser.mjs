import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen,body} from '../../../../../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'key-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability
let reveals=0
try {
  capability=await listen(async(req,res,path)=>{
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'ws',name:'本人工作区'}],nextCursor:null})
    if(path.endsWith('/resources'))return json(res,{items:[{resourceId:'app',name:'本人应用',source:'dify',workspaceId:'ws'}],nextCursor:null})
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'key-ctx',ticketType:'KEY-01',action:'create_key',resourceId:'app',
      fields:{'Dify应用ID':'app','所有者账户名':'chen.yu','Dify API地址':'https://dify.example/v1'},preconditions:[]})
    if(path.endsWith('/reveal')){reveals++;return json(res,{secret:'BROWSER-TEST-SECRET'})}
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    return json(res,mockExecution(await body(req),{status:'succeeded',result:{resultId:'key',details:{registrationId:'reg-1','密钥后四位':'cret'}}}))
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage()
  await page.goto(server.resolvedUrls.local[0])
  await page.getByRole('button',{name:/^用户/}).click()
  await page.getByRole('button',{name:'手工申请',exact:true}).click()
  await page.getByRole('button',{name:/KEY-01.*Dify API/}).click()
  await page.getByRole('button',{name:'读取可用工作区',exact:true}).click()
  await page.getByRole('option',{name:'本人工作区 · ws',exact:true}).waitFor({state:'attached'})
  await page.getByLabel('工作区 ID',{exact:true}).selectOption('ws')
  await page.getByRole('button',{name:'读取可选资源',exact:true}).click()
  await page.getByRole('option',{name:'本人应用 · app',exact:true}).waitFor({state:'attached'})
  await page.getByLabel('Dify应用 ID',{exact:true}).selectOption('app')
  for(const [label,value] of [['调用方名称','本人调试'],['调用方组织','业务一部'],['允许来源CIDR（逗号分隔）','10.0.0.0/24']])await page.getByLabel(label,{exact:true}).fill(value)
  await page.getByLabel('有效期截止时间',{exact:true}).fill('2030-01-01T12:00')
  const response=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST')
  await page.getByRole('button',{name:'提交密钥创建登记',exact:true}).click()
  const row=await(await response).json()
  await page.getByRole('button',{name:'我的申请',exact:true}).click()
  await page.getByRole('button',{name:'刷新发布申请',exact:true}).click()
  await page.getByRole('button',{name:new RegExp(row.ticketNo+'.*待领取密钥')}).click()
  const revealResponse=page.waitForResponse(r=>r.url().endsWith('/api/applications/reveal'))
  await page.getByRole('button',{name:'一次性领取密钥',exact:true}).click()
  const revealed=await revealResponse
  assert.equal(revealed.status(),200,await revealed.text())
  assert.equal(await page.getByLabel('一次性密钥',{exact:true}).inputValue(),'BROWSER-TEST-SECRET')
  await page.getByRole('button',{name:'关闭密钥展示',exact:true}).click()
  assert.equal(await page.getByLabel('一次性密钥',{exact:true}).count(),0)
  await page.getByRole('button',{name:new RegExp(row.ticketNo+'.*已完成')}).waitFor()
  assert.equal(await page.getByRole('button',{name:'一次性领取密钥',exact:true}).count(),0)
  assert.equal(reveals,1)
  console.log('模拟能力服务的密钥创建与一次性领取通过',row.ticketNo)
}finally{
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
