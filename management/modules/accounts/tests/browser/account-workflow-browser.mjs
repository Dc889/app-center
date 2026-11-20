import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {body,json,listen} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'account-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='account-browser'
let server,browser,capability,base,productRevision=1
const commands=[],executions=new Map()
try {
  capability=await listen(async(req,res,path)=>{
    if(path.includes('/execution-contexts/ACC-')) {
      const query=new URL(req.url,'http://localhost').searchParams,type=path.split('/').at(-1),subjectId=query.get('resourceId')
      const p=await(await fetch(base+'internal/v1/subjects/'+subjectId,{headers:{authorization:'Bearer account-browser'}})).json()
      return json(res,{snapshotId:'account-context',ticketType:type,action:type==='ACC-01'?'apply_account_change':'rename_account',resourceId:subjectId,
        fields:{'目标人员ID':subjectId,'当前账户名':p.account,'RAGFlow账户ID':'rag-'+subjectId,'Dify账户ID':'dify-'+subjectId,
          '当前RAGFlow权限':p.ragflowPermission,'当前Dify workspace角色':p.difyRole,
          'Dify workspace ID':query.get('workspaceId') ?? p.workspaceId ?? 'ws','待校验新账户名':query.get('newAccount'),
          'RAGFlow唯一性校验':'通过','Dify唯一性校验':'通过'},preconditions:[{kind:'product_account_mapping',id:subjectId,revision:productRevision}]})
    }
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req);commands.push(command)
      const approved=await(await fetch(base+'internal/v1/approved-inputs/'+command.executionId,{headers:{authorization:'Bearer account-browser'}})).json()
      const commit=await fetch(base+'internal/v1/account-changes/'+command.executionId+'/commit',{method:'PUT',headers:{authorization:'Bearer account-browser','content-type':'application/json'},
        body:JSON.stringify({subjectId:command.resourceId,ragflowAccountId:'rag-'+command.resourceId,difyAccountId:'dify-'+command.resourceId,workspaceId:approved.fields['Dify workspace ID']})})
      assert.equal(commit.status,200,await commit.clone().text());productRevision++
      const state=mockExecution(command,{status:'succeeded',result:{resultId:'consistent',details:{values:{'最终一致性':'一致','RAGFlow执行结果':'成功','Dify执行结果':'成功','本平台执行结果':'成功'}}}})
      executions.set(command.executionId,state);return json(res,state)
    }
    const value=executions.get(path.split('/').at(-1))
    return value?json(res,value):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  async function login(role,account) {
    const page=await browser.newPage();await page.goto(base)
    if(account)await page.getByLabel('演示登录账户（留空使用所选身份）',{exact:true}).fill(account)
    await page.getByRole('button',{name:new RegExp('^'+role)}).click()
    await page.locator('.app-shell').waitFor();return page
  }
  const admin=await login('系统管理员'),user=await login('用户')
  assert.equal((await user.request.post(base+'api/events',{data:{ticketNo:'EVT-01-browser-before-org',resourceId:'plugin',objectType:'插件',facts:'调岗前的审计事实'}})).status(),201)
  await user.getByRole('button',{name:'手工申请',exact:true}).click()
  assert.equal(await user.getByRole('button',{name:/ACC-01/}).count(),0)
  const desk=admin.locator('section').filter({has:admin.getByRole('heading',{name:'管理员账号工单',exact:true})})
  async function waitStatus(no,status) {
    const deadline=Date.now()+6000
    while(Date.now()<deadline) {
      const r=await admin.request.get(base+'api/account-applications?view=query')
      const row=(await r.json()).items.find(v=>v.ticketNo===no)
      if(row?.status===status)return row
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    assert.fail('账号工单未进入 '+status)
  }
  for(const type of ['ACC-01','ACC-02']) {
    await admin.getByRole('button',{name:'手工申请',exact:true}).click()
    await admin.getByRole('button',{name:new RegExp(type)}).click()
    await admin.getByLabel('目标人员',{exact:true}).selectOption('person-chen-yu')
    if(type==='ACC-01') {
      await admin.getByLabel('账号操作类型',{exact:true}).selectOption('组织变更')
      await admin.getByLabel('目标组织',{exact:true}).selectOption('平台运营组')
      await admin.getByLabel('目标业务线',{exact:true}).selectOption('平台运营')
    }else await admin.getByLabel('新账户名',{exact:true}).fill('chen.mobile')
    await admin.getByLabel('账号生效时间',{exact:true}).fill('2026-11-17T12:00')
    await admin.getByLabel('账号申请依据',{exact:true}).fill('浏览器验证组织调整与账户改名')
    const submission=admin.waitForResponse(r=>r.url().endsWith('/api/account-applications') && r.request().method()==='POST')
    await admin.getByRole('button',{name:'提交账号审批',exact:true}).click()
    const submitted=await submission;assert.equal(submitted.status(),201)
    const row=await submitted.json()
    assert.equal(commands.length,type==='ACC-01'?0:1)
    await admin.getByRole('button',{name:/^我的待办/}).click()
    await desk.getByRole('button',{name:'刷新账号工单',exact:true}).click()
    await desk.getByRole('button',{name:new RegExp(row.ticketNo+'.*待受理')}).click()
    await desk.getByLabel('账号办理意见',{exact:true}).fill('核对三方预检与目标人员')
    let response=admin.waitForResponse(r=>r.url().endsWith('/api/account-applications/transition'))
    await desk.getByRole('button',{name:'批准',exact:true}).click()
    assert.equal((await response).status(),200)
    const completed=await waitStatus(row.ticketNo,'待结果确认')
    assert.ok(completed.localCommit)
    await desk.getByRole('button',{name:'刷新账号工单',exact:true}).click()
    await desk.getByRole('button',{name:new RegExp(row.ticketNo+'.*待结果确认')}).click()
    await desk.getByLabel('账号办理意见',{exact:true}).fill('三方结果与本地提交一致')
    response=admin.waitForResponse(r=>r.url().endsWith('/api/account-applications/transition'))
    await desk.getByRole('button',{name:'确认结果',exact:true}).click()
    assert.equal((await response).status(),200)
    await waitStatus(row.ticketNo,'已完成')
    assert.equal((await user.request.get(base+'api/drafts')).status(),403)
  }
  const oldLogin=await fetch(base+'api/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'chen.yu'})})
  assert.equal(oldLogin.status,403)
  const renamed=await login('用户','chen.mobile')
  assert.equal((await renamed.request.get(base+'api/drafts')).status(),200)
  assert.equal((await renamed.request.get(base+'api/account-applications?view=query')).status(),403)
  assert.equal((await renamed.request.post(base+'api/events',{data:{ticketNo:'EVT-01-browser-after-name',resourceId:'plugin',objectType:'插件',facts:'改名后的审计事实'}})).status(),201)
  await admin.getByRole('button',{name:'审计追踪',exact:true}).click()
  await admin.getByLabel('搜索审计记录',{exact:true}).fill('person-chen-yu')
  const before=admin.getByRole('row').filter({hasText:'EVT-01-browser-before-org'})
  const after=admin.getByRole('row').filter({hasText:'EVT-01-browser-after-name'})
  await before.waitFor();await after.waitFor()
  assert.ok((await before.innerText()).includes('业务一部'))
  assert.ok((await after.innerText()).includes('平台运营组'))
  assert.ok((await after.innerText()).includes('chen.mobile'))
  const download=admin.waitForEvent('download')
  await admin.getByRole('button',{name:'导出当前筛选',exact:true}).click()
  const exported=await download
  const entries=JSON.parse(await readFile(await exported.path(),'utf8'))
  assert.equal(entries.find(e=>e.reference==='EVT-01-browser-before-org').org,'业务一部')
  assert.equal(entries.find(e=>e.reference==='EVT-01-browser-after-name').actorRevision,3)
  assert.ok(entries.every(e=>e.actorSubjectId==='person-chen-yu'))
  assert.deepEqual(commands.map(c=>c.action),['apply_account_change','rename_account'])
  console.log('模拟能力服务的 ACC组织/改名流程及历史组织审计页面、人员ID筛选和导出通过')
}finally{
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
