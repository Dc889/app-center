import {agentImpact} from '../../../../../tests/support/agent-impact.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {body,json,listen} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'agent-management-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability,allowed=true,posts=0,callsMissing=true,missingKeys=false,calls=7,grantsRevision=1,dependencyApproved=true
const commands=[],states=new Map(),reads=[]
const metadata={appId:'app',workspaceId:'owner-ws',publicationVersionId:'old',workflowSnapshotId:'old-workflow',policyRef:'policy'}
function impactEvidence(){const evidence=agentImpact('agent','app','owner-ws',[{kind:'tool',id:'tool',name:'新工具',change:'added',approved:dependencyApproved,externalAllowed:dependencyApproved}]);evidence.grants={state:'collected',count:2,revision:grantsRevision,items:['grant-1','grant-2']};evidence.keys=missingKeys?{state:'unavailable',count:null,items:null,revision:null,reasonCode:'NO_SOURCE'}:{state:'collected',count:1,revision:1,items:['key-reg']};if(callsMissing)evidence.calls30d={state:'unavailable',count:null,from:null,to:null,reasonCode:'NO_SOURCE'};else evidence.calls30d.count=calls;return evidence}
try {
  capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams,action=q.get('action');reads.push(req.url)
    if(path==='/internal/v1/catalog')return json(res,{items:q.has('cursor')?[
      {resourceId:'agent',name:'管理应用',status:action==='republish'?'withdrawn':'unavailable',actions:[action],data:metadata}]:[
      {resourceId:'unmanaged',name:'只有使用权',status:'active',actions:[],data:metadata}],nextCursor:q.has('cursor')?null:'page2'})
    if(path.includes('/catalog/agent/'))return json(res,{resourceId:'agent',status:action==='republish'?'withdrawn':'unavailable',actions:allowed?[action]:[],data:metadata})
    if(path.includes('/resources/'))return json(res,{snapshotId:'new-snapshot',resourceId:'app',workspaceId:'owner-ws',capturedAt:new Date().toISOString(),data:{publicationVersionId:'new',workflowSnapshotId:'new-workflow',catalogRevision:2,dependencies:[],agentImpact:impactEvidence()}})
    if(path.endsWith('/executions') && req.method==='POST') {
      const command=await body(req);commands.push(command);const state=mockExecution(command,{status:'succeeded',result:{resultId:'result'}});states.set(command.executionId,state);return json(res,state)
    }
    const state=states.get(path.split('/').at(-1));return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const base=server.resolvedUrls.local[0]
  async function login(role){const p=await browser.newPage();p.setDefaultTimeout(10000);await p.goto(base);await p.getByRole('button',{name:new RegExp('^'+role)}).click();return p}
  const page=await login('用户'),ops=await login('运维人员')
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  async function open(type){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click()}
  async function select(){await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:'管理应用 · agent',exact:true}).waitFor({state:'attached'});assert.equal(await page.getByRole('option',{name:/只有使用权/}).count(),0);await page.getByLabel('仓库应用 ID',{exact:true}).selectOption('agent');await expect(page.getByLabel('Dify应用 ID',{exact:true})).toHaveValue('app')}
  async function submit(name){const result=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name,exact:true}).click();return result}
  async function approve(row){await ops.getByRole('button',{name:/^我的待办/}).click();await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click();await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click();await ops.getByLabel('办理意见',{exact:true}).fill('核对版本及处置');const pending=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'));await ops.getByRole('button',{name:'批准',exact:true}).click();return pending}
  await open('AG-04');await select()
  await expect(page.getByLabel('当前有效授权数',{exact:true})).toHaveValue('2');await expect(page.getByLabel('当前有效密钥数',{exact:true})).toHaveValue('1');await expect(page.getByLabel('近30天调用数',{exact:true})).toHaveValue('未采集');await page.getByText('新增 · 工具 · 新工具 · tool · 已批准 · 允许对外',{exact:true}).waitFor();callsMissing=false
  await expect(page.getByLabel('来源工作区',{exact:true})).toHaveValue('owner-ws')
  await expect(page.getByText(/原发布版本 · old/)).toContainText('新工作流 · new-workflow')
  await page.getByLabel('原因说明',{exact:true}).fill('修复后重新发布')
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor()
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open('AG-04')
  await page.getByRole('button',{name:/恢复草稿 · agent/}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  await page.getByRole('button',{name:'提交再发布审批',exact:true}).click();assert.equal(posts,0)
  await select();allowed=false;assert.equal((await submit('提交再发布审批')).status(),403);assert.equal(commands.length,0)
  allowed=true;const response=await submit('提交再发布审批');assert.equal(response.status(),201,await response.text());const republish=await response.json()
  allowed=false;assert.equal((await approve(republish)).status(),403);assert.equal(commands.length,0)
  allowed=true;grantsRevision=2;assert.equal((await approve(republish)).status(),409);grantsRevision=1;dependencyApproved=false;assert.equal((await approve(republish)).status(),409);dependencyApproved=true;calls=33;assert.equal((await approve(republish)).status(),200);await expect(ops.getByLabel('近30天调用数',{exact:true})).toHaveValue('33');await expect.poll(()=>commands.length).toBe(1);assert.equal(commands[0].action,'republish')
  missingKeys=true;await open('AG-05');await select();await expect(page.getByLabel('当前有效密钥数',{exact:true})).toHaveValue('未采集');await page.getByRole('button',{name:'提交下架审批',exact:true}).click();assert.equal(posts,2);missingKeys=false;await select();await page.getByLabel('原因说明',{exact:true}).fill('长期故障停止服务');await page.getByLabel('生效时间',{exact:true}).fill('2026-01-01T00:00')
  const second=await submit('提交下架审批');assert.equal(second.status(),201,await second.text());const withdraw=await second.json()
  assert.equal((await approve(withdraw)).status(),200);await expect.poll(()=>commands.length).toBe(2);assert.equal(commands[1].action,'withdraw_app')
  assert.ok(commands.every(c=>c.account==='chen.yu'))
  assert.ok(reads.some(path=>path.includes('action=republish') && path.includes('cursor=page2')))
  assert.ok(reads.some(path=>path.includes('action=withdraw_app') && path.includes('cursor=page2')))
  console.log('PASS Edge: AG管理影响统计/未采集区别、资源差异、恢复重读、清单/依赖变化拒绝、调用增长更新、资格复核及两类审批下发')
}finally{await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
