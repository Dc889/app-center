import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'form-check-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='form-check'
let server,browser,capability,writes=0
try {
  capability=await listen((req,res,path)=>{if(req.method==='POST')writes++;if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'ws-keep',name:'保留的工作区'}],nextCursor:null});return json(res,{error:{code:'NOT_FOUND'}},404)})
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  const base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000)
  let posts=0
  page.on('request',request=>{if(request.method()==='POST' && /\/api\/(applications|tickets|account-applications|events)$/.test(request.url()))posts++})
  await page.goto(base)
  await page.getByRole('button',{name:/^用户/}).click();await page.locator('.app-shell').waitFor()
  async function open(type){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click()}
  await open('KB-01')
  await page.getByRole('button',{name:'检查',exact:true}).click()
  await expect(page.getByText('还不能提交：workspace ID、知识库',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'读取可用工作区',exact:true}).click()
  await page.getByRole('option',{name:'保留的工作区 · ws-keep',exact:true}).waitFor({state:'attached'})
  await page.getByLabel('workspace ID',{exact:true}).selectOption('ws-keep')
  await page.getByRole('button',{name:'检查',exact:true}).click()
  await expect(page.getByLabel('workspace ID',{exact:true})).toHaveValue('ws-keep')
  await expect(page.getByText('还不能提交：知识库',{exact:true})).toBeVisible()
  await open('KEY-01')
  await page.getByLabel('调用方名称',{exact:true}).fill('保留的名称')
  await page.getByRole('button',{name:'检查',exact:true}).click()
  await expect(page.getByLabel('调用方名称',{exact:true})).toHaveValue('保留的名称')
  await expect(page.getByText(/还不能提交：Dify应用 ID/)).toBeVisible()
  await open('SKL-01')
  await page.getByLabel('Skill名称',{exact:true}).fill('保留的Skill')
  await page.getByRole('button',{name:'检查',exact:true}).click()
  await expect(page.getByLabel('Skill名称',{exact:true})).toHaveValue('保留的Skill')
  await expect(page.getByText(/还不能提交：待审文件/)).toBeVisible()
  const admin=await browser.newPage();await admin.goto(base)
  await admin.getByRole('button',{name:/^系统管理员/}).click();await admin.locator('.app-shell').waitFor()
  await admin.getByRole('button',{name:'手工申请',exact:true}).click()
  await admin.getByRole('button',{name:/^ACC-01\b/}).click()
  await admin.getByRole('button',{name:'检查',exact:true}).click()
  await expect(admin.getByText('还不能提交：目标人员、账号生效时间、账号申请依据',{exact:true})).toBeVisible()
  assert.equal(posts,0);assert.equal(writes,0)
  console.log('PASS Edge: 专用表单检查只指出缺项，不调用原申请接口，已填内容保留')
}finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
