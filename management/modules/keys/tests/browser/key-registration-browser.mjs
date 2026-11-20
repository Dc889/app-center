import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'key-registration-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability,allowed=true,revision=2,posts=0,reveals=0
const hidden='PROVIDER-SECRET-NOT-LISTED',oneTime='ONE-TIME-ROTATED-SECRET',commands=[],reads=[],states=new Map()
const row=()=>({registrationId:'key-reg',appId:'app',workspaceId:'ws',keyId:'product-key',appName:'登记应用',lastFour:'abcd',status:'active',revision,actions:allowed?['rotate_key','revoke_key']:[],secret:hidden})
try {
  capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push(req.url)
    if(path==='/internal/v1/key-registrations') {
      if(q.get('q')==='repeat')return json(res,{items:[row()],nextCursor:'same'})
      return json(res,{items:q.has('cursor')?[row()]:[{...row(),registrationId:'revoked',status:'revoked'}],nextCursor:q.has('cursor')?null:'page2',secret:hidden})
    }
    if(path==='/internal/v1/key-registrations/key-reg')return json(res,row())
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'key-context',ticketType:'KEY-02',action:q.get('action'),resourceId:'key-reg',fields:{'Dify应用ID':'app','Dify密钥ID':'product-key','密钥后四位':'abcd',secret:hidden},preconditions:[{kind:'key_registration',id:'key-reg',revision}]})
    if(path.endsWith('/reveal')){reveals++;return json(res,{secret:oneTime})}
    if(path.endsWith('/executions') && req.method==='POST') {
      const c=await body(req);commands.push(c)
      const state=mockExecution(c,{status:'succeeded',result:{resultId:'updated',details:{registrationId:'new-reg','新Dify密钥ID':'new-product-key','新密钥后四位':'5678','旧密钥撤销结果':'成功',secret:hidden}}});states.set(c.executionId,state);return json(res,state)
    }
    const state=states.get(path.split('/').at(-1));return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true});const base=server.resolvedUrls.local[0]
  async function login(role){const p=await browser.newPage();p.setDefaultTimeout(10000);await p.goto(base);await p.getByRole('button',{name:new RegExp('^'+role)}).click();return p}
  const page=await login('用户'),ops=await login('运维人员')
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  async function open(){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:/^KEY-02\b/}).click()}
  async function select(){await page.getByRole('button',{name:'读取可操作密钥登记',exact:true}).click();await page.getByRole('option',{name:'登记应用 · key-reg · 后四位 abcd',exact:true}).waitFor({state:'attached'});assert.equal(await page.getByRole('option',{name:/· revoked ·/}).count(),0);await page.getByLabel('密钥登记 ID',{exact:true}).selectOption('key-reg');await expect(page.getByLabel('Dify密钥ID',{exact:true})).toHaveValue('product-key')}
  async function submit(){const p=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name:'提交密钥审批',exact:true}).click();return p}
  async function approve(r){await ops.getByRole('button',{name:/^我的待办/}).click();await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click();await ops.getByRole('button',{name:new RegExp(r.ticketNo)}).click();await ops.getByLabel('办理意见',{exact:true}).fill('核对原登记与生效时间');const p=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'));await ops.getByRole('button',{name:'批准',exact:true}).click();return p}
  async function result(r){await page.getByRole('button',{name:'我的申请',exact:true}).click();await page.getByRole('button',{name:'刷新发布申请',exact:true}).click();await page.getByRole('button',{name:new RegExp(r.ticketNo+'.*待结果确认')}).click()}
  async function confirm(r){await page.getByLabel('办理意见',{exact:true}).fill('确认密钥操作结果');await page.getByRole('button',{name:'确认结果',exact:true}).click();await page.getByRole('button',{name:new RegExp(r.ticketNo+'.*已完成')}).waitFor()}
  await open()
  await page.getByLabel('登记搜索',{exact:true}).fill('repeat');await page.getByRole('button',{name:'读取可操作密钥登记',exact:true}).click();await page.getByText('目录分页异常，请重新读取',{exact:true}).waitFor();assert.equal(await page.getByRole('option',{name:/key-reg/}).count(),0)
  await page.getByLabel('登记搜索',{exact:true}).fill('');await select()
  assert.ok(!(await page.content()).includes(hidden));await expect(page.getByLabel('密钥后四位',{exact:true})).toHaveValue('abcd')
  await page.getByRole('textbox',{name:'操作原因',exact:true}).fill('撤销旧调用身份');await page.getByLabel('生效时间',{exact:true}).fill('2026-01-01T00:00')
  await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor()
  await page.getByRole('button',{name:'我的申请',exact:true}).click();await open();await page.getByRole('button',{name:/恢复草稿 · key-reg/}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
  await page.getByRole('button',{name:'提交密钥审批',exact:true}).click();assert.equal(posts,0)
  await select();allowed=false;assert.equal((await submit()).status(),403);assert.equal(commands.length,0)
  allowed=true;const first=await submit();assert.equal(first.status(),201,await first.text());const revoke=await first.json()
  allowed=false;assert.equal((await approve(revoke)).status(),403);allowed=true;revision=3;assert.equal((await approve(revoke)).status(),409);assert.equal(commands.length,0)
  revision=2;assert.equal((await approve(revoke)).status(),200);await expect.poll(()=>commands.length).toBe(1);assert.equal(commands[0].action,'revoke_key');await result(revoke);await confirm(revoke)
  await open();await select();await page.getByLabel('操作类型',{exact:true}).selectOption('轮换')
  await expect(page.getByLabel('密钥登记 ID',{exact:true})).toHaveValue('');assert.equal(await page.getByLabel('Dify密钥ID',{exact:true}).count(),0)
  await select();await page.getByRole('textbox',{name:'操作原因',exact:true}).fill('定期轮换');await page.getByLabel('生效时间',{exact:true}).fill('2026-01-01T00:00');await page.getByLabel('新有效期截止时间',{exact:true}).fill('2030-01-01T00:00')
  const second=await submit();assert.equal(second.status(),201,await second.text());const rotate=await second.json();assert.equal((await approve(rotate)).status(),200);await expect.poll(()=>commands.length).toBe(2);assert.equal(commands[1].action,'rotate_key')
  await result(rotate);await page.getByRole('button',{name:'一次性领取密钥',exact:true}).click();await expect(page.getByLabel('一次性密钥',{exact:true})).toHaveValue(oneTime)
  await page.getByRole('button',{name:'关闭密钥展示',exact:true}).click();await expect(page.getByLabel('一次性密钥',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'一次性领取密钥',exact:true})).toHaveCount(0);await confirm(rotate)
  const rows=await(await page.request.get(base+'api/applications?view=mine')).json();assert.ok(!JSON.stringify(rows).includes(hidden));assert.ok(!JSON.stringify(rows).includes(oneTime));assert.equal(reveals,1)
  assert.ok(reads.some(url=>url.includes('action=revoke_key') && url.includes('cursor=page2')));assert.ok(reads.some(url=>url.includes('action=rotate_key') && url.includes('cursor=page2')))
  console.log('PASS Edge: 密钥登记分页/终态过滤、明文裁剪、恢复/动作切换重选、撤权/修订拒绝、轮换撤销审批与一次性领取')
}finally{await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
