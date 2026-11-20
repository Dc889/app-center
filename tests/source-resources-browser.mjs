import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json,body} from '../runtime/http.mjs'
import {mockExecution} from './support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'source-resources-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='source-resources'
let server,browser,capability,failure='',owner='chen.yu',serial=0
const commands=[],reads=[],states=new Map()
try {
  capability=await listen(async(req,res,path)=>{
    const query=new URL(req.url,'http://localhost').searchParams
    reads.push(req.url)
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'ws1',name:'一区'},{workspaceId:'ws2',name:'二区'}],nextCursor:null})
    if(path==='/internal/v1/resources') {
      const kind=query.get('kind'),last=query.has('cursor')
      return json(res,{items:[{resourceId:last?'last':'first',name:last?'末页资源':'首页资源',source:kind,workspaceId:kind==='ragflow_dataset'?null:query.get('workspaceId')}],nextCursor:last?null:'page2'})
    }
    if(path.startsWith('/internal/v1/resources/')) {
      const kind=path.split('/')[4],isRag=kind==='ragflow_dataset'
      return json(res,{resourceId:failure==='object'?'another':'last',workspaceId:isRag?null:failure==='workspace'?'other':query.get('workspaceId'),
        snapshotId:'snapshot-'+(++serial),capturedAt:new Date().toISOString(),data:{ownerAccount:owner,webSiteEnabled:false,
          ...isRag && failure!=='tenant'?{tenantId:'tenant-from-server'}:{}}})
    }
    if(path.endsWith('/executions') && req.method==='POST') {
      const command=await body(req);commands.push(command)
      const state=mockExecution(command,{status:'succeeded',result:{resultId:command.resourceId}});states.set(command.executionId,state)
      return json(res,state)
    }
    const state=states.get(path.split('/').at(-1));return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  const base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000)
  await page.goto(base);await page.getByRole('button',{name:/^用户/}).click()
  async function open(type){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:new RegExp('^'+type+'\\b')}).click()}
  async function workspace(label,id){await page.getByRole('button',{name:'读取可用工作区',exact:true}).click();await page.getByRole('option',{name:'二区 · ws2',exact:true}).waitFor({state:'attached'});await page.getByLabel(label,{exact:true}).selectOption(id)}
  async function select(label){await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:'末页资源 · last',exact:true}).waitFor({state:'attached'});await page.getByLabel(label,{exact:true}).selectOption('last')}
  async function snapshot(){await expect(page.getByText(/^快照 · snapshot-/)).toBeVisible()}
  async function submit(name){const pending=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name,exact:true}).click();return pending}
  await open('AG-01');await workspace('工作区 ID','ws1');await select('Dify应用 ID');await snapshot()
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click()
  await page.getByText('申请草稿已保存',{exact:true}).waitFor()
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open('AG-01')
  await page.getByRole('button',{name:/恢复草稿 · last/}).click()
  await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'提交本人纳管同步',exact:true}).count(),0)
  await workspace('工作区 ID','ws1');await select('Dify应用 ID');await snapshot()
  await page.getByLabel('工作区 ID',{exact:true}).selectOption('ws2')
  assert.equal(await page.getByRole('button',{name:'提交本人纳管同步',exact:true}).count(),0)
  failure='workspace';await select('Dify应用 ID')
  await page.getByText('资源快照与所选对象或范围不匹配，请重新读取',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'提交本人纳管同步',exact:true}).count(),0)
  failure='object';await select('Dify应用 ID')
  await page.getByText('资源快照与所选对象或范围不匹配，请重新读取',{exact:true}).waitFor()
  failure='';await select('Dify应用 ID');await snapshot()
  const browserSnapshot='snapshot-'+serial
  owner='other'
  assert.equal((await submit('提交本人纳管同步')).status(),403)
  await page.getByText('仅可纳管本人应用',{exact:true}).waitFor();assert.equal(commands.length,0)
  owner='chen.yu'
  const accepted=await submit('提交本人纳管同步');assert.equal(accepted.status(),201,await accepted.text())
  const application=await accepted.json()
  await expect.poll(()=>commands.length).toBe(1)
  const approved=await(await page.request.get(base+'internal/v1/approved-inputs/'+application.command.executionId,{headers:{authorization:'Bearer source-resources'}})).json()
  assert.equal(approved.fields.snapshotId,'snapshot-'+serial);assert.notEqual(approved.fields.snapshotId,browserSnapshot)
  assert.equal(approved.fields.workspaceId,'ws2')
  await open('KB-01');await workspace('workspace ID','ws1');await select('知识库');await snapshot()
  await expect(page.getByRole('button',{name:'提交知识库同步',exact:true})).toBeEnabled()
  await page.getByLabel('来源系统',{exact:true}).selectOption('RAGFlow')
  await expect(page.getByRole('button',{name:'提交知识库同步',exact:true})).toBeDisabled()
  await expect(page.getByLabel('tenant ID',{exact:true})).toHaveValue('')
  failure='tenant';await select('知识库')
  await page.getByText('资源快照与所选对象或范围不匹配，请重新读取',{exact:true}).waitFor()
  await expect(page.getByRole('button',{name:'提交知识库同步',exact:true})).toBeDisabled()
  failure='';await select('知识库');await snapshot()
  await expect(page.getByLabel('tenant ID',{exact:true})).toHaveValue('tenant-from-server')
  await expect(page.getByLabel('tenant ID',{exact:true})).not.toBeEditable()
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click()
  await page.getByText('申请草稿已保存',{exact:true}).waitFor()
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open('KB-01')
  await page.getByRole('button',{name:/恢复草稿 · last/}).click()
  await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  await expect(page.getByRole('button',{name:'提交知识库同步',exact:true})).toBeDisabled()
  await select('知识库');await snapshot()
  const synced=await submit('提交知识库同步');assert.equal(synced.status(),201,await synced.text())
  const row=await synced.json()
  await expect.poll(()=>commands.length).toBe(2)
  const frozen=await(await page.request.get(base+'internal/v1/approved-inputs/'+row.command.executionId,{headers:{authorization:'Bearer source-resources'}})).json()
  assert.equal(frozen.fields['所属workspace/tenant ID'],'tenant-from-server')
  assert.equal(frozen.fields['来源系统'],'RAGFlow')
  assert.ok(reads.some(path=>path.includes('kind=dify_app') && path.includes('cursor=page2')))
  assert.ok(reads.some(path=>path.includes('kind=dify_dataset') && path.includes('cursor=page2')))
  assert.ok(reads.some(path=>path.includes('kind=ragflow_dataset') && path.includes('cursor=page2')))
  assert.ok(reads.filter(path=>path.includes('kind=ragflow_dataset')).every(path=>!path.includes('workspaceId=')))
  console.log('PASS Edge: AG/KB完整分页、切区/切源清空、快照对象范围校验、恢复重选、所有者变化拒绝、后端重读及RAG租户可信冻结')
}finally {await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
