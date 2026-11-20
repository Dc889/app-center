import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
test('绑定目标应用按身份/用途/工作区过滤，提交审批重读并冻结修订，MCP下发包含目标',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'application-targets-')),reads=[],commands=[]
  let mode='',allowed=true,revision=1,access='approval'
  const secret='NEVER-PERSIST-TARGET-CREDENTIAL'
  const capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push({url:req.url,account:req.headers['x-account']})
    if(path==='/internal/v1/application-targets')return json(res,{items:[{appId:'app',name:'目标应用',workspaceId:mode==='scope'?'wrong':q.get('workspaceId'),secret},...mode==='duplicate'?[{appId:'app',name:'重复',workspaceId:'ws'}]:[]],nextCursor:mode==='cursor'?undefined:null,secret})
    if(path==='/internal/v1/application-targets/app')return json(res,{appId:mode==='app'?'wrong':'app',workspaceId:mode==='scope'?'wrong':q.get('workspaceId'),purpose:mode==='purpose'?'wrong':q.get('purpose'),name:'目标应用',targetRef:'target-ref',revision:mode==='revision'?-1:revision,eligible:allowed,secret})
    if(path.includes('/binding-contexts/'))return json(res,{resourceId:'source',workspaceId:'ws',bindingAccess:access,expectedUrlFingerprint:'a'.repeat(64),secret})
    if(path.includes('/execution-contexts/KB-03'))return json(res,{snapshotId:'source',ticketType:'KB-03',action:'bind_dataset',resourceId:'source',eligible:true,
      fields:{'目录来源':'已发布共享','来源系统':'Dify','知识库名称':'知识库','源知识库ID':'product','源workspace/tenant ID':'ws','源所有者账户名':'other','目标Dify workspace ID':'ws',
        '组织边界':['业务一部'],'密级':'内部','业务线':'业务','允许申请权限':['检索使用','编排绑定'],'实现方式':'Dify同workspace授权','边界匹配结果':'符合',policyRef:'policy'},preconditions:[{kind:'dataset_catalog',id:'source',revision:1}]})
    if(req.method==='POST'){const c=await body(req);commands.push(c);return json(res,mockExecution(c,{status:'succeeded',result:{resultId:'binding'}}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json','x-account':'li.qiang'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min'),list='/api/application-targets?purpose=dataset_binding&workspaceId=ws'
  assert.equal((await request(list,'')).status,403)
  const page=await request(list+'&account=li.qiang',user);assert.equal(page.status,200);assert.ok(!JSON.stringify(await page.json()).includes(secret));assert.equal(reads[0].account,'chen.yu');assert.ok(!reads[0].url.includes('account='))
  for(const failure of ['scope','duplicate','cursor']){mode=failure;assert.equal((await request(list,user)).status,503)}
  mode='';assert.equal((await request(list.replace('dataset_binding','unknown'),user)).status,400);assert.equal((await request(list+'&limit=101',user)).status,400)
  const detail='/api/application-targets/app?purpose=dataset_binding&workspaceId=ws'
  for(const failure of ['scope','purpose','app','revision']){mode=failure;assert.equal((await request(detail,user)).status,409)}
  mode='';allowed=false;assert.equal((await request(detail,user)).status,403);allowed=true
  for(const type of ['KB-03','MCP-02']){
    const input={ticketNo:type+'-target',ticketType:type,resourceId:'source',workspaceId:'ws',fields:{targetAppId:'app',purpose:'配置目标应用绑定',permission:'编排绑定',startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),secret}}
    assert.equal((await request('/api/applications',user,{...input,fields:{...input.fields,targetAppId:false}})).status,400)
    allowed=false;assert.equal((await request('/api/applications',user,input)).status,403);allowed=true
    const submitted=await request('/api/applications',user,input);assert.equal(submitted.status,201);assert.ok(!JSON.stringify(await submitted.json()).includes(secret))
    const approve=()=>request('/api/applications/transition',ops,{ticketNo:input.ticketNo,revision:1,action:'批准',note:'核验应用范围与修订'})
    allowed=false;assert.equal((await approve()).status,403);allowed=true;revision=2;assert.equal((await approve()).status,409);revision=1
    const approved=await approve();assert.equal(approved.status,200)
    const until=Date.now()+5000;while(!commands.some(c=>c.ticketNo===input.ticketNo) && Date.now()<until)await new Promise(resolve=>setTimeout(resolve,30))
    const c=commands.find(c=>c.ticketNo===input.ticketNo);assert.ok(c)
    const frozen=await(await fetch(api.url+'/internal/v1/approved-inputs/'+c.executionId,{headers:{authorization:'Bearer test'}})).json()
    assert.equal(frozen.fields['目标智能体ID'],'app');assert.equal(frozen.fields['目标应用工作区ID'],'ws');assert.ok(frozen.preconditions.some(p=>p.kind==='application_target' && p.id==='target-ref' && p.revision===1))
    if(type==='MCP-02'){assert.equal(c.payload.targetAppId,'app');assert.equal(c.payload.decisionRef,'dec-'+c.executionId)}
  }
  access='instant';const instant=await request('/api/applications',user,{ticketNo:'MCP-02-instant-target',ticketType:'MCP-02',resourceId:'source',workspaceId:'ws',fields:{targetAppId:'app',purpose:'公开绑定',startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()}});assert.equal(instant.status,201);assert.equal((await instant.json()).status,'执行中')
  const mine=await(await request('/api/applications?view=mine',user)).json();assert.ok(!JSON.stringify(mine).includes(secret))
})
