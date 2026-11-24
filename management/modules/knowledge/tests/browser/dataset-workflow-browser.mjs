import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from '@playwright/test'
import {createServer} from 'vite'
import {body,json,listen} from '../../../../../runtime/http.mjs'
import {DEFAULT_USER_PASSWORD} from '../../../../platform/identity/public.server.mjs'
const dir=await mkdtemp(join(tmpdir(),'dataset-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability
const commands=[]
try {
  capability=await listen(async(req,res,path)=>{
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'ws',name:'知识库工作区'}],nextCursor:null})
    if(path==='/internal/v1/resources')return json(res,{items:[{resourceId:'dataset',name:'源知识库',source:'dify',workspaceId:'ws'}],nextCursor:null})
    if(path==='/internal/v1/resources/dify_dataset/dataset')return json(res,{snapshotId:'dataset-resource',resourceId:'dataset',workspaceId:'ws',capturedAt:new Date().toISOString(),data:{ownerAccount:'chen.yu'}})
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'context',capturedAt:new Date().toISOString(),ticketType:'KB-02',action:'publish_dataset',resourceId:'dataset',
      fields:{'来源系统':'Dify','所有者账户名':'chen.yu','workspace/tenant ID':'ws','文档数':1,'文档清单快照ID':'manifest','模型目录核对结果':'一致',
        '文档审查明细':[{documentId:'doc-1',sha256:'a'.repeat(64),autoVerdict:'通过'}]},
      preconditions:[{kind:'dataset_manifest',id:'manifest',sha256:'a'.repeat(64)}]})
    if(req.method==='GET')return json(res,{error:{code:'NOT_FOUND'}},404)
    commands.push(await body(req))
    return json(res,mockExecution(commands.at(-1),{status:'succeeded',result:{resultId:'shared-dataset'}}))
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  async function login(account) {
    const page=await browser.newPage()
    page.setDefaultTimeout(15000)
    await page.goto(server.resolvedUrls.local[0]+'login')
    await page.getByPlaceholder('例如 chen.yu 或 chen.yu@kpw.com').fill(account)
    await page.locator('input[name="password"]').fill(DEFAULT_USER_PASSWORD)
    await page.getByRole('button',{name:'登录'}).click()
    await page.locator('.app-shell').waitFor()
    return page
  }
  const user=await login('chen.yu')
  await user.getByRole('button',{name:'手工申请',exact:true}).click()
  await user.getByRole('button',{name:/KB-02.*知识库分享申请/}).click()
  await user.getByText('申请部门',{exact:true}).waitFor()
  await user.getByRole('option',{name:'源知识库',exact:true}).waitFor({state:'attached'})
  await user.getByLabel('知识库名称',{exact:true}).selectOption('dataset')
  await user.getByRole('button',{name:'读取文档审查与模型核对',exact:true}).waitFor()
  await user.getByRole('button',{name:'读取文档审查与模型核对',exact:true}).click()
  for(const [label,value] of [['申请说明','知识共享'],['组织边界（逗号分隔）','业务一部'],['业务线','业务'],['目录展示名称','共享测试库'],['目录简介','测试说明'],['目录标签（逗号分隔）','测试']]) {
    await user.getByLabel(label,{exact:true}).fill(value)
  }
  const submitted=user.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST')
  await user.getByRole('button',{name:'提交申请',exact:true}).click()
  const row=await(await submitted).json()
  assert.equal(row.status,'待受理')
  const ops=await login('zhou.min')
  await ops.getByRole('button',{name:/^我的待办/}).click()
  await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click()
  await ops.getByLabel('办理意见',{exact:true}).fill('逐项安全复核')
  await ops.getByRole('button',{name:'批准',exact:true}).click()
  await ops.getByRole('alert').filter({hasText:'请按相同正文指纹逐项确认文档'}).waitFor()
  assert.equal(commands.length,0)
  await ops.getByRole('checkbox',{name:/doc-1/}).check()
  await ops.getByRole('button',{name:'批准',exact:true}).click()
  await user.getByRole('button',{name:'我的申请',exact:true}).click()
  await user.getByRole('button',{name:'刷新发布申请',exact:true}).click()
  await user.getByRole('button',{name:new RegExp(row.ticketNo+'.*待结果确认')}).click()
  await user.getByLabel('办理意见',{exact:true}).fill('确认共享结果')
  await user.getByRole('button',{name:'确认结果',exact:true}).click()
  await user.getByRole('button',{name:new RegExp(row.ticketNo+'.*已完成')}).waitFor()
  assert.equal(commands.length,1)
  assert.equal(commands[0].action,'publish_dataset')
  console.log('模拟能力服务的知识库分享与逐文档复核通过',row.ticketNo)
} finally {
  await browser?.close()
  await server?.close()
  await capability?.close()
  await rm(dir,{recursive:true,force:true})
}
