import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {body,json,listen} from '../../../../../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'dataset-changes-browser-'))
process.env.APP_DATA_DIR=dir
process.env.INTERNAL_TOKEN='browser-test'
let server,browser,capability,base
const commands=[],states=new Map(),paused=new Set()
try {
  capability=await listen(async(req,res,path)=>{
    const query=new URL(req.url,'http://localhost').searchParams
    if(path.includes('/execution-contexts/KB-04'))return json(res,{snapshotId:'review',ticketType:'KB-04',action:'review_dataset_changes',resourceId:'kb',
      fields:{'变更事件ID':query.get('sourceEventId'),'所有者账户名':'chen.yu','来源系统':'Dify','源知识库ID':'source','workspace/tenant ID':'ws',
        '知识库名称':'测试知识库','上次快照ID':'old','当前快照ID':'current','文档清单快照ID':'manifest','原目录状态':paused.has(query.get('sourceEventId'))?'暂停分享':'已发布',
        '处置证据事件ID':'proof-'+query.get('sourceEventId'),'人工处置证据事件ID':'manual-proof-'+query.get('sourceEventId'),'新增文档数':0,'变更文档数':1,'删除文档数':0,
        '变更明细':[{documentId:'doc',name:'变化文档',changeType:'修改',sha256:'a'.repeat(64),autoVerdict:query.get('sourceEventId')==='negative'?'不通过':'通过'}]},
      preconditions:[{kind:'dataset',id:'kb',revision:1},{kind:'dataset_manifest',id:'manifest',sha256:'b'.repeat(64)}]})
    if(path.includes('/execution-contexts/KB-05'))return json(res,{snapshotId:'disposition',ticketType:'KB-05',action:query.get('action'),resourceId:'kb',eligible:true,fields:{
      '知识库名称':'知识库','源workspace/tenant ID':'ws','来源系统':'Dify','源知识库ID':'source','文档清单快照ID':'manifest','清单完整':true,'文档清单':[{documentId:'doc',sha256:'a'.repeat(64)}],
      '影响中的授权数':1,'影响中的智能体数':1,'处置目标清单':[{system:'平台',objectId:'kb',action:'暂停分享'},{system:'Dify',objectId:'doc',documentId:'doc',action:'停用文档'}],
      '告警ID':query.get('sourceEventId'),'告警证据':[{evidenceId:'proof',sha256:'c'.repeat(64)}]},
      preconditions:[{kind:'dataset',id:'kb',revision:1},{kind:'dataset_manifest',id:'manifest',sha256:'b'.repeat(64)}]})
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req);commands.push(command)
      const approved=await(await fetch(base+'internal/v1/approved-inputs/'+command.executionId,{headers:{authorization:'Bearer browser-test'}})).json()
      if(command.action==='pause_share')paused.add(approved.fields['告警ID'].replace(/^proof-/,''))
      const state=mockExecution(command,{status:'succeeded',result:{resultId:'updated',details:{values:{'新目录状态':command.action==='review_dataset_changes' && approved.fields['新目录状态']==='保持发布'?'暂停分享':approved.fields['新目录状态'] ?? '暂停分享'}}}})
      states.set(command.executionId,state);return json(res,state)
    }
    const state=states.get(path.split('/').at(-1))
    return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  base=server.resolvedUrls.local[0]
  browser=await chromium.launch({channel:'msedge',headless:true})
  async function login(role) {
    const page=await browser.newPage();await page.goto(base)
    await page.getByRole('button',{name:new RegExp('^'+role)}).click()
    await page.locator('.app-shell').waitFor();return page
  }
  const user=await login('用户'),ops=await login('运维人员'),admin=await login('系统管理员')
  async function transition(page,button,expected=200) {
    const response=page.waitForResponse(r=>r.url().endsWith('/api/applications/transition'))
    await page.getByRole('button',{name:button,exact:true}).click()
    const r=await response;assert.equal(r.status(),expected)
  }
  for(const event of ['positive','negative']) {
    const response=await fetch(base+'internal/v1/dataset-changes',{method:'POST',headers:{authorization:'Bearer browser-test','content-type':'application/json'},
      body:JSON.stringify({sourceEventId:event,resourceId:'kb'})})
    assert.equal(response.status,201)
    const row=await response.json()
    // Allow the separate persistent linkage request to settle before reading the owner's revision.
    if(event==='negative')await new Promise(resolve=>setTimeout(resolve,200))
    await user.getByRole('button',{name:'我的申请',exact:true}).click()
    await user.getByRole('button',{name:'刷新发布申请',exact:true}).click()
    await user.getByRole('button',{name:new RegExp(row.ticketNo+'.*待所有者提交')}).click()
    await user.getByLabel('变更原因',{exact:true}).fill('更新业务材料')
    await transition(user,'提交变更审查')
    await admin.getByRole('button',{name:'工单查询',exact:true}).click()
    await admin.getByRole('button',{name:'刷新发布申请',exact:true}).click()
    await admin.getByRole('button',{name:new RegExp(row.ticketNo)}).click()
    assert.equal(await admin.getByRole('button',{name:'确认审查',exact:true}).count(),0)
    await ops.getByRole('button',{name:/^我的待办/}).click()
    await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click()
    await ops.getByRole('button',{name:new RegExp(row.ticketNo+'.*待受理')}).click()
    await ops.getByLabel('办理意见',{exact:true}).fill('核对正文指纹和审查结论')
    await transition(ops,'确认审查',400)
    await ops.getByLabel('文档复核 doc',{exact:true}).selectOption(event==='positive'?'通过':'不通过')
    await ops.getByLabel('运维确认结论',{exact:true}).selectOption(event==='positive'?'通过':'不通过')
    await transition(ops,'确认审查')
    if(event==='positive') {
      const deadline=Date.now()+6000
      let blocked
      while(Date.now()<deadline) {
        const response=await ops.request.get(base+'api/applications?view=query')
        blocked=(await response.json()).items.find(v=>v.ticketNo===row.ticketNo)
        if(blocked?.deliveryBlocked)break
        await new Promise(resolve=>setTimeout(resolve,50))
      }
      assert.equal(blocked.deliveryBlocked,true)
      await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click()
      await ops.getByRole('button',{name:new RegExp(row.ticketNo+'.*执行中')}).click()
      await ops.getByLabel('办理意见',{exact:true}).fill('原执行结果仍与批准目录状态不符')
      await transition(ops,'查证原执行')
      await ops.getByText(/执行结果需要查证/).waitFor()
      await admin.getByRole('button',{name:'刷新发布申请',exact:true}).click()
      await admin.getByRole('button',{name:new RegExp(row.ticketNo)}).click()
      assert.equal(await admin.getByRole('button',{name:'查证原执行',exact:true}).count(),0)
      const original=states.get(blocked.command.executionId)
      states.set(blocked.command.executionId,{...original,result:{...original.result,details:{values:{'新目录状态':'保持发布'}}}})
      await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click()
      await ops.getByRole('button',{name:new RegExp(row.ticketNo+'.*执行中')}).click()
      await ops.getByLabel('办理意见',{exact:true}).fill('按原执行重新读取已核验结果')
      await transition(ops,'查证原执行')
    }
    await user.getByRole('button',{name:'刷新发布申请',exact:true}).click()
    await user.getByRole('button',{name:new RegExp(row.ticketNo+'.*待结果确认')}).click()
    if(event==='negative')await user.getByText(/关联处置工单 · KB-05-alert-/).waitFor()
    await user.getByLabel('办理意见',{exact:true}).fill('核对目录处理结果')
    await transition(user,'确认结果')
    await user.getByRole('button',{name:new RegExp(row.ticketNo+'.*已完成')}).waitFor()
  }
  assert.equal(commands.filter(c=>c.action==='review_dataset_changes').length,2)
  assert.equal(commands.filter(c=>c.action==='pause_share').length,1)
  console.log('模拟能力服务的 KB-04 提交/复核、原执行查证及管理员只读、拒绝与KB-05关联浏览器流程通过')
}finally{
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
