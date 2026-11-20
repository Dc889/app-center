import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'evidence-draft-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='evidence-draft'
const missingId='00000000-0000-4000-8000-000000000001'
let server,browser,capability,writes=0
try {
  capability=await listen((req,res,path)=>{
    if(path.endsWith('/candidates'))return json(res,{items:[{resourceId:'dataset-owned',name:'本人知识库',source:'Dify',sourceScopeId:'ws',sourceResourceId:'source'}],nextCursor:null})
    if(req.method==='POST'){writes++;return json(res,{error:{code:'NO_WRITES_EXPECTED'}},409)}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  const base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000);await page.goto(base)
  await page.getByRole('button',{name:/^用户/}).click();await page.locator('.app-shell').waitFor()
  async function open(){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:/^KB-05\b/}).click()}
  await open()
  await page.getByRole('button',{name:'读取可处置知识库',exact:true}).click();await page.getByRole('option',{name:'本人知识库 · Dify · dataset-owned',exact:true}).waitFor({state:'attached'});await page.getByLabel('目录知识库 ID',{exact:true}).selectOption('dataset-owned')
  await page.getByLabel('事实说明',{exact:true}).fill('本人证据草稿')
  const uploaded=page.waitForResponse(r=>r.url().endsWith('/api/evidence') && r.request().method()==='POST')
  await page.getByLabel('证据附件（每份最多10MB）',{exact:true}).setInputFiles({name:'evidence-note.txt',mimeType:'text/plain',buffer:Buffer.from('evidence bytes')})
  assert.equal((await uploaded).status(),201)
  await page.getByRole('link',{name:'evidence-note.txt',exact:true}).waitFor()
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/drafts') && r.request().method()==='POST')
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click()
  const row=await(await saved).json()
  assert.equal(row.fields.evidenceIds.length,1)
  assert.equal(JSON.stringify(row.fields).includes('evidence bytes'),false)
  for(const forbidden of ['filename','sha256','account','snapshot'])assert.equal(Object.hasOwn(row.fields,forbidden),false)
  const evidenceId=row.fields.evidenceIds[0]
  assert.equal((await page.request.post(base+'api/drafts',{data:{draftId:'missing-evidence',ticketType:'KB-05',revision:0,fields:{
    resourceId:'dataset-missing',facts:'缺失附件',evidenceIds:[missingId]}}})).status(),200)
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open()
  await page.getByRole('button',{name:/恢复草稿 · dataset-missing/}).click()
  await page.getByText('部分附件未通过本人归属核验，请重新读取或移除此引用',{exact:true}).waitFor()
  await expect(page.getByText('待核验附件 · '+missingId,{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'提交知识库处置审批',exact:true})).toBeDisabled()
  const reread=page.waitForResponse(r=>r.url().includes('/api/evidence/'+evidenceId) && r.url().includes('forApplication=1'))
  await page.getByRole('button',{name:/恢复草稿 · dataset-owned/}).click()
  const meta=await(await reread).json()
  assert.equal(meta.evidenceId,evidenceId);assert.equal(meta.filename,'evidence-note.txt')
  await expect(page.getByRole('link',{name:'evidence-note.txt',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'提交知识库处置审批',exact:true})).toBeEnabled()
  assert.equal(await page.getByLabel('证据附件（每份最多10MB）',{exact:true}).inputValue(),'')
  assert.equal(await page.getByText('evidence bytes',{exact:true}).count(),0)
  const ops=await browser.newPage();await ops.goto(base)
  await ops.getByRole('button',{name:/^运维人员/}).click();await ops.locator('.app-shell').waitFor()
  assert.equal((await ops.request.get(base+'api/evidence/'+evidenceId+'?forApplication=1')).status(),404)
  assert.equal((await ops.request.get(base+'api/evidence/'+evidenceId)).status(),404)
  assert.equal(writes,0)
  console.log('PASS Edge: 证据草稿只恢复引用ID并按本人重新读取；缺失引用不能提交，未关联附件对运维不可见，正文不进入草稿')
}finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
