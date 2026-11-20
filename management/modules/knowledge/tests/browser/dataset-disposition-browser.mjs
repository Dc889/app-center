import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {body,json,listen} from '../../../../../runtime/http.mjs'

const dir=await mkdtemp(join(tmpdir(),'dataset-disposition-browser-'))
process.env.APP_DATA_DIR=dir
process.env.INTERNAL_TOKEN='browser-test'
let server,browser,capability,allowed=true,revision=1,complete=true,posts=0
const commands=[],states=new Map()
const secret='NEVER-PERSIST-PRIVATE-DOCUMENT'
try {
  capability=await listen(async(req,res,path)=>{
    if(path.endsWith('/candidates')){const q=new URL(req.url,'http://localhost').searchParams;return json(res,{items:q.has('cursor')?[{resourceId:'kb',name:'知识库',source:'Dify',sourceScopeId:'ws',sourceResourceId:'source',secret}]:[],nextCursor:q.has('cursor')?null:'page2'})}
    if(path.includes('/execution-contexts/KB-05')) {
      const query=new URL(req.url,'http://localhost').searchParams
      return json(res,{snapshotId:'kb-context',ticketType:'KB-05',action:query.get('action'),resourceId:'kb',eligible:allowed,fields:{
        '知识库名称':'知识库','源workspace/tenant ID':'ws','来源系统':'Dify','源知识库ID':'source','文档清单快照ID':'manifest','清单完整':complete,
        '文档清单':[{documentId:'doc',sha256:'a'.repeat(64),body:secret},{documentId:'doc,second',sha256:'c'.repeat(64),body:secret}],'影响中的授权数':1,'影响中的智能体数':1,
        '处置目标清单':['doc','doc,second'].map(documentId=>({system:'Dify',objectId:documentId,documentId,action:'停用文档'})),
        '告警ID':query.get('sourceEventId'),'告警证据':[{evidenceId:'alert-proof',sha256:'c'.repeat(64)}]},
        preconditions:[{kind:'dataset',id:'kb',revision},{kind:'dataset_manifest',id:'manifest',sha256:'b'.repeat(64)}]})
    }
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req)
      commands.push(command)
      const state=mockExecution(command,{status:'succeeded',result:{resultId:'done',details:{values:[{objectId:'doc',result:'succeeded'}]}}})
      states.set(command.executionId,state)
      return json(res,state)
    }
    const state=states.get(path.split('/').at(-1))
    return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const base=server.resolvedUrls.local[0]
  async function login(role) {
    const page=await browser.newPage()
    await page.goto(base)
    await page.getByRole('button',{name:new RegExp('^'+role)}).click()
    await page.locator('.app-shell').waitFor()
    return page
  }
  const user=await login('用户'),ops=await login('运维人员')
  user.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  await user.getByRole('button',{name:'手工申请',exact:true}).click()
  await user.getByRole('button',{name:/KB-05.*知识库/}).click()
  async function select(){await user.getByRole('button',{name:'读取可处置知识库',exact:true}).click();await user.getByRole('option',{name:'知识库 · Dify · kb',exact:true}).waitFor({state:'attached'});await user.getByLabel('目录知识库 ID',{exact:true}).selectOption('kb')}
  complete=false;await select();await user.getByText('INCOMPLETE_DATASET_DISPOSITION',{exact:true}).waitFor();await expect(user.getByLabel('影响中的授权数',{exact:true})).toHaveCount(0);complete=true
  await select();await expect(user.getByLabel('影响中的授权数',{exact:true})).toHaveValue('1');assert.ok(!(await user.content()).includes(secret))
  await user.getByLabel('处置对象',{exact:true}).selectOption('指定文档')
  await user.getByRole('checkbox',{name:'处置文档 doc,second',exact:true}).check()
  await user.getByLabel('处置原因',{exact:true}).selectOption('内容违规')
  await user.getByLabel('事实说明',{exact:true}).fill('文档内容不符合要求')
  const uploaded=user.waitForResponse(r=>r.url().endsWith('/api/evidence'))
  await user.getByLabel('证据附件（每份最多10MB）',{exact:true}).setInputFiles({name:'evidence.txt',mimeType:'text/plain',buffer:Buffer.from('review-proof')})
  assert.equal((await uploaded).status(),201)
  await user.getByRole('button',{name:'保存申请草稿',exact:true}).click();await user.getByText('申请草稿已保存',{exact:true}).waitFor()
  const saved=await(await user.request.get(base+'api/drafts')).json();assert.deepEqual(saved.items.find(row=>row.fields.resourceId==='kb').fields.documentIds,['doc,second'])
  await user.getByRole('button',{name:'我的申请',exact:true}).click();await user.getByRole('button',{name:'手工申请',exact:true}).click();await user.getByRole('button',{name:/KB-05.*知识库/}).click();await user.getByRole('button',{name:/恢复草稿 · kb/}).click();await user.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor();await user.getByRole('link',{name:'evidence.txt',exact:true}).waitFor()
  await user.getByRole('button',{name:'提交知识库处置审批',exact:true}).click();assert.equal(posts,0)
  await select();await user.getByRole('checkbox',{name:'处置文档 doc',exact:true}).check()
  allowed=false;const rejected=user.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await user.getByRole('button',{name:'提交知识库处置审批',exact:true}).click();assert.equal((await rejected).status(),403);allowed=true
  const submission=user.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST')
  await user.getByRole('button',{name:'提交知识库处置审批',exact:true}).click()
  const response=await submission
  assert.equal(response.status(),201,await response.text())
  const manual=await response.json()
  assert.equal(commands.length,0)
  async function approve(ticketNo,status) {
    await ops.getByRole('button',{name:/^我的待办/}).click()
    await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click()
    await ops.getByRole('button',{name:new RegExp(ticketNo+'.*'+status)}).click()
    if(ticketNo===manual.ticketNo)await ops.getByRole('link',{name:'evidence.txt',exact:true}).waitFor()
    await ops.getByRole('checkbox',{name:'停用文档',exact:true}).check()
    await ops.getByLabel('恢复条件',{exact:true}).fill('重新审查通过')
    await ops.getByLabel('办理意见',{exact:true}).fill('核对指定文档与证据')
    if(ticketNo===manual.ticketNo){revision=2;const stale=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'));await ops.getByRole('button',{name:'批准',exact:true}).click();assert.equal((await stale).status(),409);revision=1}
    const approved=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'))
    await ops.getByRole('button',{name:'批准',exact:true}).click()
    assert.equal((await approved).status(),200)
  }
  await approve(manual.ticketNo,'待受理')
  await user.getByRole('button',{name:'我的申请',exact:true}).click()
  await user.getByRole('button',{name:'刷新发布申请',exact:true}).click()
  await user.getByRole('button',{name:new RegExp(manual.ticketNo+'.*待结果确认')}).click()
  await user.getByLabel('办理意见',{exact:true}).fill('已查证文档停用')
  await user.getByRole('button',{name:'确认结果',exact:true}).click()
  await user.getByRole('button',{name:new RegExp(manual.ticketNo+'.*已完成')}).waitFor()
  const alert=await fetch(base+'internal/v1/dataset-alerts',{method:'POST',headers:{authorization:'Bearer browser-test','content-type':'application/json'},
    body:JSON.stringify({sourceEventId:'evt-browser',resourceId:'kb',fields:{target:'指定文档',documentIds:['doc'],reason:'内容违规',facts:'自动审查失败'}})})
  assert.equal(alert.status,201,await alert.clone().text())
  const system=await alert.json()
  // Wait for the separate pause node; browser refreshes are read-only.
  await new Promise(resolve=>setTimeout(resolve,200))
  await approve(system.ticketNo,'待运维确认')
  await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click()
  await ops.getByRole('button',{name:new RegExp(system.ticketNo+'.*待结果确认')}).click()
  await ops.getByLabel('办理意见',{exact:true}).fill('核对自动暂停与文档处置结果')
  await ops.getByRole('button',{name:'确认结果',exact:true}).click()
  assert.deepEqual(commands.map(c=>c.action),['dispose_dataset','pause_share','dispose_dataset'])
  const rows=await(await user.request.get(base+'api/applications?view=mine')).json();assert.ok(!JSON.stringify(rows).includes(secret))
  console.log('PASS Edge: KB-05处置候选分页、完整清单/影响、文档多选与草稿重选、撤权/修订拦截、正文裁剪、人工及告警两节点闭环')
}finally{
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
