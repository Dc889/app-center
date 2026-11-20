import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json} from '../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'resource-picker-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability,posts=0,commands=0
const reads=[]
try {
  capability=await listen((req,res,path)=>{
    const query=new URL(req.url,'http://localhost').searchParams
    if(req.method==='POST'){commands++;return json(res,{error:{code:'NO_COMMAND_EXPECTED'}},409)}
    reads.push(req.url)
    if(path.endsWith('/workspaces'))return json(res,{items:[query.has('cursor')?{workspaceId:'ws2',name:'二区'}:{workspaceId:'ws1',name:'一区'}],nextCursor:query.has('cursor')?null:'workspaces-page2'})
    if(path.endsWith('/resources')) {
      if(query.get('kind')==='mcp_registration')return json(res,{items:[{resourceId:'mcp-registration',name:'技术登记',source:'model-center',workspaceId:null}],nextCursor:null})
      const ws=query.get('workspaceId')
      if(query.get('q')==='wrong')return json(res,{items:[{resourceId:'wrong',name:'错区应用',source:'dify',workspaceId:'other'}],nextCursor:null})
      if(query.get('q')==='repeat')return json(res,{items:[{resourceId:'loop',name:'循环应用',source:'dify',workspaceId:ws}],nextCursor:'same-cursor'})
      return json(res,{items:[{resourceId:query.has('cursor')?'app-final':'app-first',name:query.has('cursor')?'末页应用':'首页应用',source:'dify',workspaceId:ws}],nextCursor:query.has('cursor')?null:'resources-page2'})
    }
    if(path.includes('/execution-contexts/'))return json(res,{error:{code:'PERMISSION_CHANGED',message:'资源权限已变化'}},403)
    if(path.includes('/resources/mcp_registration/'))return json(res,{resourceId:'mcp-registration',snapshotId:'mcp-server-snapshot',capturedAt:new Date().toISOString(),data:{
      registrationId:'mcp-registration',name:'技术登记',status:'active',transport:'streamable-http',urlFingerprint:'a'.repeat(64),authType:'service-reference',tools:[],syncedAt:new Date().toISOString()}})
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000)
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  const base=server.resolvedUrls.local[0]
  await page.goto(base);await page.getByRole('button',{name:/^用户/}).click()
  async function open(type){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click()}
  async function loadWorkspace(){await page.getByRole('button',{name:'读取可用工作区',exact:true}).click();await page.getByRole('option',{name:'二区 · ws2',exact:true}).waitFor({state:'attached'})}
  async function loadResources(){await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:'末页应用 · app-final',exact:true}).waitFor({state:'attached'})}
  await open('KEY-01')
  await loadWorkspace();await page.getByLabel('工作区 ID',{exact:true}).selectOption('ws1')
  await loadResources();await page.getByLabel('Dify应用 ID',{exact:true}).selectOption('app-final')
  for(const [label,value] of [['调用方名称','调用方'],['调用方组织','业务一部'],['允许来源CIDR（逗号分隔）','10.0.0.0/8'],['有效期截止时间','2030-01-01T12:00']])await page.getByLabel(label,{exact:true}).fill(value)
  const save=page.waitForResponse(r=>r.url().endsWith('/api/drafts') && r.request().method()==='POST')
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click()
  const draft=await(await save).json();assert.equal(draft.fields.resourceId,'app-final')
  assert.equal(draft.fields.selection,undefined)
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open('KEY-01')
  await page.getByRole('button',{name:/恢复草稿 · app-final/}).click()
  await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  await expect(page.getByLabel('Dify应用 ID',{exact:true})).toHaveValue('')
  await page.getByRole('button',{name:'提交密钥创建登记',exact:true}).click();assert.equal(posts,0)
  await loadWorkspace();await loadResources();await page.getByLabel('Dify应用 ID',{exact:true}).selectOption('app-final')
  await page.getByLabel('工作区 ID',{exact:true}).selectOption('ws2')
  await expect(page.getByLabel('Dify应用 ID',{exact:true})).toHaveValue('')
  await page.getByRole('button',{name:'提交密钥创建登记',exact:true}).click();assert.equal(posts,0)
  await page.getByLabel('资源搜索',{exact:true}).fill('wrong')
  await page.getByRole('button',{name:'读取可选资源',exact:true}).click()
  await page.getByText('资源目录存在重复标识或工作区不匹配',{exact:true}).waitFor()
  assert.equal(await page.getByRole('option',{name:/错区应用/}).count(),0)
  await page.getByLabel('资源搜索',{exact:true}).fill('repeat')
  await page.getByRole('button',{name:'读取可选资源',exact:true}).click()
  await page.getByText('目录分页异常，请重新读取',{exact:true}).waitFor()
  assert.equal(await page.getByRole('option',{name:/循环应用/}).count(),0)
  await page.getByLabel('资源搜索',{exact:true}).fill('');await loadResources()
  await page.getByLabel('Dify应用 ID',{exact:true}).selectOption('app-final')
  const submit=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST')
  await page.getByRole('button',{name:'提交密钥创建登记',exact:true}).click()
  assert.equal((await submit).status(),403)
  await page.getByText('资源权限已变化',{exact:true}).waitFor();assert.equal(commands,0)
  assert.ok(reads.some(path=>path.includes('cursor=workspaces-page2')))
  assert.ok(reads.some(path=>path.includes('cursor=resources-page2')))
  await open('MCP-01')
  await page.getByRole('button',{name:'读取可选资源',exact:true}).click()
  await page.getByRole('option',{name:'技术登记 · mcp-registration',exact:true}).waitFor({state:'attached'})
  await page.getByLabel('技术注册 ID',{exact:true}).selectOption('mcp-registration')
  for(const [label,value] of [['MCP名称','登记MCP'],['MCP用途','查询工具'],['组织边界（逗号分隔）','业务一部'],['业务线','刑侦']])await page.getByLabel(label,{exact:true}).fill(value)
  const mcp=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST')
  await page.getByRole('button',{name:'提交MCP登记审批',exact:true}).click()
  const response=await mcp;assert.equal(response.status(),201,await response.text())
  assert.equal(commands,0)
  console.log('PASS Edge: 工作区与资源跨页、恢复重选、切区清空、错区/分页异常拒绝、服务端重读拒绝及MCP登记受理')
}finally {await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
