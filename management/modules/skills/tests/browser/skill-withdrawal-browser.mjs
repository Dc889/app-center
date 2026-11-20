import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'skill-withdrawal-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='skill-withdrawal'
let server,browser,capability,allowed=true,version='1',posts=0
const reads=[],commands=[],states=new Map()
try {
  capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push(req.url)
    if(path==='/internal/v1/catalog')return json(res,{items:q.has('cursor')?[{resourceId:'skill',name:'本人技能',status:'available',actions:['withdraw_skill'],data:{version}}]:[
      {resourceId:'download',name:'仅可下载技能',status:'available',actions:['download'],data:{version:'1'}},
      {resourceId:'withdrawn',name:'已下架技能',status:'withdrawn',actions:['withdraw_skill'],data:{version:'1'}}],nextCursor:q.has('cursor')?null:'page2'})
    if(path==='/internal/v1/catalog/skill/skill')return json(res,{resourceId:'skill',status:'available',actions:allowed?['withdraw_skill']:['download'],data:{version}})
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'skill-context',ticketType:'SKL-04',action:'withdraw_skill',resourceId:'skill',fields:{'Skill名称':'本人技能','当前版本号':version,'历史下载次数':10,'历史下载人数':3},preconditions:[{kind:'skill',id:'skill',revision:1}]})
    if(path.endsWith('/executions') && req.method==='POST') {
      const command=await body(req);commands.push(command);const state=mockExecution(command,{status:'succeeded',result:{resultId:'withdrawn'}});states.set(command.executionId,state);return json(res,state)
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
  async function open(){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:/^SKL-04\b/}).click()}
  async function select(){await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:'本人技能 · skill',exact:true}).waitFor({state:'attached'});assert.equal(await page.getByRole('option',{name:/仅可下载技能|已下架技能/}).count(),0);await page.getByLabel('Skill目录 ID',{exact:true}).selectOption('skill');await expect(page.getByText(/历史下载次数 · 10/)).toContainText('历史下载人数 · 3')}
  await open();await select();await page.getByLabel('原因说明',{exact:true}).fill('旧版停止使用');await page.getByLabel('生效时间',{exact:true}).fill('2026-01-01T00:00')
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor()
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open()
  await page.getByRole('button',{name:/恢复草稿 · skill/}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  await page.getByRole('button',{name:'提交下架审批',exact:true}).click();assert.equal(posts,0)
  await select();allowed=false
  let pending=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name:'提交下架审批',exact:true}).click();assert.equal((await pending).status(),403);assert.equal(commands.length,0)
  allowed=true;pending=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name:'提交下架审批',exact:true}).click();const response=await pending;assert.equal(response.status(),201,await response.text());const row=await response.json()
  await ops.getByRole('button',{name:/^我的待办/}).click();await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click();await ops.getByLabel('办理意见',{exact:true}).fill('保留审计副本，禁止新增下载')
  async function approve(){const r=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'));await ops.getByRole('button',{name:'批准',exact:true}).click();return r}
  allowed=false;assert.equal((await approve()).status(),403);allowed=true;version='2';assert.equal((await approve()).status(),409);assert.equal(commands.length,0)
  version='1';assert.equal((await approve()).status(),200);await expect.poll(()=>commands.length).toBe(1)
  assert.equal(commands[0].action,'withdraw_skill');assert.equal(commands[0].account,'chen.yu')
  const approved=await(await page.request.get(base+'internal/v1/approved-inputs/'+commands[0].executionId,{headers:{authorization:'Bearer skill-withdrawal'}})).json()
  assert.equal(approved.fields['文件处置'],'保留审计副本并禁止下载');assert.equal(approved.preconditions[0].revision,1)
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await page.getByRole('button',{name:'刷新发布申请',exact:true}).click();await page.getByRole('button',{name:new RegExp(row.ticketNo+'.*待结果确认')}).click();await page.getByLabel('办理意见',{exact:true}).fill('确认下架结果');await page.getByRole('button',{name:'确认结果',exact:true}).click();await page.getByRole('button',{name:new RegExp(row.ticketNo+'.*已完成')}).waitFor()
  assert.ok(reads.some(path=>path.includes('kind=skill') && path.includes('action=withdraw_skill') && path.includes('cursor=page2')))
  console.log('PASS Edge: Skill下架分页与资格过滤、统计读取、草稿重选、提交/审批撤权和版本变化拒绝、审批下发与结果确认',row.ticketNo)
}finally{await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
