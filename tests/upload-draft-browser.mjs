import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'upload-draft-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='upload-draft'
let server,browser,capability,scan='ready',uploads=0,reads=0
try {
  capability=await listen(async(req,res,path)=>{
    const uploaded=/^\/internal\/v1\/intake\/(skill|plugin)$/.exec(path)
    if(uploaded && req.method==='POST') {
      for await(const _chunk of req){};uploads++
      return json(res,{intakeId:'owned-'+uploaded[1],status:'received'},202)
    }
    const read=/^\/internal\/v1\/intake\/(skill|plugin)\/owned-\1$/.exec(path)
    if(read) {
      reads++
      const metadata=read[1]==='plugin'?{packageMetadata:{uniqueIdentifier:'owned.plugin',name:'Owned Plugin',version:'1.0.0',dependencies:[]}}:{}
      return json(res,{intakeId:'owned-'+read[1],status:scan,sha256:'a'.repeat(64),sizeBytes:8,scan:{verdict:scan==='ready'?'pass':'reject'},...metadata})
    }
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  const base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000);await page.goto(base)
  await page.getByRole('button',{name:/^用户/}).click();await page.locator('.app-shell').waitFor()
  async function open(type){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click()}
  for(const [type,submitName] of [['SKL-01','提交Skill上架审批'],['PLG-01','提交插件上架审批']]) {
    const beforeUploads=uploads,beforeReads=reads
    await open(type)
    await page.getByLabel('待审文件',{exact:true}).setInputFiles({name:'sample.zip',mimeType:'application/zip',buffer:Buffer.from('test package')})
    await page.getByRole('button',{name:'上传待审文件',exact:true}).click()
    await page.getByLabel('待审引用',{exact:true}).waitFor()
    await page.getByRole('button',{name:'刷新扫描结果',exact:true}).click()
    await expect(page.getByRole('button',{name:submitName,exact:true})).toBeEnabled()
    const saved=page.waitForResponse(r=>r.url().endsWith('/api/drafts') && r.request().method()==='POST')
    await page.getByRole('button',{name:'保存申请草稿',exact:true}).click()
    const row=await(await saved).json();assert.equal(row.fields.intakeId,'owned-'+(type==='SKL-01'?'skill':'plugin'),type)
    for(const forbidden of ['scan','sha256','packageMetadata','upload'])assert.equal(Object.hasOwn(row.fields,forbidden),false,type+' '+forbidden)
    scan='rejected'
    await page.getByRole('button',{name:'我的申请',exact:true}).click();await open(type)
    await page.getByRole('button',{name:/^恢复草稿 ·/}).click()
    await page.getByText('状态 · rejected',{exact:true}).waitFor()
    await expect(page.getByRole('button',{name:submitName,exact:true})).toBeDisabled()
    assert.equal(await page.getByLabel('待审文件',{exact:true}).inputValue(),'')
    assert.equal(uploads,beforeUploads+1,type);assert.ok(reads>=beforeReads+2,type)
    scan='ready'
    await page.getByRole('button',{name:'刷新扫描结果',exact:true}).click()
    await expect(page.getByRole('button',{name:submitName,exact:true})).toBeEnabled()
    assert.equal(uploads,beforeUploads+1,type)
    console.log('PASS draft upload',type)
  }
  console.log('PASS Edge: Skill与插件只恢复待审ID，不重传文件；扫描变更为拒绝时阻止提交，重新通过后才放行')
}finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
