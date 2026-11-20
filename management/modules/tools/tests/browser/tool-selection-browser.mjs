import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'tool-selection-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability,allowed=true,approvalRevision=1,posts=0
const reads=[],commands=[],states=new Map(),secret='TOOL-PRIVATE-CREDENTIAL'
try {
  capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push(req.url)
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'ws',name:'业务工作区'}],nextCursor:null})
    if(path.endsWith('/candidates'))return json(res,{items:q.has('cursor')?[{resourceId:'canonical-tool',name:'检索工具',source:'dify_tool',workspaceId:q.get('workspaceId') || 'retired-ws',secret}]:[],nextCursor:q.has('cursor')?null:'page2'})
    if(path.includes('/execution-contexts/')) {
      const operation=q.get('operation')
      return json(res,{snapshotId:'tool-context',ticketType:'TOL-01',action:'set_tool_approval',operation,eligible:allowed,resourceId:'canonical-tool',
        fields:{'Dify workspace ID':q.get('workspaceId'),'Dify工具ID':'native-tool','Dify工具提供者ID':'provider','工具名称':'检索工具','工具提供者名称':'提供者','配置来源':operation==='撤销批准'?'批准登记':'产品现状',
          '工具版本':'2','工具配置指纹':'a'.repeat(64),'输入参数schema':{type:'object'},'输出说明':'检索结果',secret,
          ...operation==='首次批准'?{}:{'原批准工单号':'TOL-01-old','原工具版本':'1','原工具配置指纹':'b'.repeat(64),'配置差异':[{差异项:'版本',原值摘要:'1',新值摘要:'2'}]}},
        preconditions:[{kind:'tool_configuration',id:'canonical-tool',sha256:'a'.repeat(64)},{kind:'tool_approval',id:'canonical-tool',revision:operation==='首次批准'?0:approvalRevision}]})
    }
    if(path.endsWith('/executions') && req.method==='POST') {const c=await body(req);commands.push(c);const state=mockExecution(c,{status:'succeeded',result:{resultId:'approved-tool'}});states.set(c.executionId,state);return json(res,state)}
    const state=states.get(path.split('/').at(-1));return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true});const base=server.resolvedUrls.local[0]
  async function login(role){const p=await browser.newPage();p.setDefaultTimeout(10000);await p.goto(base);await p.getByRole('button',{name:new RegExp('^'+role)}).click();return p}
  const page=await login('用户'),ops=await login('运维人员')
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  async function open(){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:/^TOL-01\b/}).click()}
  async function select(operation){
    if(operation!=='撤销批准'){await page.getByRole('button',{name:'读取可用工作区',exact:true}).click();await page.getByRole('option',{name:'业务工作区 · ws',exact:true}).waitFor({state:'attached'});await page.getByLabel('工作区 ID',{exact:true}).selectOption('ws')}
    await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:'检索工具 · canonical-tool',exact:true}).waitFor({state:'attached'});await page.getByLabel('工具候选 ID',{exact:true}).selectOption('canonical-tool');await expect(page.getByLabel('Dify工具ID',{exact:true})).toHaveValue('native-tool')
  }
  async function fill(){for(const [label,value] of [['功能说明','检索'],['业务用途','业务查询'],['权限需求（逗号分隔）','读取'],['目标组织（逗号分隔）','业务一部'],['业务线','业务']])await page.getByLabel(label,{exact:true}).fill(value)}
  async function submit(){const response=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name:'提交工具审批',exact:true}).click();try{return await response}catch(error){console.log(await page.getByRole('group',{name:'工具对外使用审批',exact:true}).innerText());throw error}}
  async function approve(row){await ops.getByRole('button',{name:/^我的待办/}).click();await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click();await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click();await ops.getByLabel('办理意见',{exact:true}).fill('核验配置和申请范围');await ops.getByLabel('安全审查意见',{exact:true}).fill('确认安全');await ops.getByRole('combobox',{name:'对外使用权限',exact:true}).selectOption('允许');const response=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'));await ops.getByRole('button',{name:'批准',exact:true}).click();return response}
  await open();await select('首次批准');await fill()
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor()
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open();await page.getByRole('button',{name:/恢复草稿 · canonical-tool/}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  await page.getByRole('button',{name:'提交工具审批',exact:true}).click();assert.equal(posts,0);await expect(page.getByLabel('Dify工具ID',{exact:true})).toHaveCount(0)
  await select('首次批准');allowed=false;assert.equal((await submit()).status(),403);allowed=true
  const first=await submit();assert.equal(first.status(),201,await first.text());assert.equal((await approve(await first.json())).status(),200)
  for(const operation of ['变更再审','撤销批准']) {
    await open();await page.getByRole('button',{name:'新建申请草稿',exact:true}).click();await page.getByLabel('操作类型',{exact:true}).selectOption(operation);await expect(page.getByLabel('工具候选 ID',{exact:true})).toHaveValue('');await expect(page.getByLabel('Dify工具ID',{exact:true})).toHaveCount(0)
    const start=reads.length;await select(operation);await fill()
    if(operation==='撤销批准'){await expect(page.getByLabel('来源工作区',{exact:true})).toHaveValue('retired-ws');assert.ok(!reads.slice(start).some(url=>url.includes('/workspaces')));await expect(page.getByLabel('配置来源',{exact:true})).toHaveValue('批准登记')}
    else await expect(page.getByLabel('配置差异',{exact:true})).toHaveValue(/原值摘要/)
    const response=await submit();assert.equal(response.status(),201,await response.text());const row=await response.json()
    approvalRevision=2;assert.equal((await approve(row)).status(),409);approvalRevision=1;assert.equal((await approve(row)).status(),200)
  }
  await expect.poll(()=>commands.length).toBe(3);assert.ok(commands.every(c=>c.action==='set_tool_approval' && c.resourceId==='canonical-tool' && c.payload.decisionRef))
  const rows=await(await page.request.get(base+'api/applications?view=mine')).json();assert.ok(!JSON.stringify(rows).includes(secret));assert.ok(!(await page.content()).includes(secret))
  const tools=rows.items.filter(row=>row.ticketType==='TOL-01');assert.equal(tools.length,3);assert.ok(tools.every(row=>row.preconditions.length===2 && row.approvedFields['Dify工具ID']==='native-tool'))
  assert.ok(reads.some(url=>url.includes('/candidates?') && url.includes('cursor=page2')))
  console.log('PASS Edge: TOL-01候选分页/原生ID预览、草稿重选/撤权、三分支审批、登记修订竞态、失效工作区撤销与凭证裁剪')
}finally{await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
