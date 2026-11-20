import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'mcp-disposition-browser-'))
process.env.APP_DATA_DIR=dir;process.env.INTERNAL_TOKEN='mcp-disposition'
let server,browser,capability,allowed=true,complete=true,changed=false,posts=0
const reads=[],commands=[],states=new Map()
const source=[{account:'chen.yu',workspaceId:'ws1',providerId:'PRIVATE-provider-a'},{account:'other',workspaceId:'ws2',providerId:'PRIVATE-provider-b'}]
try {
  capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams,action=q.get('action');reads.push(req.url)
    const status=action==='unbind_mcp'?'withdrawn':action==='withdraw_mcp'?'isolated':'active'
    if(path==='/internal/v1/catalog')return json(res,{items:q.has('cursor')?[{resourceId:'mcp',name:'可处置MCP',status,actions:[action],data:{transport:'http',toolNames:[]}}]:[{resourceId:'bind-only',name:'仅可绑定MCP',status:'active',actions:['bind'],data:{}}],nextCursor:q.has('cursor')?null:'page2'})
    if(path.includes('/catalog/mcp/'))return json(res,{resourceId:'mcp',status,actions:allowed?[action]:['bind']})
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'disposition',ticketType:'MCP-03',action,resourceId:'mcp',fields:{'绑定清单快照ID':'manifest','绑定清单完整':complete,'绑定清单':source.map(b=>changed?{...b,providerId:b.providerId+'-changed'}:b)},preconditions:[{kind:'mcp',id:'mcp',revision:1}]})
    if(path.endsWith('/executions') && req.method==='POST'){const c=await body(req);commands.push(c);const state=mockExecution(c,{status:'succeeded',result:{resultId:'disposed'}});states.set(c.executionId,state);return json(res,state)}
    const state=states.get(path.split('/').at(-1));return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const base=server.resolvedUrls.local[0]
  async function login(role){const p=await browser.newPage();p.setDefaultTimeout(10000);await p.goto(base);await p.getByRole('button',{name:new RegExp('^'+role)}).click();return p}
  const page=await login('用户'),ops=await login('运维人员')
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  async function open(){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:/^MCP-03\b/}).click()}
  async function select(){await page.getByRole('button',{name:'读取可选资源',exact:true}).click();await page.getByRole('option',{name:'可处置MCP · mcp',exact:true}).waitFor({state:'attached'});assert.equal(await page.getByRole('option',{name:/仅可绑定MCP/}).count(),0);await page.getByLabel('MCP目录 ID',{exact:true}).selectOption('mcp')}
  async function ready(){await expect(page.getByText('处置依据 · disposition · 2组账户/工作区',{exact:true})).toBeVisible()}
  async function submit(){const p=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name:'提交MCP处置审批',exact:true}).click();return p}
  async function approve(row){await ops.getByRole('button',{name:/^我的待办/}).click();await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click();await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click();await ops.getByLabel('办理意见',{exact:true}).fill('核对处置对象和影响范围');const p=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'));await ops.getByRole('button',{name:'批准',exact:true}).click();return p}
  await open();await select();await ready();assert.ok(!(await page.content()).includes('PRIVATE-provider'))
  await page.getByLabel('目标绑定',{exact:true}).selectOption(JSON.stringify(['chen.yu','ws1']))
  await expect(page.getByLabel('目标账户名',{exact:true})).toHaveValue('chen.yu');await expect(page.getByLabel('目标workspace ID',{exact:true})).toHaveValue('ws1');await expect(page.getByLabel('目标账户名',{exact:true})).not.toBeEditable()
  await page.getByRole('textbox',{name:'事实说明',exact:true}).fill('结束使用')
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor()
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open();await page.getByRole('button',{name:/恢复草稿 · mcp/}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  await page.getByRole('button',{name:'提交MCP处置审批',exact:true}).click();assert.equal(posts,0)
  await select();await ready();await page.getByLabel('目标绑定',{exact:true}).selectOption(JSON.stringify(['chen.yu','ws1']))
  allowed=false;assert.equal((await submit()).status(),403);assert.equal(commands.length,0)
  allowed=true;const first=await submit();assert.equal(first.status(),201,await first.text());const unbind=await first.json()
  allowed=false;assert.equal((await approve(unbind)).status(),403);allowed=true;changed=true;assert.equal((await approve(unbind)).status(),409);assert.equal(commands.length,0)
  changed=false;assert.equal((await approve(unbind)).status(),200);await expect.poll(()=>commands.length).toBe(1)
  const frozen=await(await page.request.get(base+'internal/v1/approved-inputs/'+commands[0].executionId,{headers:{authorization:'Bearer mcp-disposition'}})).json()
  assert.deepEqual(frozen.fields['绑定清单'],[source[0]]);assert.equal(frozen.fields['目标workspace ID'],'ws1')
  for(const [operation,action,count] of [['目录隔离','isolate_mcp',2],['目录下架','withdraw_mcp',3]]) {
    await page.getByRole('button',{name:'新建申请草稿',exact:true}).click();await page.getByLabel('处置类型',{exact:true}).selectOption(operation)
    assert.equal(await page.getByLabel('目标绑定',{exact:true}).count(),0)
    if(operation==='目录隔离'){complete=false;await select();await page.getByText('INCOMPLETE_MCP_BINDINGS',{exact:true}).waitFor();assert.equal(await page.getByText(/^处置依据 ·/).count(),0)}
    complete=true;await select();await ready();await page.getByRole('textbox',{name:'事实说明',exact:true}).fill('完整目录处置')
    const response=await submit();assert.equal(response.status(),201,await response.text());const row=await response.json();assert.equal((await approve(row)).status(),200);await expect.poll(()=>commands.length).toBe(count)
    const approved=await(await page.request.get(base+'internal/v1/approved-inputs/'+commands.at(-1).executionId,{headers:{authorization:'Bearer mcp-disposition'}})).json()
    assert.equal(approved.fields['绑定清单'].length,2);assert.equal(approved.fields['目标账户名'],null);assert.equal(commands.at(-1).action,action)
  }
  assert.ok(reads.some(url=>url.includes('action=unbind_mcp') && url.includes('cursor=page2')))
  console.log('PASS Edge: MCP三动作分页、精确绑定选择、草稿重选、完整范围门禁、撤权/绑定变化拒绝及三类审批下发')
}finally{await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
