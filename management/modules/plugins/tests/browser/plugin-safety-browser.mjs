import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {startManagement} from '../../../../app/server/service.mjs'
import {body,json,listen} from '../../../../../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'plugin-safety-browser-'))
let server,browser,capability,api
let clock=Date.now(),revision=1,state='已启用',cycle='cycle-1',verdict='数据不足',complete=false
const commands=[],executions=new Map()
try {
  capability=await listen(async(req,res,path)=>{
    const query=new URL(req.url,'http://localhost').searchParams
    if(path.includes('/execution-contexts/PLG-04')) {
      const event=query.get('sourceEventId') ?? 'observation-failure'
      const end=new Date(clock).toISOString()
      const fields={'workspace ID':'ws','插件名称':'测试插件','版本号':'1','安装实例ID':'instance','禁用周期ID':cycle,
        '定向操作能力':'verified','实例状态':state,'告警ID':event,'触发规则':'失败率','统计数据完整':true,
        '统计窗口':{start:new Date(clock-300000).toISOString(),end,calls:20,failures:6,timeouts:0},
        '证据日志':[{at:end,level:'ERROR',pluginId:'plugin',message:'测试调用失败'}]}
      if(query.get('phase')==='observe')Object.assign(fields,{'观察执行ID':query.get('observationExecutionId'),
        '观察区间开始':query.get('observeFrom'),'观察覆盖截止':end,'观察结论':verdict,'观察数据完整':complete,
        '观察违规事件ID':'observation-failure'})
      return json(res,{snapshotId:'safety-'+revision,ticketType:'PLG-04',action:query.get('action'),resourceId:'plugin',fields,
        preconditions:[{kind:'plugin_installation',id:'instance',revision}]})
    }
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req);commands.push(command)
      const approved=await(await fetch(api.url+'/internal/v1/approved-inputs/'+command.executionId,{headers:{authorization:'Bearer test'}})).json()
      assert.equal(approved.fields['安装实例ID'],'instance')
      state=command.action==='disable_plugin'?'已禁用':'已启用';revision++
      const value=mockExecution(command,{status:'succeeded',result:{resultId:'verified',details:{values:{'安装实例ID':'instance','插件状态':state}}}})
      executions.set(command.executionId,value);return json(res,value)
    }
    const value=executions.get(path.split('/').at(-1))
    return value?json(res,value):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  api=await startManagement({dir,token:'test',executor:capability.url,now:()=>clock})
  // The controllable clock belongs only to this isolated API fixture; no test clock route exists in the app.
  server=await createServer({configFile:false,cacheDir:join(dir,'vite-cache'),plugins:[react()],server:{port:0,host:'127.0.0.1',proxy:{
    '/api':{target:api.url,changeOrigin:false},'/internal':{target:api.url,changeOrigin:false}}}})
  await server.listen()
  const base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  async function login(role) {
    console.log('开始登录',role)
    const page=await browser.newPage();await page.goto(base)
    page.on('pageerror',error=>console.log('页面错误',error.message))
    const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-session') && r.request().method()==='POST')
    await page.getByRole('button',{name:new RegExp('^'+role)}).click()
    const loginResponse=await response;assert.equal(loginResponse.status(),200)
    console.log('登录响应',role,loginResponse.status())
    await page.locator('.app-shell').waitFor();return page
  }
  const ops=await login('运维人员'),admin=await login('系统管理员'),user=await login('用户')
  console.log('身份页面已打开，创建告警')
  const alert=await fetch(api.url+'/internal/v1/plugin-alerts',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},
    body:JSON.stringify({sourceEventId:'browser-failure',resourceId:'plugin',workspaceId:'ws'})})
  assert.equal(alert.status,201)
  const row=await alert.json()
  async function waitStatus(status) {
    const until=Date.now()+6000
    while(Date.now()<until) {
      const r=await ops.request.get(api.url+'/api/applications?view=query')
      const item=(await r.json()).items.find(v=>v.ticketNo===row.ticketNo)
      if(item?.status===status)return item
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    assert.fail('未进入 '+status)
  }
  await waitStatus('已禁用待确认')
  await admin.getByRole('button',{name:'工单查询',exact:true}).click()
  await admin.getByRole('button',{name:new RegExp(row.ticketNo)}).click()
  assert.equal(await admin.getByRole('button',{name:'申请恢复',exact:true}).count(),0)
  await user.getByRole('button',{name:'我的申请',exact:true}).click()
  assert.equal(await user.getByRole('button',{name:new RegExp(row.ticketNo)}).count(),0)
  async function restore(attachment) {
    console.log('开始恢复申请',attachment?'含附件':'无附件')
    await ops.getByRole('button',{name:/^我的待办/}).click()
    await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click()
    await ops.getByRole('button',{name:new RegExp(row.ticketNo+'.*已禁用待确认')}).click()
    await ops.getByLabel('恢复申请原因',{exact:true}).fill('故障已定位，申请恢复')
    await ops.getByLabel('修复说明',{exact:true}).fill('修复超时处理并验证插件实例')
    await ops.getByLabel('恢复观察时长（分钟）',{exact:true}).fill('5')
    if(attachment) {
      const uploaded=ops.waitForResponse(r=>r.url().endsWith('/api/evidence'))
      await ops.getByLabel('修复附件',{exact:true}).setInputFiles({name:'repair.txt',mimeType:'text/plain',buffer:Buffer.from('repair-proof')})
      assert.equal((await uploaded).status(),201)
    }
    let response=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'))
    await ops.getByRole('button',{name:'申请恢复',exact:true}).click()
    assert.equal((await response).status(),200)
    await ops.getByRole('button',{name:new RegExp(row.ticketNo+'.*待恢复审核')}).click()
    await ops.getByLabel('办理意见',{exact:true}).fill('核对修复说明后批准恢复并观察')
    response=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'))
    await ops.getByRole('button',{name:'批准恢复',exact:true}).click()
    assert.equal((await response).status(),200)
    await waitStatus('观察中')
    console.log('恢复成功，进入观察')
    await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click()
    await ops.getByRole('button',{name:new RegExp(row.ticketNo+'.*观察中')}).click()
    await ops.getByText(/恢复观察 · /).waitFor()
  }
  await restore(true)
  clock+=300001;cycle='cycle-2';verdict='失败';complete=true
  await waitStatus('已禁用待确认')
  const disabled=await waitStatus('已禁用待确认')
  assert.equal(disabled.nodeIndex,3)
  assert.deepEqual(commands.map(c=>c.action),['disable_plugin','restore_plugin','disable_plugin'])
  verdict='数据不足';complete=false
  await restore(false)
  clock+=300001
  await new Promise(resolve=>setTimeout(resolve,2200))
  await waitStatus('观察中')
  verdict='通过';complete=true
  await waitStatus('已恢复')
  await ops.getByRole('button',{name:'工单查询',exact:true}).click()
  await ops.getByRole('button',{name:new RegExp(row.ticketNo+'.*已恢复')}).click()
  assert.equal(await ops.getByRole('button',{name:'申请恢复',exact:true}).count(),0)
  assert.deepEqual(commands.map(c=>c.action),['disable_plugin','restore_plugin','disable_plugin','restore_plugin'])
  console.log('模拟能力服务的 PLG-04 禁用、附件恢复审核、观察失败再禁用及完整恢复页面流程通过')
}finally{
  await browser?.close();await server?.close();await api?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
