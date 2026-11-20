import {agentImpact} from '../support/agent-impact.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../management/app/server/service.mjs'
import {listen,json,body} from '../../runtime/http.mjs'
import {mockExecution} from '../support/execution-state.mjs'
test('随应用发布允许先审知识库，源租户与应用区分离，公开访问取两策略交集并随应用下架失效',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'publication-association-')),states=new Map()
  let allowed=true,revision=1,appPolicy='',profile={account:'chen.yu',active:true,role:'user',org:'业务一部',businessLines:['业务'],clearance:'内部'}
  const capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams
    if(path.includes('/application-targets/'))return json(res,{appId:'future-app',name:'待发布应用',workspaceId:'app-ws',purpose:q.get('purpose'),eligible:allowed,targetRef:'app-ref',revision})
    if(path.includes('/execution-contexts/KB-02'))return json(res,{snapshotId:'kb',ticketType:'KB-02',action:'publish_dataset',resourceId:'dataset',fields:{'来源系统':'RAGFlow','所有者账户名':'chen.yu','workspace/tenant ID':'source-tenant','文档数':1,'文档清单快照ID':'manifest','模型目录核对结果':'一致','文档审查明细':[{documentId:'doc',sha256:'a'.repeat(64),autoVerdict:'通过'}]},preconditions:[{kind:'dataset_manifest',id:'manifest',sha256:'a'.repeat(64)}]})
    if(path.includes('/catalog/agent/'))return json(res,{resourceId:'agent',status:'active',actions:['withdraw_app'],data:{appId:'future-app',workspaceId:'app-ws',publicationVersionId:'v1',workflowSnapshotId:'workflow',policyRef:appPolicy}})
    if(path.includes('/resources/'))return json(res,{snapshotId:'app-snapshot',resourceId:'future-app',workspaceId:'app-ws',data:{publicationVersionId:'v1',catalogRevision:1,workflowSnapshotId:'workflow',dependencies:[],agentImpact:agentImpact('agent','future-app','app-ws')}})
    if(req.method==='POST'){const c=await body(req);const state=mockExecution(c,{status:'succeeded',result:{resultId:'done'}});states.set(c.executionId,state);return json(res,state)}
    const state=states.get(path.split('/').at(-1));return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url,resolvePolicyAccount:async()=>profile})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const input={ticketNo:'KB-02-associated',ticketType:'KB-02',resourceId:'dataset',workspaceId:'source-tenant',fields:{sourceSystem:'RAGFlow',shareMode:'随应用发布',relatedAppId:'future-app',relatedWorkspaceId:'app-ws',purpose:'首次上架依赖',name:'知识库',description:'说明',tags:['业务'],boundaryOrgs:['业务一部','业务二部'],classification:'内部',businessLine:'业务'}}
  assert.equal((await request('/api/applications',user,{...input,fields:{...input.fields,relatedWorkspaceId:''}})).status,400)
  allowed=false;assert.equal((await request('/api/applications',user,input)).status,403);allowed=true
  assert.equal((await request('/api/applications',user,input)).status,201)
  const decision={ticketNo:input.ticketNo,revision:1,action:'批准',note:'正文与关联应用核验',confirmations:[{documentId:'doc',sha256:'a'.repeat(64),verdict:'通过'}]}
  revision=2;assert.equal((await request('/api/applications/transition',ops,decision)).status,409);revision=1
  const approved=await(await request('/api/applications/transition',ops,decision)).json();assert.equal(approved.approvedFields['关联Dify workspace ID'],'app-ws');assert.equal(approved.preconditions.length,2)
  const policyInput={policyRef:approved.policy.ref,resourceId:'dataset',workspaceId:'source-tenant',account:'chen.yu',action:'read',targetAppId:'future-app',targetWorkspaceId:'app-ws'}
  const evaluate=()=>fetch(api.url+'/internal/v1/policy-decisions',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify(policyInput)}).then(r=>r.json())
  async function wait(reason){const until=Date.now()+5000;let result;do{result=await evaluate();if(result.reasonCode===reason)return result;await new Promise(resolve=>setTimeout(resolve,30))}while(Date.now()<until);assert.fail(JSON.stringify(result))}
  assert.equal((await wait('APPLICATION_NOT_PUBLISHED')).allowed,false)
  policyInput.targetAppId='other-app';assert.equal((await evaluate()).reasonCode,'APPLICATION_CONTEXT_MISMATCH');policyInput.targetAppId='future-app'
  const publish={ticketNo:'AG-02-associated',ticketType:'AG-02',resourceId:'future-app',workspaceId:'app-ws',fields:{scenario:'业务',instructions:'使用说明',businessLine:'业务',classification:'内部',scope:'all',boundaryOrgs:['业务一部'],usages:['run']}}
  assert.equal((await request('/api/applications',user,publish)).status,201)
  const published=await(await request('/api/applications/transition',ops,{ticketNo:publish.ticketNo,revision:1,action:'批准',note:'发布应用'})).json();appPolicy=published.policy.ref
  assert.equal((await wait('ALLOWED')).allowed,true)
  profile={...profile,org:'业务二部'};assert.equal((await evaluate()).reasonCode,'APPLICATION_ORG_BOUNDARY_DENIED');profile={...profile,org:'业务一部'}
  const withdrawal={ticketNo:'AG-05-associated',ticketType:'AG-05',resourceId:'agent',workspaceId:'app-ws',fields:{reason:'主动下架',explanation:'停止公开',effectiveAt:new Date().toISOString()}}
  assert.equal((await request('/api/applications',user,withdrawal)).status,201)
  assert.equal((await request('/api/applications/transition',ops,{ticketNo:withdrawal.ticketNo,revision:1,action:'批准',note:'下架应用',disposalScope:['仓库下架']})).status,200)
  assert.equal((await wait('APPLICATION_PUBLICATION_WITHDRAWN')).allowed,false)
})

test('替代目录拒绝自替代/同原生别名/越范围及预检撤权，冻结目录版本策略和修订',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'replacement-association-')),commands=[]
  let mode='',allowed=true,sourceAllowed=true,revision=1
  const capability=await listen(async(req,res,path)=>{
    if(path==='/internal/v1/agent-replacements')return json(res,{items:[{resourceId:'replacement',name:'替代应用',secret:'PRIVATE'}],nextCursor:null})
    if(path.includes('/agent-replacements/')){
      if(mode==='revoke-source')sourceAllowed=false
      return json(res,{sourceResourceId:'original',resourceId:'replacement',sourceAppId:'app',sourceWorkspaceId:'ws',name:'替代应用',appId:mode==='alias'?'app':'new-app',workspaceId:'ws',status:'active',publicationVersionId:'v2',policyRef:'policy-new',revision,eligible:allowed,audienceCompatible:mode!=='scope',secret:'PRIVATE'})
    }
    if(path.includes('/catalog/agent/'))return json(res,{resourceId:'original',status:'active',actions:sourceAllowed?['withdraw_app']:[],data:{appId:'app',workspaceId:'ws',publicationVersionId:'v1',workflowSnapshotId:'wf',policyRef:'policy-old'}})
    if(path.includes('/resources/'))return json(res,{snapshotId:'old',resourceId:'app',workspaceId:'ws',data:{publicationVersionId:'v1',catalogRevision:1,agentImpact:agentImpact('original','app','ws')}})
    if(req.method==='POST'){const c=await body(req);commands.push(c);return json(res,mockExecution(c,{status:'succeeded',result:{resultId:'done'}}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url});t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const list=await request('/api/agent-replacements?sourceResourceId=original',user);assert.equal(list.status,200);assert.ok(!JSON.stringify(await list.json()).includes('PRIVATE'))
  const input={ticketNo:'AG-05-replacement',ticketType:'AG-05',resourceId:'original',workspaceId:'ws',fields:{reason:'版本替换',explanation:'迁移到新目录',effectiveAt:new Date().toISOString(),replacementAppId:'replacement'}}
  assert.equal((await request('/api/applications',user,{...input,fields:{...input.fields,replacementAppId:'original'}})).status,400)
  for(const failure of ['alias','scope','revoke-source']){mode=failure;sourceAllowed=true;assert.equal((await request('/api/applications',user,input)).status,failure==='alias'?409:403)}
  mode='';sourceAllowed=true;assert.equal((await request('/api/applications',user,input)).status,201)
  const decision={ticketNo:input.ticketNo,revision:1,action:'批准',note:'替代范围已核对',disposalScope:['仓库下架']}
  revision=2;assert.equal((await request('/api/applications/transition',ops,decision)).status,409);revision=1;allowed=false;assert.equal((await request('/api/applications/transition',ops,decision)).status,403);allowed=true
  const approved=await(await request('/api/applications/transition',ops,decision)).json();assert.equal(approved.approvedFields.replacementApplication.publicationVersionId,'v2');assert.ok(approved.preconditions.some(p=>p.kind==='agent_replacement'));assert.ok(!JSON.stringify(approved).includes('PRIVATE'))
})
