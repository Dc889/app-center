import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'draft-forms-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='draft-forms'
let server,browser,capability,writes=0
// Explicit user-visible fields exercise each manual form, including conditional variants.
const cases=[
  ['AG-01',{resourceId:'app-draft',workspaceId:'ws-ag01'},'工作区 ID','ws-ag01'],
  ['AG-02',{resourceId:'app-draft',workspaceId:'ws-ag02',scenario:'发布场景草稿'},'工作区 ID','ws-ag02'],
  ['AG-03',{resourceId:'agent',purpose:'授权使用草稿'},'使用目的','授权使用草稿'],
  ['AG-04',{resourceId:'agent',explanation:'再发布草稿'},'原因说明','再发布草稿'],
  ['AG-05',{resourceId:'agent',explanation:'下架草稿'},'原因说明','下架草稿'],
  ['KB-01',{resourceId:'dataset',sourceSystem:'Dify',workspaceId:'ws-kb'},'workspace ID','ws-kb'],
  ['KB-02',{resourceId:'dataset-review',workspaceId:'ws',purpose:'分享草稿'},'workspace ID（Dify 来源填写）','ws'],
  ['KB-03',{resourceId:'dataset',purpose:'知识库绑定草稿'},'使用目的','知识库绑定草稿'],
  ['KB-05',{resourceId:'dataset',facts:'处置说明草稿'},'事实说明','处置说明草稿'],
  ['MCP-01',{resourceId:'registration',name:'MCP登记草稿'},'MCP名称','MCP登记草稿'],
  ['MCP-02',{resourceId:'mcp',purpose:'MCP绑定草稿'},'使用目的','MCP绑定草稿'],
  ['MCP-03',{resourceId:'mcp',facts:'解绑说明草稿'},'事实说明','解绑说明草稿'],
  ['SKL-01',{resourceId:'skill',name:'Skill上架草稿'},'Skill名称','Skill上架草稿'],
  ['SKL-02',{resourceId:'skill',changeDescription:'Skill变更草稿'},'变更说明','Skill变更草稿'],
  ['SKL-03',{resourceId:'skill-download',version:'v1'},'下载版本（留空使用最新）','v1'],
  ['SKL-04',{resourceId:'skill',explanation:'Skill下架草稿'},'原因说明','Skill下架草稿'],
  ['PLG-01',{description:'插件上架草稿'},'功能说明','插件上架草稿'],
  ['PLG-02',{resourceId:'plugin',changeDescription:'插件变更草稿'},'变更说明','插件变更草稿'],
  ['PLG-03',{resourceId:'plugin',purpose:'插件安装草稿'},'使用目的','插件安装草稿'],
  ['KEY-01',{resourceId:'app',callerName:'密钥创建草稿'},'调用方名称','密钥创建草稿'],
  ['KEY-02',{resourceId:'key',reason:'密钥撤销草稿'},'操作原因','密钥撤销草稿'],
  ['TOL-01',{resourceId:'tool',description:'工具批准草稿'},'功能说明','工具批准草稿'],
  ['ACC-01',{subjectId:'person-chen-yu',reason:'账号变更草稿'},'账号申请依据','账号变更草稿'],
  ['ACC-02',{subjectId:'person-chen-yu',newAccount:'chen.draft'},'新账户名','chen.draft'],
  ['EVT-01',{resourceId:'event-object',objectType:'插件',facts:'人工事件草稿'},null,'人工事件草稿'],
]
try {
  capability=await listen((req,res,path)=>{
    if(req.method==='POST'){writes++;return json(res,{error:{code:'NO_WRITES_EXPECTED'}},409)}
    if(path.endsWith('/catalog'))return json(res,{items:[{resourceId:'skill-download',name:'测试Skill',status:'available',actions:['download'],data:{version:'v1',sha256:'a'.repeat(64)}}],nextCursor:null})
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  const base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000);await page.goto(base)
  await page.getByRole('button',{name:/^系统管理员/}).click();await page.locator('.app-shell').waitFor()
  for(const [type,fields] of cases)assert.equal((await page.request.post(base+'api/drafts',{data:{draftId:'coverage-'+type,ticketType:type,revision:0,fields}})).status(),200,type)
  for(const [type,fields,label,expected] of cases) {
    await page.getByRole('button',{name:'我的申请',exact:true}).click()
    await page.getByRole('button',{name:'手工申请',exact:true}).click()
    await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click()
    const restored=page.waitForResponse(r=>r.url().endsWith('/api/drafts/restore'))
    await page.getByRole('button',{name:/^恢复草稿 ·/}).click()
    assert.equal((await restored).status(),200,type)
    const input=label?page.getByRole(['AG-01','AG-02','KB-01','KB-02'].includes(type)?'combobox':'textbox',{name:label,exact:true}):page.getByPlaceholder('写一句看到的事实')
    await expect(input).toHaveValue(expected)
    const saved=page.waitForResponse(r=>r.url().endsWith('/api/drafts') && r.request().method()==='POST')
    await page.getByRole('button',{name:'保存申请草稿',exact:true}).click()
    const response=await saved;assert.equal(response.status(),200,type)
    const row=await response.json()
    assert.equal(row.ticketType,type);assert.equal(row.status,'draft')
    for(const [key,value] of Object.entries(fields))assert.deepEqual(row.fields[key],value,type+' '+key)
    for(const forbidden of ['snapshot','context','upload','scan','packageMetadata','secret','token'])assert.equal(Object.hasOwn(row.fields,forbidden),false,type)
    console.log('PASS draft form',type)
  }
  assert.equal(writes,0)
  console.log('PASS Edge: 全部25种人工类型恢复并保存，零执行下发；产品快照不进入草稿')
}finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
