import {agentImpact} from './support/agent-impact.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json,body} from '../runtime/http.mjs'
import {mockExecution} from './support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'publication-associations-browser-'));process.env.APP_DATA_DIR=dir
let server,browser,capability,allowed=true,revision=1,posts=0
const commands=[],states=new Map(),reads=[],secret='PRIVATE-ASSOCIATION-CREDENTIAL'
try{
  capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push(req.url)
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'app-ws',name:'发布工作区'}],nextCursor:null})
    if(path==='/internal/v1/resources')return json(res,{items:[{resourceId:'dataset',name:'RAG源库',source:'ragflow',workspaceId:null}],nextCursor:null})
    if(path.includes('/resources/ragflow_dataset/'))return json(res,{snapshotId:'source',resourceId:'dataset',workspaceId:null,capturedAt:new Date().toISOString(),data:{tenantId:'tenant-source',ownerAccount:'chen.yu'}})
    if(path.includes('/execution-contexts/KB-02'))return json(res,{snapshotId:'kb-context',capturedAt:new Date().toISOString(),ticketType:'KB-02',action:'publish_dataset',resourceId:'dataset',fields:{'来源系统':'RAGFlow','所有者账户名':'chen.yu','workspace/tenant ID':'tenant-source','文档数':1,'文档清单快照ID':'manifest','模型目录核对结果':'一致','文档审查明细':[{documentId:'doc',sha256:'a'.repeat(64),autoVerdict:'通过'}]},preconditions:[{kind:'dataset_manifest',id:'manifest',sha256:'a'.repeat(64)}]})
    if(path==='/internal/v1/application-targets')return json(res,{items:q.has('cursor')?[{appId:'app',name:'待发布应用',workspaceId:'app-ws',secret}]:[],nextCursor:q.has('cursor')?null:'page2'})
    if(path.includes('/application-targets/'))return json(res,{appId:'app',name:'待发布应用',workspaceId:'app-ws',purpose:q.get('purpose'),eligible:allowed,targetRef:'app-ref',revision,secret})
    if(path==='/internal/v1/agent-replacements')return json(res,{items:q.has('cursor')?[{resourceId:'replacement',name:'替代目录',secret}]:[],nextCursor:q.has('cursor')?null:'page2'})
    if(path.includes('/agent-replacements/'))return json(res,{sourceResourceId:'original',resourceId:'replacement',sourceAppId:'owner-app',sourceWorkspaceId:'owner-ws',name:'替代目录',appId:'new-app',workspaceId:'new-ws',status:'active',publicationVersionId:'v2',policyRef:'new-policy',revision,eligible:allowed,audienceCompatible:true,secret})
    const metadata={appId:'owner-app',workspaceId:'owner-ws',publicationVersionId:'v1',workflowSnapshotId:'wf',policyRef:'original-policy'}
    if(path==='/internal/v1/catalog')return json(res,{items:[{resourceId:'original',name:'原目录',status:'active',actions:['withdraw_app'],data:metadata}],nextCursor:null})
    if(path.includes('/catalog/agent/'))return json(res,{resourceId:'original',status:'active',actions:['withdraw_app'],data:metadata})
    if(path.includes('/resources/dify_app/'))return json(res,{snapshotId:'app-source',resourceId:'owner-app',workspaceId:'owner-ws',capturedAt:new Date().toISOString(),data:{publicationVersionId:'v1',catalogRevision:1,agentImpact:agentImpact('original','owner-app','owner-ws')}})
    if(path.endsWith('/executions') && req.method==='POST'){const c=await body(req);commands.push(c);const state=mockExecution(c,{status:'succeeded',result:{resultId:'done'}});states.set(c.executionId,state);return json(res,state)}
    const state=states.get(path.split('/').at(-1));return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url;server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true});const base=server.resolvedUrls.local[0]
  async function login(role){const p=await browser.newPage();p.setDefaultTimeout(10000);await p.goto(base);await p.getByRole('button',{name:new RegExp('^'+role)}).click();return p}
  const page=await login('用户'),ops=await login('运维人员');page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  async function open(type){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click()}
  async function kbSource(){await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:'RAG源库 · dataset',exact:true}).waitFor({state:'attached'});await page.getByLabel('源知识库 ID',{exact:true}).selectOption('dataset');await expect(page.getByLabel('tenant ID',{exact:true})).toHaveValue('tenant-source');await page.getByRole('button',{name:'读取文档审查与模型核对',exact:true}).click();await page.getByRole('group',{name:'知识库分享申请',exact:true}).waitFor()}
  async function related(){await page.getByRole('button',{name:'读取关联应用工作区',exact:true}).click();await page.getByRole('option',{name:'发布工作区 · app-ws',exact:true}).waitFor({state:'attached'});await page.getByLabel('关联Dify工作区',{exact:true}).selectOption('app-ws');await page.getByRole('button',{name:'读取可关联目标应用',exact:true}).click();await page.getByRole('option',{name:'待发布应用 · app',exact:true}).waitFor({state:'attached'});await page.getByLabel('关联Dify应用（必选）',{exact:true}).selectOption('app');await expect(page.getByLabel('目标应用名称',{exact:true})).toHaveValue('待发布应用')}
  async function source(){await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:'原目录 · original',exact:true}).waitFor({state:'attached'});await page.getByLabel('仓库应用 ID',{exact:true}).selectOption('original');await expect(page.getByLabel('Dify应用 ID',{exact:true})).toHaveValue('owner-app')}
  async function replacement(){await page.getByRole('button',{name:'读取可用替代应用',exact:true}).click();await page.getByRole('option',{name:'替代目录 · replacement',exact:true}).waitFor({state:'attached'});await page.getByLabel('替代仓库应用',{exact:true}).selectOption('replacement');await page.getByText('替代应用 · 替代目录 · 版本 v2 · 工作区 new-ws',{exact:true}).waitFor()}
  async function submit(name){const response=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name,exact:true}).click();return response}
  async function approve(row,kb){await ops.getByRole('button',{name:/^我的待办/}).click();await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click();await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click();await ops.getByLabel('办理意见',{exact:true}).fill('核验关联映射与范围');if(kb)await ops.getByRole('checkbox',{name:/doc/}).check();else await ops.getByRole('option',{name:'仓库下架',exact:true}).waitFor({state:'attached'});if(!kb)await ops.getByRole('listbox',{name:'处置范围',exact:true}).selectOption('仓库下架');const response=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'));await ops.getByRole('button',{name:'批准',exact:true}).click();return response}
  await open('KB-02');await page.getByLabel('来源系统',{exact:true}).selectOption('RAGFlow');await kbSource();await page.getByLabel('分享方式',{exact:true}).selectOption('随应用发布')
  for(const [label,value] of [['业务用途','随首次应用发布'],['组织边界（逗号分隔）','业务一部'],['业务线','业务'],['目录展示名称','知识库'],['目录简介','说明'],['目录标签（逗号分隔）','业务']])await page.getByLabel(label,{exact:true}).fill(value)
  await related();await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor();await page.getByRole('button',{name:'我的申请',exact:true}).click();await open('KB-02');await page.getByRole('button',{name:/恢复草稿 · dataset/}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor();await kbSource()
  await page.getByRole('button',{name:'提交知识库分享审批',exact:true}).click();assert.equal(posts,0);await related();allowed=false;assert.equal((await submit('提交知识库分享审批')).status(),403);allowed=true;const kbResponse=await submit('提交知识库分享审批');assert.equal(kbResponse.status(),201,await kbResponse.text());const kb=await kbResponse.json();assert.equal(kb.submission.workspaceId,'tenant-source');assert.equal(kb.targetApplication.workspaceId,'app-ws')
  revision=2;assert.equal((await approve(kb,true)).status(),409);revision=1;assert.equal((await approve(kb,true)).status(),200)
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open('AG-05');await source();await replacement();await page.getByLabel('原因说明',{exact:true}).fill('迁移到替代目录');await page.getByLabel('生效时间',{exact:true}).fill('2026-01-01T00:00')
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor();const before=posts;await page.getByRole('button',{name:'我的申请',exact:true}).click();await open('AG-05');await page.getByRole('button',{name:/恢复草稿 · original/}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor();await source();await page.getByRole('button',{name:'提交下架审批',exact:true}).click();assert.equal(posts,before);await replacement()
  const agResponse=await submit('提交下架审批');assert.equal(agResponse.status(),201,await agResponse.text());const ag=await agResponse.json();revision=2;assert.equal((await approve(ag,false)).status(),409);revision=1;assert.equal((await approve(ag,false)).status(),200)
  await expect.poll(()=>commands.length).toBe(2);assert.deepEqual(commands.map(c=>c.action),['publish_dataset','withdraw_app']);const rows=await(await page.request.get(base+'api/applications?view=mine')).json();assert.ok(!JSON.stringify(rows).includes(secret));assert.ok(reads.some(url=>url.includes('purpose=dataset_publication') && url.includes('cursor=page2')))
  console.log('PASS Edge: RAG租户/关联Dify区独立、待发布应用与替代目录分页、恢复重选、撤权/修订拦截及两类审批下发')
}finally{await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
