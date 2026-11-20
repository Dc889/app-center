import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../../../../../runtime/http.mjs'

const dir=await mkdtemp(join(tmpdir(),'plugin-publication-'))
process.env.APP_DATA_DIR=dir
const hash='b'.repeat(64),checkedAt=new Date().toISOString()
const packageMetadata={uniqueIdentifier:'local.plugin',name:'本地插件',version:'2.0.0',dependencies:[]}
let server,browser,capability
try {
  capability=await listen(async(req,res,path)=>{
    if(path.startsWith('/internal/v1/intake/plugin'))return json(res,{intakeId:'plugin-file',status:'ready',sha256:hash,sizeBytes:4,filename:'plugin.zip',packageMetadata,scan:{verdict:'passed',checkedAt}},path.endsWith('/plugin')?202:200)
    if(path.startsWith('/internal/v1/execution-contexts/PLG-02'))return json(res,{snapshotId:'plugin-rev',ticketType:'PLG-02',action:'revise_package',resourceId:'local.plugin',capturedAt:checkedAt,fields:{'原版本号':'1.0.0','原版本指纹':hash,'插件唯一标识':'local.plugin'},preconditions:[{kind:'plugin',id:'local.plugin',revision:1}]})
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0])
  await page.getByRole('button',{name:/^用户/}).click();await page.locator('.app-shell').waitFor()
  async function upload(type){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click();await page.getByLabel('待审文件',{exact:true}).setInputFiles({name:'plugin.zip',mimeType:'application/zip',buffer:Buffer.from('test')});await page.getByRole('button',{name:'上传待审文件',exact:true}).click();await page.getByLabel('待审引用',{exact:true}).waitFor()}
  await upload('PLG-01')
  await page.getByLabel('功能说明',{exact:true}).fill('解析文档')
  await page.getByLabel('使用说明',{exact:true}).fill('安装后调用')
  await page.getByLabel('权限声明（逗号分隔）',{exact:true}).fill('读取')
  const first=page.waitForResponse(response=>response.url().endsWith('/api/applications') && response.request().method()==='POST')
  await page.getByRole('button',{name:'提交插件上架审批',exact:true}).click()
  const created=await(await first).json();assert.equal(created.status,'待受理');assert.equal(created.ticketType,'PLG-01')
  await upload('PLG-02')
  await page.getByLabel('目录 ID',{exact:true}).fill('local.plugin')
  await page.getByLabel('变更说明',{exact:true}).fill('升级包')
  const second=page.waitForResponse(response=>response.url().endsWith('/api/applications') && response.request().method()==='POST')
  await page.getByRole('button',{name:'提交版本变更再审',exact:true}).click()
  const revised=await(await second).json();assert.equal(revised.status,'待受理');assert.equal(revised.ticketType,'PLG-02')
  console.log('PASS PLG-01/PLG-02 模拟对端页面提交',created.ticketNo,revised.ticketNo)
} finally {await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
