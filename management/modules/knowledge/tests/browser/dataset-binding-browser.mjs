import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
const dir=await mkdtemp(join(tmpdir(),'dataset-binding-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability,allowed=true,revision=1,hash='a'.repeat(64),mismatch=false,posts=0
const commands=[],reads=[],states=new Map(),secret='PRIVATE-DATASET-CREDENTIAL'
const source=id=>({resourceId:id,name:'知识库'+id,workspaceId:'target',source:id==='copy'?'已发布共享':'本人纳管',sourceSystem:id==='rag'?'RAGFlow':'Dify',sourceScopeId:id==='same'?'target':'source',sourceResourceId:'product-'+id,ownerAccount:id==='copy'?'other':'chen.yu',secret})
try {
  capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push(req.url)
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'target',name:'目标工作区'}],nextCursor:null})
    if(path.endsWith('/candidates'))return json(res,{items:q.get('q')==='loop'?[]:q.has('cursor')?[source('same'),source('copy')]:[source('rag')],nextCursor:q.get('q')==='loop'?'repeat':q.has('cursor')?null:'page2'})
    if(path.includes('/execution-contexts/')){
      const row=source(q.get('resourceId'))
      return json(res,{snapshotId:'binding-context',ticketType:'KB-03',action:'bind_dataset',resourceId:row.resourceId,eligible:allowed,
        fields:{'目录来源':row.source,'知识库名称':row.name,'来源系统':row.sourceSystem,'源workspace/tenant ID':row.sourceScopeId,'源知识库ID':mismatch?'wrong':row.sourceResourceId,'源所有者账户名':row.ownerAccount,
          '目标Dify workspace ID':q.get('workspaceId'),'组织边界':['业务一部'],'密级':'内部','业务线':'业务','允许申请权限':['检索使用','编排绑定'],'边界匹配结果':'符合',policyRef:'policy',
          ...row.sourceSystem==='RAGFlow'?{'外部知识库API地址':'https://knowledge.example/external'}:{},
          '实现方式':row.resourceId==='rag'?'RAGFlow外部知识库':row.resourceId==='same'?'Dify同workspace授权':'Dify跨workspace复制','源文档版本指纹':hash,'文档清单快照ID':'manifest',secret},
        preconditions:[{kind:'dataset_catalog',id:row.resourceId,revision},{kind:'dataset_manifest',id:'manifest',sha256:hash}]})
    }
    if(path.endsWith('/executions') && req.method==='POST'){const c=await body(req);commands.push(c);const state=mockExecution(c,{status:'succeeded',result:{resultId:'bound-'+c.resourceId}});states.set(c.executionId,state);return json(res,state)}
    const state=states.get(path.split('/').at(-1));return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true});const base=server.resolvedUrls.local[0]
  async function login(role){const p=await browser.newPage();p.setDefaultTimeout(10000);await p.goto(base);await p.getByRole('button',{name:new RegExp('^'+role)}).click();return p}
  const page=await login('用户'),ops=await login('运维人员')
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/applications'))posts++})
  async function open(){await page.getByRole('button',{name:'手工申请',exact:true}).click();await page.getByRole('button',{name:/^KB-03\b/}).click()}
  async function select(id){await page.getByRole('button',{name:'读取可用工作区',exact:true}).click();await page.getByRole('option',{name:'目标工作区 · target',exact:true}).waitFor({state:'attached'});await page.getByLabel('工作区 ID',{exact:true}).selectOption('target');await page.getByRole('button',{name:'读取可绑定知识库',exact:true}).click();await page.getByRole('option',{name:/知识库copy/}).waitFor({state:'attached'});await page.getByLabel('目录知识库 ID',{exact:true}).selectOption(id)}
  async function context(){await page.getByRole('button',{name:'读取绑定依据',exact:true}).click();await expect(page.getByLabel('源知识库ID',{exact:true})).toHaveValue(/product-/)}
  async function submit(){const response=page.waitForResponse(r=>r.url().endsWith('/api/applications') && r.request().method()==='POST');await page.getByRole('button',{name:'提交使用授权',exact:true}).click();return response}
  async function approve(row){await ops.getByRole('button',{name:/^我的待办/}).click();await ops.getByRole('button',{name:'刷新发布申请',exact:true}).click();await ops.getByRole('button',{name:new RegExp(row.ticketNo)}).click();await ops.getByLabel('办理意见',{exact:true}).fill('核验共享边界与复制版本');const response=ops.waitForResponse(r=>r.url().endsWith('/api/applications/transition'));await ops.getByRole('button',{name:'批准',exact:true}).click();return response}
  for(const id of ['rag','same','copy']){
    await open();await select(id)
    if(id==='rag'){
      await page.getByLabel('知识库搜索',{exact:true}).fill('loop');await page.getByRole('button',{name:'读取可绑定知识库',exact:true}).click();await page.getByText('目录分页异常，请重新读取',{exact:true}).waitFor();assert.equal(await page.getByRole('option',{name:/知识库rag/}).count(),0)
      await page.getByLabel('知识库搜索',{exact:true}).fill('');await select(id);mismatch=true;await page.getByRole('button',{name:'读取绑定依据',exact:true}).click();await page.getByText('绑定依据与所选知识库来源不匹配，请重新选择',{exact:true}).waitFor();mismatch=false
    }
    await context();await expect(page.getByLabel('实现方式',{exact:true})).toHaveValue(id==='rag'?'RAGFlow外部知识库':id==='same'?'Dify同workspace授权':'Dify跨workspace复制')
    await page.getByLabel('使用目的',{exact:true}).fill('绑定业务知识');await page.getByLabel('使用开始时间',{exact:true}).fill('2026-11-01T00:00');await page.getByLabel('使用截止时间',{exact:true}).fill('2030-11-01T00:00')
    if(id==='rag'){
      await page.getByRole('button',{name:'保存申请草稿',exact:true}).click();await page.getByText('申请草稿已保存',{exact:true}).waitFor();await page.getByRole('button',{name:'我的申请',exact:true}).click();await open();await page.getByRole('button',{name:/恢复草稿 · rag/}).click();await page.getByText('已恢复草稿，资源与上传引用需重新核验',{exact:true}).waitFor()
      await page.getByRole('button',{name:'提交使用授权',exact:true}).click();assert.equal(posts,0);await select(id);await context();allowed=false;assert.equal((await submit()).status(),403);allowed=true
    }
    const response=await submit();assert.equal(response.status(),201,await response.text());const row=await response.json()
    if(id==='copy'){
      assert.equal(row.status,'待受理');allowed=false;assert.equal((await approve(row)).status(),403);allowed=true;revision=2;assert.equal((await approve(row)).status(),409);revision=1;hash='b'.repeat(64);assert.equal((await approve(row)).status(),409);hash='a'.repeat(64);assert.equal((await approve(row)).status(),200)
    }
    await page.getByRole('button',{name:'我的申请',exact:true}).click();await page.getByRole('button',{name:'刷新发布申请',exact:true}).click();await page.getByRole('button',{name:new RegExp(row.ticketNo+'.*'+(id==='copy'?'待结果确认':'已完成'))}).click()
    if(id==='copy'){await page.getByLabel('办理意见',{exact:true}).fill('确认复制绑定结果');await page.getByRole('button',{name:'确认结果',exact:true}).click();await page.getByRole('button',{name:new RegExp(row.ticketNo+'.*已完成')}).waitFor()}
  }
  assert.equal(commands.length,3);assert.ok(commands.every(c=>c.action==='bind_dataset' && c.account==='chen.yu'))
  const rows=await(await page.request.get(base+'api/applications?view=mine')).json();assert.ok(!JSON.stringify(rows).includes(secret));assert.equal(rows.items.find(row=>row.submission.resourceId==='copy').approvedFields['实现方式'],'Dify跨workspace复制')
  assert.ok(reads.some(url=>url.includes('/candidates?') && url.includes('cursor=page2')))
  console.log('PASS Edge: KB-03本人/共享分页、来源错配/循环分页拒绝、草稿重选、三实现方式、本人即办/他人审批及修订/权限/正文变化拦截')
}finally{await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})}
