import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json} from '../../../../../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'dataset-selection-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability,mode='',commands=0,posts=0
const reads=[]
try {
  capability=await listen((req,res,path)=>{
    const query=new URL(req.url,'http://localhost').searchParams
    reads.push(req.url)
    if(req.method==='POST'){commands++;return json(res,{error:{code:'UNEXPECTED_EXECUTION'}},409)}
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'ws',name:'一区'},{workspaceId:'ws2',name:'二区'}],nextCursor:null})
    if(path==='/internal/v1/resources')return json(res,{items:[{resourceId:query.has('cursor')?'dataset':'first',name:query.has('cursor')?'分享源库':'首页资源',source:query.get('kind'),workspaceId:query.get('kind')==='ragflow_dataset'?null:query.get('workspaceId')}],nextCursor:query.has('cursor')?null:'page2'})
    if(path.startsWith('/internal/v1/resources/'))return json(res,{snapshotId:'resource',resourceId:'dataset',workspaceId:path.includes('ragflow_dataset')?null:query.get('workspaceId'),capturedAt:new Date().toISOString(),data:{tenantId:'tenant-rag',ownerAccount:'chen.yu'}})
    if(path.includes('/execution-contexts/')) {
      const scope=query.get('workspaceId'),rag=scope==='tenant-rag'
      return json(res,{ticketType:'KB-02',action:'publish_dataset',resourceId:'dataset',snapshotId:'review',capturedAt:new Date().toISOString(),
        fields:{'来源系统':mode==='source'?'Other':rag?'RAGFlow':'Dify','workspace/tenant ID':mode==='scope'?'other':scope,'所有者账户名':'chen.yu',
          '文档清单快照ID':'manifest','文档数':mode==='count'?2:1,'模型目录核对结果':'一致',
          '文档审查明细':[{documentId:'doc',sha256:'a'.repeat(64),autoVerdict:'通过'}]},
        preconditions:[{kind:'dataset_manifest',id:mode==='manifest'?'wrong':'manifest',sha256:'b'.repeat(64)}]})
    }
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000)
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  const base=server.resolvedUrls.local[0]
  await page.goto(base);await page.getByRole('button',{name:/^用户/}).click()
  async function open(){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:/^KB-02\b/}).click()}
  async function select(){await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:'分享源库 · dataset',exact:true}).waitFor({state:'attached'});await page.getByLabel('源知识库 ID',{exact:true}).selectOption('dataset');await expect(page.getByRole('button',{name:'读取文档审查与模型核对',exact:true})).toBeEnabled()}
  async function read(){await page.getByRole('button',{name:'读取文档审查与模型核对',exact:true}).click()}
  await open()
  await expect(page.getByRole('button',{name:'读取文档审查与模型核对',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'读取可用工作区',exact:true}).click()
  await page.getByRole('option',{name:'一区 · ws',exact:true}).waitFor({state:'attached'})
  await page.getByLabel('workspace ID（Dify 来源填写）',{exact:true}).selectOption('ws');await select()
  for(const failure of ['source','scope','count','manifest']) {
    mode=failure;await read()
    await page.getByText('文档审查依据与所选来源、范围或文档清单不匹配，请重新读取',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'提交知识库分享审批',exact:true}).count(),0)
  }
  mode='';await read();await expect(page.getByRole('button',{name:'提交知识库分享审批',exact:true})).toBeVisible()
  await page.getByLabel('workspace ID（Dify 来源填写）',{exact:true}).selectOption('ws2')
  assert.equal(await page.getByRole('button',{name:'提交知识库分享审批',exact:true}).count(),0)
  await expect(page.getByRole('button',{name:'读取文档审查与模型核对',exact:true})).toBeDisabled()
  await page.getByLabel('来源系统',{exact:true}).selectOption('RAGFlow')
  await expect(page.getByLabel('tenant ID',{exact:true})).toHaveValue('')
  await select();await expect(page.getByLabel('tenant ID',{exact:true})).toHaveValue('tenant-rag')
  await read();await page.getByLabel('业务用途',{exact:true}).fill('恢复后仍须复核')
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click()
  await page.getByText('申请草稿已保存',{exact:true}).waitFor()
  const drafts=(await(await page.request.get(base+'api/drafts')).json()).items
  assert.equal(drafts[0].fields.sourceSystem,'RAGFlow');assert.equal(drafts[0].fields.workspaceId,'tenant-rag')
  assert.equal(drafts[0].fields.context,undefined)
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open()
  await page.getByRole('button',{name:/恢复草稿 · dataset/}).click()
  await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  await expect(page.getByLabel('来源系统',{exact:true})).toHaveValue('RAGFlow')
  await expect(page.getByRole('button',{name:'读取文档审查与模型核对',exact:true})).toBeDisabled()
  assert.equal(await page.getByRole('button',{name:'提交知识库分享审批',exact:true}).count(),0)
  await select();await read();await expect(page.getByLabel('业务用途',{exact:true})).toHaveValue('恢复后仍须复核')
  for(const [label,value] of [['组织边界（逗号分隔）','业务一部'],['业务线','刑侦'],['目录展示名称','分享库'],['目录简介','用途说明'],['目录标签（逗号分隔）','知识库']])await page.getByLabel(label,{exact:true}).fill(value)
  mode='scope'
  let pending=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST')
  await page.getByRole('button',{name:'提交知识库分享审批',exact:true}).click()
  assert.equal((await pending).status(),403);assert.equal(commands,0)
  mode=''
  pending=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST')
  await page.getByRole('button',{name:'提交知识库分享审批',exact:true}).click()
  const response=await pending;assert.equal(response.status(),201,await response.text())
  assert.equal((await response.json()).status,'待受理');assert.equal(commands,0);assert.equal(posts,2)
  await expect(page.getByLabel('来源系统',{exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'新建申请草稿',exact:true}).click()
  await expect(page.getByLabel('来源系统',{exact:true})).toHaveValue('Dify')
  await expect(page.getByLabel('源知识库 ID',{exact:true})).toHaveValue('')
  assert.ok(reads.some(path=>path.includes('kind=dify_dataset') && path.includes('cursor=page2')))
  assert.ok(reads.some(path=>path.includes('kind=ragflow_dataset') && path.includes('cursor=page2')))
  console.log('PASS Edge: KB-02分页选择、来源/范围/清单错配拒绝、切区失效、RAG草稿重选、提交重读及受理后锁定')
}finally {await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
