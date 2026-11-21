import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {body,json,listen} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'

const dir=await mkdtemp(join(tmpdir(),'account-recovery-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='recovery-browser'
let server,browser,capability,base,restored=false,unknown=false
const commands=[],executions=new Map(),baselines=new Map()
try {
  capability=await listen(async(req,res,path)=>{
    if(path.includes('/execution-contexts/ACC-02')) {
      const q=new URL(req.url,'http://localhost').searchParams,subjectId=q.get('resourceId')
      const p=await(await fetch(base+'internal/v1/subjects/'+subjectId,{headers:{authorization:'Bearer recovery-browser'}})).json()
      const baseline={ragflow:{accountId:'rag-'+subjectId,account:p.account,active:true,permission:p.ragflowPermission},
        dify:{accountId:'dify-'+subjectId,account:p.account,workspaceId:'ws',active:true,role:p.difyRole}}
      baselines.set(subjectId,baseline)
      return json(res,{snapshotId:'recovery-context',ticketType:'ACC-02',action:'rename_account',resourceId:subjectId,recoveryBaseline:baseline,
        fields:{'目标人员ID':subjectId,'当前账户名':p.account,'RAGFlow账户ID':baseline.ragflow.accountId,'Dify账户ID':baseline.dify.accountId,
          'Dify workspace ID':'ws','当前RAGFlow权限':p.ragflowPermission,'当前Dify workspace角色':p.difyRole,
          '待校验新账户名':q.get('newAccount'),'RAGFlow唯一性校验':'通过','Dify唯一性校验':'通过'},
        preconditions:[{kind:'product_account_mapping',id:subjectId,revision:1}]})
    }
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req);commands.push(command)
      const state=mockExecution(command,{status:unknown?'succeeded':'failed',
        result:{retryable:false,...unknown?{}:{failureCode:'PARTIAL_ACCOUNT_CHANGE'},details:{values:{'最终一致性':'需人工修复'}}}})
      executions.set(command.executionId,state);return json(res,state)
    }
    if(path.endsWith('/account-consistency')) {
      const executionId=path.split('/').at(-2),command=commands.find(c=>c.executionId===executionId)
      return json(res,{proofId:'proof-'+executionId,executionId,ticketNo:command.ticketNo,subjectId:command.resourceId,
        identityRevision:1,productMappingRevision:1,executionStatus:'failed',sealed:restored,outcome:restored?'restored':'unknown',
        checkedAt:new Date().toISOString(),products:baselines.get(command.resourceId)})
    }
    const state=executions.get(path.split('/').at(-1))
    return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000);await page.goto(base)
  await page.getByRole('button',{name:/^系统管理员/}).click();await page.locator('.app-shell').waitFor()
  await page.getByRole('button',{name:'手工申请',exact:true}).click()
  await page.getByRole('button',{name:/ACC-02/}).click()
  await page.getByLabel('目标人员',{exact:true}).selectOption('person-chen-yu')
  await page.getByLabel('新账户名',{exact:true}).fill('chen.restored')
  await page.getByLabel('账号生效时间',{exact:true}).fill('2026-11-17T12:00')
  await page.getByLabel('账号申请依据',{exact:true}).fill('核验部分失败后的安全解锁')
  let response=page.waitForResponse(r=>r.url().endsWith('/api/account-applications') && r.request().method()==='POST')
  await page.getByRole('button',{name:'提交账号审批',exact:true}).click()
  const submitted=await response;assert.equal(submitted.status(),201);const first=await submitted.json()
  await page.getByRole('button',{name:/^我的待办/}).click()
  const desk=page.locator('section').filter({has:page.getByRole('heading',{name:'管理员账号工单',exact:true})})
  async function refresh(no,status) {
    await desk.getByRole('button',{name:'刷新账号工单',exact:true}).click()
    await desk.getByRole('button',{name:new RegExp(no+'.*'+status)}).click()
  }
  async function act(action,status=200) {
    await desk.getByLabel('账号办理意见',{exact:true}).fill('按原执行核对真实产品事实')
    const result=page.waitForResponse(r=>r.url().endsWith('/api/account-applications/transition'))
    await desk.getByRole('button',{name:action,exact:true}).click()
    assert.equal((await result).status(),status)
  }
  async function until(no,predicate) {
    const end=Date.now()+6500
    while(Date.now()<end) {
      const r=await page.request.get(base+'api/account-applications?view=query')
      const row=(await r.json()).items.find(v=>v.ticketNo===no)
      if(predicate(row))return row
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    assert.fail('账号状态未到达预期')
  }
  await refresh(first.ticketNo,'待受理');await act('批准')
  const failed=await until(first.ticketNo,r=>r.status==='执行失败')
  await refresh(first.ticketNo,'执行失败')
  await act('核验恢复并解锁',409)
  await desk.getByText('RESTORATION_NOT_VERIFIED',{exact:true}).waitFor()
  restored=true;await refresh(first.ticketNo,'执行失败');await act('核验恢复并解锁')
  const resolved=await until(first.ticketNo,r=>r.status==='已终止')
  assert.deepEqual(resolved.execution,failed.execution);assert.ok(resolved.recovery.sealed)
  await page.getByRole('button',{name:'工单查询',exact:true}).click()
  await refresh(first.ticketNo,'已终止')
  await desk.locator('details.technical-details > summary').first().click()
  assert.ok((await desk.innerText()).includes('恢复核验证明'))
  assert.equal(await desk.getByRole('button',{name:'重试执行',exact:true}).count(),0)
  unknown=true
  const no='ACC-02-browser-unknown-'+Date.now()
  assert.equal((await page.request.post(base+'api/account-applications',{data:{ticketNo:no,ticketType:'ACC-02',subjectId:'person-chen-yu',
    fields:{newAccount:'chen.pending',effectiveAt:'2026-11-17T12:00:00Z',reason:'未知结果沿用原执行查证'}}})).status(),201)
  await refresh(no,'待受理');await act('批准')
  const blocked=await until(no,r=>r.deliveryBlocked)
  executions.set(blocked.command.executionId,mockExecution(blocked.command,{status:'reconciling'}))
  await refresh(no,'执行中');await act('查证原执行')
  const queried=await until(no,r=>r.execution?.status==='reconciling')
  assert.equal(queried.deliveryBlocked,false);assert.equal(commands.length,2)
  console.log('PASS Edge: ACC恢复证明拒绝/安全解锁/保留失败审计/原执行查询，执行下发总数2')
}finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
