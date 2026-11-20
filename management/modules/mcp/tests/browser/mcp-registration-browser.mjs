import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../../../../../runtime/http.mjs'

const dir=await mkdtemp(join(tmpdir(),'mcp-registration-'))
process.env.APP_DATA_DIR=dir
const now=new Date().toISOString()
let server,browser,capability
try {
  capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/resources' && new URL(req.url,'http://localhost').searchParams.get('kind')==='mcp_registration')return json(res,{items:[{resourceId:'reg-1',name:'档案注册',source:'model',workspaceId:null}],nextCursor:null})
    if(path==='/internal/v1/resources/mcp_registration/reg-1')return json(res,{snapshotId:'mcp-snap',resourceId:'reg-1',capturedAt:now,data:{registrationId:'reg-1',name:'档案注册',status:'active',transport:'http',urlFingerprint:'c'.repeat(64),authType:'none',tools:[{name:'search',description:'检索',inputSchema:{type:'object'}}],syncedAt:now}})
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0])
  await page.getByRole('button',{name:/^用户/}).click();await page.locator('.app-shell').waitFor()
  await page.getByRole('button',{name:'手工申请',exact:true}).click()
  await page.getByRole('button',{name:/^MCP-01\b/}).click()
  await page.getByRole('button',{name:'读取可选资源',exact:true}).click()
  await page.getByRole('option',{name:'档案注册 · reg-1',exact:true}).waitFor({state:'attached'})
  await page.getByLabel('技术注册 ID',{exact:true}).selectOption('reg-1')
  await page.getByLabel('MCP名称',{exact:true}).fill('档案检索')
  await page.getByLabel('MCP用途',{exact:true}).fill('查询档案')
  await page.getByLabel('组织边界（逗号分隔）',{exact:true}).fill('业务一部')
  await page.getByLabel('业务线',{exact:true}).fill('刑侦')
  const submitted=page.waitForResponse(response=>response.url().endsWith('/api/applications') && response.request().method()==='POST')
  await page.getByRole('button',{name:'提交MCP登记审批',exact:true}).click()
  const created=await(await submitted).json();assert.equal(created.status,'待受理');assert.equal(created.ticketType,'MCP-01')
  console.log('PASS MCP-01 模拟对端页面提交',created.ticketNo)
} finally {await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
