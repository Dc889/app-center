import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'application-targets-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability,allowed=true,revision=1,scope=false,posts=0
const commands=[],reads=[],states=new Map(),secret='TARGET-PRIVATE-CREDENTIAL'
try{
  capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push(req.url)
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'ws1',name:'一区'},{workspaceId:'ws2',name:'二区'}],nextCursor:null})
    if(path.endsWith('/KB-03/candidates'))return json(res,{items:[{resourceId:'kb',name:'共享库',workspaceId:q.get('workspaceId'),source:'已发布共享',sourceSystem:'Dify',sourceScopeId:'ws1',sourceResourceId:'product',ownerAccount:'other'}],nextCursor:null})
    if(path.endsWith('/execution-contexts/KB-03'))return json(res,{snapshotId:'kb-context',ticketType:'KB-03',action:'bind_dataset',resourceId:'kb',eligible:true,
      fields:{'目录来源':'已发布共享','来源系统':'Dify','知识库名称':'共享库','源workspace/tenant ID':'ws1','源知识库ID':'product','源所有者账户名':'other','目标Dify workspace ID':q.get('workspaceId'),
        '组织边界':['业务一部'],'密级':'内部','业务线':'业务','允许申请权限':['检索使用','编排绑定'],'实现方式':q.get('workspaceId')==='ws1'?'Dify同workspace授权':'Dify跨workspace复制','边界匹配结果':'符合',policyRef:'policy','文档清单快照ID':'manifest','源文档版本指纹':'a'.repeat(64)},preconditions:[{kind:'dataset_catalog',id:'kb',revision:1},{kind:'dataset_manifest',id:'manifest',sha256:'a'.repeat(64)}]})
    if(path==='/internal/v1/catalog')return json(res,{items:[{resourceId:'mcp',name:'MCP',status:'active',actions:['bind'],data:{bindingAccess:'approval'}}],nextCursor:null})
    if(path.includes('/binding-contexts/'))return json(res,{resourceId:'mcp',workspaceId:q.get('workspaceId'),bindingAccess:'approval',expectedUrlFingerprint:'a'.repeat(64)})
    if(path==='/internal/v1/application-targets')return json(res,{items:q.has('cursor')?[{appId:'app',name:'绑定目标应用',workspaceId:scope?'wrong':q.get('workspaceId'),secret}]:[],nextCursor:q.has('cursor')?null:'page2'})
    if(path==='/internal/v1/application-targets/app')return json(res,{appId:'app',name:'绑定目标应用',workspaceId:q.get('workspaceId'),purpose:q.get('purpose'),eligible:allowed,revision,targetRef:'target-ref',secret})
    if(path.endsWith('/executions') && req.method==='POST'){const c=await body(req);commands.push(c);const state=mockExecution(c,{status:'succeeded',result:{resultId:'bound'}});states.set(c.executionId,state);return json(res,state)}
    const state=states.get(path.split('/').at(-1));return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true});const base=server.resolvedUrls.local[0]
  async function login(role){const p=await browser.newPage();p.setDefaultTimeout(10000);await p.goto(base);await p.getByRole('button',{name:new RegExp('^'+role)}).click();return p}
  const page=await login('用户'),ops=await login('运维人员')
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  async function open(type){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click()}
  async function source(type,workspace='ws1'){
    await page.getByRole('button',{name:'读取可用工作区',exact:true}).click();await page.getByRole('option',{name:'一区 · ws1',exact:true}).waitFor({state:'attached'});await page.getByLabel('工作区 ID',{exact:true}).selectOption(workspace)
    if(type==='KB-03'){await page.getByRole('button',{name:'读取可绑定知识库',exact:true}).click();await page.getByRole('option',{name:/共享库/}).waitFor({state:'attached'});await page.getByLabel('目录知识库 ID',{exact:true}).selectOption('kb')}
    else{await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:'MCP · mcp',exact:true}).waitFor({state:'attached'});await page.getByLabel('MCP目录 ID',{exact:true}).selectOption('mcp')}
    await page.getByRole('button',{name:'读取绑定依据',exact:true}).click();if(type==='KB-03')await expect(page.getByLabel('源知识库ID',{exact:true})).toHaveValue('product');else await expect(page.locator('pre')).toContainText(workspace)
  }
  async function target(){await page.getByRole('button',{name:'读取可关联目标应用',exact:true}).click();await page.getByRole('option',{name:'绑定目标应用 · app',exact:true}).waitFor({state:'attached'});await page.getByLabel('目标Dify应用（选填）',{exact:true}).selectOption('app');await expect(page.getByLabel('目标应用名称',{exact:true})).toHaveValue('绑定目标应用')}
  async function submit(){const response=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name:'提交使用授权',exact:true}).click();return response}
  async function approve(row){await ops.getByRole('button',{name:/^我的待办/}).click();await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click();await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click();await ops.getByLabel('办理意见',{exact:true}).fill('目标应用配置权限已核对');const response=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'));await ops.getByRole('button',{name:'批准',exact:true}).click();return response}
  for(const type of ['KB-03','MCP-02']){
    await open(type);await expect(page.getByRole('button',{name:'读取可关联目标应用',exact:true})).toBeDisabled();await source(type)
    scope=true;await page.getByRole('button',{name:'读取可关联目标应用',exact:true}).click();await page.getByText('INVALID_APPLICATION_TARGET_PAGE',{exact:true}).waitFor();scope=false;await target()
    await page.getByLabel('使用目的',{exact:true}).fill('关联目标应用');await page.getByLabel('使用开始时间',{exact:true}).fill('2026-01-01T00:00');await page.getByLabel('使用截止时间',{exact:true}).fill('2030-01-01T00:00')
    await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor()
    const before=posts;await page.getByRole('button',{name:'我的申请',exact:true}).click();await open(type);await page.getByRole('button',{name:new RegExp('恢复草稿 · '+(type==='KB-03'?'kb':'mcp'))}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor();await source(type)
    await page.getByRole('button',{name:'提交使用授权',exact:true}).click();assert.equal(posts,before);await page.getByText('待重新核验的目标应用 · app',{exact:true}).waitFor();await target()
    await page.getByLabel('工作区 ID',{exact:true}).selectOption('ws2');await expect(page.getByLabel('目标应用名称',{exact:true})).toHaveCount(0);await source(type,'ws2');await page.getByRole('button',{name:'提交使用授权',exact:true}).click();assert.equal(posts,before);await target();await expect(page.getByLabel('目标应用工作区',{exact:true})).toHaveValue('ws2')
    allowed=false;assert.equal((await submit()).status(),403);allowed=true;const response=await submit();assert.equal(response.status(),201,await response.text());const row=await response.json()
    revision=2;assert.equal((await approve(row)).status(),409);revision=1;allowed=false;assert.equal((await approve(row)).status(),403);allowed=true;assert.equal((await approve(row)).status(),200)
    await page.getByRole('button',{name:'我的申请',exact:true}).click()
  }
  await expect.poll(()=>commands.length).toBe(2);assert.equal(commands[1].payload.targetAppId,'app');assert.equal(commands[1].payload.decisionRef,'dec-'+commands[1].executionId)
  const rows=await(await page.request.get(base+'api/applications?view=mine')).json();assert.ok(!JSON.stringify(rows).includes(secret));assert.ok(reads.some(url=>url.includes('purpose=dataset_binding') && url.includes('cursor=page2')));assert.ok(reads.some(url=>url.includes('purpose=mcp_binding') && url.includes('cursor=page2')))
  assert.ok(reads.some(url=>url.includes('/execution-contexts/KB-03?') && url.includes('targetAppId=app')))
  console.log('PASS Edge: KB/MCP目标应用按用途/工作区分页、错区/撤权/修订拒绝、恢复/切区强制重选及两类审批下发')
}finally{await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
