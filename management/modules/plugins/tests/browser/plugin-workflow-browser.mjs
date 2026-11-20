import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {body,json,listen} from '../../../../../runtime/http.mjs'

const dir=await mkdtemp(join(tmpdir(),'plugin-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability,allowed=true,revision=1,posts=0
const commands=[]
const reads=[],secret='PLUGIN-PRIVATE-CREDENTIAL'
const executions=new Map()
try {
  capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push(req.url)
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'ws',name:'业务工作区'}],nextCursor:null})
    if(path.endsWith('/candidates'))return json(res,{items:q.has('cursor')?[{resourceId:'plugin',name:'插件',workspaceId:q.get('workspaceId') || 'retired-ws',source:'plugin',installationId:q.get('operation')==='安装'?null:'instance',secret},...q.get('operation')==='安装'?[]:[{resourceId:'plugin',name:'插件',workspaceId:q.get('workspaceId') || 'retired-ws',source:'plugin',installationId:'instance-other',secret}]]:[],nextCursor:q.has('cursor')?null:'page2'})
    if(path==='/internal/v1/capabilities')return json(res,{items:['install','upgrade','uninstall'].map(action=>({
      ticketType:'PLG-03',ticketTypeVersion:'1',action,variant:null,state:'verified'}))})
    if(path.includes('/catalog/plugin/'))return json(res,{resourceId:'plugin',name:'插件',status:'approved',
      data:{version:'2',sha256:'a'.repeat(64),installAccess:allowed?'instant':'denied',secret}})
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'plugin-context',ticketType:'PLG-03',
      action:q.get('action'),resourceId:'plugin',eligible:allowed,
      fields:{'目标Dify workspace ID':q.get('workspaceId'),'插件名称':'插件','原安装版本号':q.get('action')==='uninstall'?'2':'1','原安装指纹':(q.get('action')==='uninstall'?'a':'b').repeat(64),'批准版本号':'2','版本指纹':'a'.repeat(64),'安装实例ID':q.get('installationId'),secret,
        '权限匹配结果':'需审批','升级策略':'逐个工单升级'},
      preconditions:[{kind:'plugin_installation',id:q.get('installationId'),revision},...q.get('action')==='upgrade'?[{kind:'plugin',id:'plugin',sha256:'a'.repeat(64)}]:[]]})
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req)
      commands.push(command)
      const state=mockExecution(command,{status:'succeeded',result:{resultId:'instance'}})
      executions.set(command.executionId,state)
      return json(res,state)
    }
    return executions.has(path.split('/').at(-1))?json(res,executions.get(path.split('/').at(-1))):
      json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  async function login(role) {
    const page=await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    await page.getByRole('button',{name:new RegExp('^'+role)}).click()
    await page.locator('.app-shell').waitFor()
    return page
  }
  const user=await login('用户'),ops=await login('运维人员'),admin=await login('系统管理员')
  user.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  await admin.getByRole('button',{name:'工单类型',exact:true}).click()
  await admin.getByLabel('类型编码',{exact:true}).fill('PLG-03')
  await admin.getByLabel('目标工作区（留空核验通用范围）',{exact:true}).fill('')
  await admin.getByLabel('升级流程',{exact:true}).selectOption('approval')
  await admin.getByLabel('卸载流程',{exact:true}).selectOption('approval')
  const draft=admin.waitForResponse(r=>r.url().endsWith('/api/types/draft'))
  await admin.getByRole('button',{name:'保存草稿',exact:true}).click()
  assert.equal((await draft).status(),200)
  const publication=admin.waitForResponse(r=>r.url().endsWith('/api/types/publish'))
  await admin.getByRole('button',{name:'发布版本',exact:true}).click()
  assert.equal((await publication).status(),200)
  for(const operation of ['安装','升级','卸载']) {
    await user.getByRole('button',{name:'手工申请',exact:true}).click()
    await user.getByRole('button',{name:/PLG-03.*插件/}).click()
    await user.getByLabel('操作类型',{exact:true}).selectOption(operation)
    const readStart=reads.length
    async function select(){
      if(operation!=='卸载'){await user.getByRole('button',{name:'读取可用工作区',exact:true}).click();await user.getByRole('option',{name:'业务工作区 · ws',exact:true}).waitFor({state:'attached'});await user.getByLabel('目标Dify workspace ID',{exact:true}).selectOption('ws')}
      await user.getByRole('button',{name:'读取插件操作候选',exact:true}).click()
      const option=operation==='安装'?'插件 · plugin · ws':'插件 · plugin · '+(operation==='卸载'?'retired-ws · instance-other':'ws · instance')
      await user.getByRole('option',{name:option,exact:true}).waitFor({state:'attached'});await user.getByLabel('插件操作对象',{exact:true}).selectOption({label:option});await expect(user.getByLabel('批准版本号',{exact:true})).toHaveValue('2')
    }
    await select()
    if(operation==='卸载'){assert.ok(!reads.slice(readStart).some(url=>url.includes('/workspaces') || url.includes('/catalog/plugin/')));await expect(user.getByLabel('目标Dify workspace ID',{exact:true})).toHaveValue('retired-ws')}
    await user.getByLabel('使用目的',{exact:true}).fill('浏览器验收')
    if(operation==='安装'){
      await user.getByRole('button',{name:'保存申请草稿',exact:true}).click();await user.getByText('申请草稿已保存',{exact:true}).waitFor()
      await user.getByRole('button',{name:'我的申请',exact:true}).click();await user.getByRole('button',{name:'手工申请',exact:true}).click();await user.getByRole('button',{name:/PLG-03.*插件/}).click()
      await user.getByRole('button',{name:/恢复草稿 · plugin/}).click();await user.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
      await user.getByRole('button',{name:'提交插件操作',exact:true}).click();assert.equal(posts,0);await expect(user.getByLabel('批准版本号',{exact:true})).toHaveCount(0);await select()
      allowed=false;const rejected=user.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await user.getByRole('button',{name:'提交插件操作',exact:true}).click();assert.equal((await rejected).status(),403);allowed=true
    }
    const contextResponse=user.waitForResponse(r=>r.url().includes('/api/plugin-operation-context?'))
    await user.getByRole('button',{name:'读取操作依据',exact:true}).click()
    assert.equal((await contextResponse).status(),200)
    const response=user.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST')
    await user.getByRole('button',{name:'提交插件操作',exact:true}).click()
    const submitted=await response
    assert.equal(submitted.status(),201,await submitted.text())
    const row=await submitted.json()
    if(operation!=='安装') {
      assert.equal(commands.some(c=>c.ticketNo===row.ticketNo),false)
      await ops.getByRole('button',{name:/^我的待办/}).click()
      await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click()
      await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click()
      await ops.getByLabel('办理意见',{exact:true}).fill('核验安装实例和版本')
      revision=2;const stale=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'));await ops.getByRole('button',{name:'批准',exact:true}).click();assert.equal((await stale).status(),409);revision=1
      const approval=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'))
      await ops.getByRole('button',{name:'批准',exact:true}).click()
      assert.equal((await approval).status(),200)
    }
    await user.getByRole('button',{name:'我的申请',exact:true}).click()
    await user.getByRole('button',{name:'刷新发布申请',exact:true}).click()
    const target=operation==='安装'?'已完成':'待结果确认'
    await user.getByRole('button',{name:new RegExp(row.ticketNo+'.*'+target)}).click()
    if(operation!=='安装') {
      await user.getByLabel('办理意见',{exact:true}).fill('核对操作结果')
      await user.getByRole('button',{name:'确认结果',exact:true}).click()
      await user.getByRole('button',{name:new RegExp(row.ticketNo+'.*已完成')}).waitFor()
    }
  }
  assert.deepEqual(commands.map(c=>c.action),['install','upgrade','uninstall'])
  assert.ok(commands.every(c=>c.account==='chen.yu'))
  assert.equal(commands[0].payload.workspaceId,'ws')
  assert.ok(commands.slice(1).every(c=>typeof c.payload.decisionRef==='string'))
  const rows=await(await user.request.get(server.resolvedUrls.local[0]+'api/applications?view=mine')).json();assert.ok(!JSON.stringify(rows).includes(secret));assert.equal(rows.items.find(row=>row.submission.fields.operation==='卸载').approvedFields['安装实例ID'],'instance-other')
  assert.ok(reads.some(url=>url.includes('/candidates?') && url.includes('cursor=page2')))
  console.log('PASS Edge: PLG-03三操作候选分页/实例选择、草稿重选、撤权/修订拦截、旧工作区卸载、脱敏及审批回写闭环')
}finally{
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
