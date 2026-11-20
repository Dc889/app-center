import {mockExecution} from './support/execution-state.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {body,json,listen} from '../runtime/http.mjs'

const dir=await mkdtemp(join(tmpdir(),'publish-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability
const commands=[]
const executions=new Map()
try {
  capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/catalog') {
      const cursor=new URL(req.url,'http://localhost').searchParams.get('cursor')
      return json(res,{items:[{resourceId:cursor?'second':'first',name:cursor?'第二页技能':'第一页技能',status:'approved',actions:['download'],data:{version:'1'}}],nextCursor:cursor?null:'page-2'})
    }
    if(path==='/internal/v1/workspaces')return json(res,{items:[{workspaceId:'ws-1',name:'本人工作区'}],nextCursor:null})
    if(path==='/internal/v1/resources')return json(res,{items:[{resourceId:'app-1',name:'测试应用',source:'dify',workspaceId:'ws-1'}]})
    if(path==='/internal/v1/resources/dify_app/app-1')return json(res,{
      snapshotId:'snapshot-1',resourceId:'app-1',workspaceId:'ws-1',capturedAt:new Date().toISOString(),
      data:{publicationVersionId:'pub-1',catalogRevision:0,dependencies:[]}})
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req)
      commands.push(command)
      const state=mockExecution(command,{status:'succeeded',result:{resultId:'agent-1'}})
      executions.set(command.executionId,state)
      return json(res,state)
    }
    const state=executions.get(path.split('/').at(-1))
    return state ? json(res,state) : json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  async function login(role) {
    const page=await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    await page.getByRole('button',{name:new RegExp('^'+role)}).click()
    await page.locator('.app-shell').waitFor()
    return page
  }
  const user=await login('用户')
  await user.getByRole('button',{name:'Skill仓库',exact:true}).click()
  await user.locator('.agent-card').filter({hasText:'第一页技能'}).waitFor()
  await user.getByRole('button',{name:'加载更多目录',exact:true}).click()
  await user.locator('.agent-card').filter({hasText:'第二页技能'}).waitFor()
  assert.equal(await user.locator('[data-testid="catalog-warehouse"] .agent-card').count(),2)
  await user.getByRole('button',{name:'手工申请',exact:true}).click()
  await user.getByRole('button',{name:/AG-02.*智能体发布/}).click()
  await user.getByRole('button',{name:'读取可用工作区',exact:true}).click()
  await user.getByRole('option',{name:'本人工作区 · ws-1',exact:true}).waitFor({state:'attached'})
  await user.getByLabel('工作区 ID',{exact:true}).selectOption('ws-1')
  await user.getByRole('button',{name:'读取可选资源',exact:true}).click()
  await user.getByRole('option',{name:'测试应用 · app-1',exact:true}).waitFor({state:'attached'})
  await user.getByLabel('Dify应用 ID',{exact:true}).selectOption('app-1')
  await user.getByLabel('业务场景',{exact:true}).fill('业务发布验收')
  await user.getByLabel('使用说明',{exact:true}).fill('运行测试应用')
  await user.getByLabel('业务线',{exact:true}).fill('业务')
  await user.getByLabel('组织边界（逗号分隔）',{exact:true}).fill('业务一部')
  await user.getByLabel('嵌入网站',{exact:true}).uncheck()
  await user.getByLabel('访问 API',{exact:true}).check()
  const response=user.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST')
  await user.getByRole('button',{name:'提交发布审批',exact:true}).click()
  const row=await(await response).json()
  assert.equal(row.status,'待受理')
  assert.equal(commands.length,0)
  const admin=await login('系统管理员')
  await admin.getByRole('button',{name:'工单查询',exact:true}).click()
  await admin.getByRole('button',{name:new RegExp(row.ticketNo)}).click()
  assert.equal(await admin.getByRole('button',{name:'批准',exact:true}).count(),0)
  const ops=await login('运维人员')
  await ops.getByRole('button',{name:/^我的待办/}).click()
  await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click()
  await ops.getByLabel('办理意见',{exact:true}).fill('审批依据已核验')
  await ops.getByRole('button',{name:'批准',exact:true}).click()
  await user.getByRole('button',{name:'我的申请',exact:true}).click()
  await user.getByRole('button',{name:'刷新发布申请',exact:true}).click()
  await user.getByRole('button',{name:new RegExp(row.ticketNo+'.*待结果确认')}).click()
  await user.getByLabel('办理意见',{exact:true}).fill('确认发布结果')
  await user.getByRole('button',{name:'确认结果',exact:true}).click()
  await user.getByRole('button',{name:new RegExp(row.ticketNo+'.*已完成')}).waitFor()
  assert.equal(commands.length,1)
  assert.equal(commands[0].account,'chen.yu')
  assert.deepEqual(commands[0].payload.usages,['run','api'])
  assert.equal(commands[0].payload.snapshotId,'snapshot-1')
  console.log('模拟能力服务的 AG-02 浏览器审批闭环通过',row.ticketNo)
} finally {
  await browser?.close()
  await server?.close()
  await capability?.close()
  await rm(dir,{recursive:true,force:true})
}
