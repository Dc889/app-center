import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {body,json,listen} from '../../../../../runtime/http.mjs'
import {mockExecution,mockDownload} from '../../../../../tests/support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'skill-cancel-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='cancel-browser'
let server,browser,capability,base,state,command,cancels=0,posts=0
try {
  capability=await listen(async(req,res,path)=>{
    if(path.endsWith('/catalog'))return json(res,{items:[{resourceId:'skill',name:'测试技能',status:'available',actions:['download'],data:{version:'1',sha256:'a'.repeat(64)}}],nextCursor:null})
    if(path.endsWith('/executions') && req.method==='POST') {
      command=await body(req);posts++
      state=mockDownload(command,'DL-'+command.executionId,{sizeBytes:10})
      return json(res,state)
    }
    if(path.endsWith('/cancel')) {
      cancels++
      const result=await fetch(base+'internal/v1/delivery-checks/'+state.delivery.resultId+'/close',{method:'POST',headers:{authorization:'Bearer cancel-browser'}})
      assert.equal(result.status,200);assert.equal((await result.json()).state,'closed_unserved')
      state=mockExecution(command,{status:'cancelled',result:{failureCode:'CANCELLED_BEFORE_DELIVERY'}})
      return json(res,state)
    }
    return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  },{token:'cancel-browser'})
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  async function login(role) {
    const page=await browser.newPage();page.setDefaultTimeout(10000);await page.goto(base)
    await page.getByRole('button',{name:new RegExp('^'+role)}).click();await page.locator('.app-shell').waitFor();return page
  }
  const user=await login('用户'),ops=await login('运维人员'),admin=await login('系统管理员')
  const no='SKL-03-cancel-browser'
  const response=await user.request.post(base+'api/tickets',{data:{ticketNo:no,ticketType:'SKL-03',action:'download',resourceId:'skill',account:'chen.yu'}})
  assert.equal(response.status(),200)
  await admin.getByRole('button',{name:'工单查询',exact:true}).click()
  assert.equal(await admin.getByRole('heading',{name:'Skill文件执行待办',exact:true}).count(),0)
  const input={executionId:command.executionId,note:'浏览器核对未交付后取消'}
  assert.equal((await user.request.post(base+'api/tickets/'+no+'/cancel',{data:input})).status(),403)
  assert.equal((await admin.request.post(base+'api/tickets/'+no+'/cancel',{data:input})).status(),403)
  await ops.getByRole('button',{name:/^我的待办/}).click()
  const desk=ops.locator('section').filter({has:ops.getByRole('heading',{name:'Skill文件执行待办',exact:true})})
  await desk.getByRole('button',{name:new RegExp(no)}).click()
  await desk.getByLabel('文件办理意见',{exact:true}).fill('按原编号只读查询文件执行')
  const queried=ops.waitForResponse(r=>r.url().endsWith('/api/tickets/'+no+'/reconcile'))
  await desk.getByRole('button',{name:'查证文件原执行',exact:true}).click()
  assert.equal((await queried).status(),200);assert.equal(cancels,0);assert.equal(posts,1)
  await desk.getByRole('button',{name:new RegExp(no)}).click()
  await desk.getByLabel('文件办理意见',{exact:true}).fill(input.note)
  const result=ops.waitForResponse(r=>r.url().endsWith('/api/tickets/'+no+'/cancel'))
  await desk.getByRole('button',{name:'申请取消文件执行',exact:true}).click()
  const cancelled=await result;assert.equal(cancelled.status(),200);assert.equal((await cancelled.json()).status,'cancelled')
  const rows=await ops.request.get(base+'api/tickets?view=query')
  assert.equal((await rows.json()).items.find(r=>r.ticketNo===no).status,'cancelled')
  const file=await user.request.get(base+'api/tickets/'+no+'/file');assert.equal(file.status(),409)
  assert.equal(cancels,1);assert.equal(posts,1)
  console.log('PASS Edge: 运维取消/组件回调关闭/终态确认，用户与管理员禁止办理，零次文件交付')
}finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
