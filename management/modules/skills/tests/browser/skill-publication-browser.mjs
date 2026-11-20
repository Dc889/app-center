import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../../../../../runtime/http.mjs'

const dir=await mkdtemp(join(tmpdir(),'skill-publication-'))
process.env.APP_DATA_DIR=dir
const hash='a'.repeat(64),checkedAt=new Date().toISOString()
let server,browser,capability
try {
  capability=await listen(async(req,res,path)=>{
    if(path.startsWith('/internal/v1/intake/skill'))return json(res,{intakeId:'skill-file',status:'ready',sha256:hash,sizeBytes:4,filename:'skill.zip',scan:{verdict:'passed',checkedAt}},path.endsWith('/skill')?202:200)
    if(path.startsWith('/internal/v1/execution-contexts/SKL-02'))return json(res,{snapshotId:'skill-rev',ticketType:'SKL-02',action:'revise_skill',resourceId:'skl-doc',capturedAt:checkedAt,fields:{'原版本号':'1.0.0','原文件SHA-256':hash},preconditions:[{kind:'skill',id:'skl-doc',revision:1}]})
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0])
  await page.getByRole('button',{name:/^用户/}).click();await page.locator('.app-shell').waitFor()
  async function upload(type){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click();await page.getByLabel('待审文件',{exact:true}).setInputFiles({name:'sample.zip',mimeType:'application/zip',buffer:Buffer.from('test')});await page.getByRole('button',{name:'上传待审文件',exact:true}).click();await page.getByLabel('待审引用',{exact:true}).waitFor()}
  await upload('SKL-01')
  for(const [label,value] of [['Skill唯一标识','skl-doc'],['Skill名称','公文摘要'],['版本号','1.0.0'],['功能说明','摘要'],['使用说明','阅读'],['许可证','内部'],['目录标签（逗号分隔）','公文']])await page.getByLabel(label,{exact:true}).fill(value)
  const first=page.waitForResponse(response=>response.url().endsWith('/api/applications') && response.request().method()==='POST')
  await page.getByRole('button',{name:'提交Skill上架审批',exact:true}).click()
  const created=await(await first).json();assert.equal(created.status,'待受理');assert.equal(created.ticketType,'SKL-01')
  await upload('SKL-02')
  await page.getByLabel('目录 ID',{exact:true}).fill('skl-doc')
  await page.getByLabel('新版本号',{exact:true}).fill('2.0.0')
  await page.getByLabel('兼容性说明',{exact:true}).fill('兼容')
  await page.getByLabel('变更说明',{exact:true}).fill('修订说明')
  const second=page.waitForResponse(response=>response.url().endsWith('/api/applications') && response.request().method()==='POST')
  await page.getByRole('button',{name:'提交版本变更再审',exact:true}).click()
  const revised=await(await second).json();assert.equal(revised.status,'待受理');assert.equal(revised.ticketType,'SKL-02')
  console.log('PASS SKL-01/SKL-02 模拟对端页面提交',created.ticketNo,revised.ticketNo)
} finally {await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
