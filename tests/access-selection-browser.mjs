import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json,body} from '../runtime/http.mjs'
import {mockExecution} from './support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'access-selection-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability,workspaces=0,posts=0,badAgent=false,bindingAccess='approval'
const commands=[],states=new Map(),reads=[]
const agentData={workspaceId:'source-ws',appId:'app',usages:['run'],scope:'orgs',targetOrgs:['业务一部'],boundaryOrgs:['业务一部'],policyRef:'published-policy'}
try {
  capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push(req.url)
    if(path.endsWith('/workspaces')){workspaces++;return json(res,{items:[{workspaceId:'ws1',name:'一区'},{workspaceId:'ws2',name:'二区'}],nextCursor:null})}
    if(path==='/internal/v1/catalog') {
      const last=q.has('cursor'),agent=q.get('kind')==='agent'
      return json(res,{items:[agent?{resourceId:last?'agent':'withdrawn',name:last?'共享智能体':'已下架智能体',status:last?'active':'withdrawn',actions:[],data:agentData}:
        {resourceId:last?'mcp':'isolated',name:last?'可绑定MCP':'隔离MCP',status:last?'active':'isolated',actions:['bind'],data:{bindingAccess:'approval'}}],nextCursor:last?null:'page2'})
    }
    if(path==='/internal/v1/catalog/agent/agent')return json(res,{resourceId:'agent',status:'active',data:{...agentData,workspaceId:badAgent?'wrong':'source-ws'}})
    if(path.includes('/resources/'))return json(res,{snapshotId:'published',resourceId:'app',workspaceId:'source-ws',data:{publicationVersionId:'pub',catalogRevision:2}})
    if(path.includes('/binding-contexts/'))return json(res,{resourceId:'mcp',workspaceId:q.get('workspaceId'),bindingAccess,expectedUrlFingerprint:'a'.repeat(64)})
    if(path.endsWith('/executions') && req.method==='POST') {
      const command=await body(req);commands.push(command)
      const state=mockExecution(command,{status:'succeeded',result:{resultId:'result'}});states.set(command.executionId,state);return json(res,state)
    }
    const state=states.get(path.split('/').at(-1));return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const base=server.resolvedUrls.local[0]
  async function login(role){const page=await browser.newPage();page.setDefaultTimeout(10000);await page.goto(base);await page.getByRole('button',{name:new RegExp('^'+role)}).click();return page}
  const page=await login('用户')
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  async function open(type){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click()}
  async function select(kind){await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:kind==='agent'?'共享智能体 · agent':'可绑定MCP · mcp',exact:true}).waitFor({state:'attached'});await page.getByLabel(kind==='agent'?'仓库应用 ID':'MCP目录 ID',{exact:true}).selectOption(kind)}
  async function dates(){await page.getByLabel('使用目的',{exact:true}).fill('业务使用');await page.getByLabel('使用开始时间',{exact:true}).fill('2026-01-01T00:00');await page.getByLabel('使用截止时间',{exact:true}).fill('2030-01-01T00:00')}
  async function submit(){const r=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name:'提交使用授权',exact:true}).click();return r}
  await open('AG-03');await select('agent')
  await expect(page.getByLabel('Dify应用 ID',{exact:true})).toHaveValue('app')
  await expect(page.getByLabel('来源工作区',{exact:true})).toHaveValue('source-ws')
  assert.equal(workspaces,0)
  assert.equal(await page.getByRole('option',{name:/已下架智能体/}).count(),0)
  await expect(page.getByLabel('访问 API',{exact:true})).toBeDisabled();await dates()
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor()
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open('AG-03')
  await page.getByRole('button',{name:/恢复草稿 · agent/}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  await page.getByRole('button',{name:'提交使用授权',exact:true}).click();assert.equal(posts,0)
  badAgent=true;await select('agent');await page.getByText('智能体目录详情与所选资源、工作区或使用方式不匹配',{exact:true}).waitFor()
  badAgent=false;await select('agent');await expect(page.getByLabel('Dify应用 ID',{exact:true})).toHaveValue('app')
  const first=await submit();assert.equal(first.status(),201,await first.text());const ag=await first.json();assert.equal(ag.status,'待受理');assert.equal(commands.length,0)
  const ops=await login('运维人员')
  async function approve(row){await ops.getByRole('button',{name:/^我的待办/}).click();await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click();await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click();await ops.getByLabel('办理意见',{exact:true}).fill('范围与期限已核对');await ops.getByRole('button',{name:'批准',exact:true}).click()}
  await approve(ag);await expect.poll(()=>commands.length).toBe(1)
  assert.equal(commands[0].action,'grant_app_access');assert.equal(commands[0].account,'chen.yu')
  await open('MCP-02')
  await page.getByRole('button',{name:'读取可用工作区',exact:true}).click();await page.getByRole('option',{name:'一区 · ws1',exact:true}).waitFor({state:'attached'})
  await page.getByLabel('工作区 ID',{exact:true}).selectOption('ws1');await select('mcp');await dates()
  assert.equal(await page.getByRole('option',{name:/隔离MCP/}).count(),0)
  bindingAccess='denied';await page.getByRole('button',{name:'读取绑定依据',exact:true}).click();await page.getByText('MCP_BINDING_DENIED',{exact:true}).waitFor()
  await page.getByRole('button',{name:'提交使用授权',exact:true}).click();assert.equal(posts,1)
  bindingAccess='approval';await page.getByRole('button',{name:'读取绑定依据',exact:true}).click()
  await expect(page.locator('pre')).toContainText('approval');assert.ok(!(await page.content()).includes('a'.repeat(64)))
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor()
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open('MCP-02')
  await page.getByRole('button',{name:/恢复草稿 · mcp/}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  await expect(page.getByRole('button',{name:'读取绑定依据',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'读取可用工作区',exact:true}).click();await page.getByRole('option',{name:'一区 · ws1',exact:true}).waitFor({state:'attached'});await select('mcp')
  await page.getByRole('button',{name:'读取绑定依据',exact:true}).click();await expect(page.locator('pre')).toContainText('approval')
  await page.getByLabel('工作区 ID',{exact:true}).selectOption('ws2')
  await expect(page.getByRole('button',{name:'读取绑定依据',exact:true})).toBeDisabled();assert.equal(await page.locator('pre').count(),0)
  await select('mcp');await page.getByRole('button',{name:'读取绑定依据',exact:true}).click();await expect(page.locator('pre')).toContainText('ws2')
  bindingAccess='denied';const denied=await submit();assert.equal(denied.status(),403);assert.equal(commands.length,1)
  bindingAccess='approval';const second=await submit();assert.equal(second.status(),201,await second.text());const mcp=await second.json();assert.equal(mcp.status,'待受理')
  await approve(mcp);await expect.poll(()=>commands.length).toBe(2)
  assert.equal(commands[1].action,'bind');assert.equal(commands[1].payload.workspaceId,'ws2');assert.equal(commands[1].payload.expectedUrlFingerprint,'a'.repeat(64))
  assert.ok(reads.some(path=>path.includes('kind=agent') && path.includes('cursor=page2')))
  assert.ok(reads.some(path=>path.includes('kind=mcp') && path.includes('cursor=page2')))
  console.log('PASS Edge: AG来源工作区/发布方式、MCP目标工作区、分页过滤、草稿重选、绑定资格变化及两类审批下发')
}finally {await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
