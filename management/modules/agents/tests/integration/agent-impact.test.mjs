import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {agentImpact} from '../../../../../tests/support/agent-impact.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
test('影响依据拒绝伪零/过期/错范围，清单与依赖变更拒绝旧审批，调用增长不冒充范围变化',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'agent-impact-')),commands=[]
  let mode='',allowed=true,inventoryRevision=1,calls=5,approved=true
  const secret='PRIVATE-IMPACT-CREDENTIAL'
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/catalog/'))return json(res,{resourceId:'agent',status:'active',actions:allowed?['republish','withdraw_app']:[],data:{appId:'app',workspaceId:'ws',publicationVersionId:'old',workflowSnapshotId:'old-wf',policyRef:'policy'}})
    if(path.includes('/resources/')){
      const impact=agentImpact('agent','app','ws',[{kind:'tool',id:'tool',name:'工具',approved,externalAllowed:approved,change:'added'}])
      impact.grants={state:'collected',count:1,revision:inventoryRevision,items:['grant-1']};impact.keys={state:'collected',count:1,revision:1,items:['key-registration']};impact.calls30d.count=calls;impact.dependencies.items[0].credential=secret
      if(mode==='scope')impact.workspaceId='other'
      if(mode==='count')impact.grants.count=0
      if(mode==='duplicate'){impact.keys.items.push('key-registration');impact.keys.count=2}
      if(mode==='missing')impact.dependencies={state:'unavailable',count:null,revision:null,items:null,reasonCode:'NO_SOURCE'}
      if(mode==='false-zero')impact.dependencies={state:'unavailable',count:0,revision:null,items:null,reasonCode:'NO_SOURCE'}
      if(mode==='old')impact.capturedAt='2020-01-01T00:00:00.000Z'
      if(mode==='window')impact.calls30d.from=impact.calls30d.to
      if(mode==='calls-missing')impact.calls30d={state:'unavailable',count:null,from:null,to:null,reasonCode:'NO_SOURCE'}
      return json(res,{snapshotId:'app-snapshot',resourceId:'app',workspaceId:'ws',data:{publicationVersionId:'new',workflowSnapshotId:'new-wf',catalogRevision:2,agentImpact:impact}})
    }
    if(req.method==='POST'){const c=await body(req);commands.push(c);return json(res,mockExecution(c,{status:'succeeded',result:{resultId:'done'}}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url});t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min'),preview='/api/agent-impact?resourceId=agent&workspaceId=ws&action=withdraw_app'
  assert.equal((await request(preview,'')).status,403);allowed=false;assert.equal((await request(preview,user)).status,403);allowed=true
  for(const failure of ['scope','count','duplicate','false-zero','old','window']){mode=failure;assert.equal((await request(preview,user)).status,409,failure)}
  mode='calls-missing';const missing=await(await request(preview,user)).json();assert.equal(missing.impact.calls30d.count,null)
  mode='';const valid=await(await request(preview,user)).json();assert.equal(valid.impact.grants.count,1);assert.equal(valid.impact.calls30d.count,5);assert.ok(!JSON.stringify(valid).includes(secret))
  for(const type of ['AG-04','AG-05']){
    const input={ticketNo:type+'-impact',ticketType:type,resourceId:'agent',workspaceId:'ws',fields:type==='AG-04'?{changeDescription:'调整工具'}:{reason:'主动下架',explanation:'停止服务',effectiveAt:new Date().toISOString()}}
    mode='missing';assert.equal((await request('/api/applications',user,input)).status,409);mode='';assert.equal((await request('/api/applications',user,input)).status,201)
    const decision={ticketNo:input.ticketNo,revision:1,action:'批准',note:'核对影响范围',disposalScope:['仓库下架','撤销访问授权','撤销登记密钥'],warningDecision:'确认风险并继续审批'}
    inventoryRevision=2;assert.equal((await request('/api/applications/transition',ops,decision)).status,409);inventoryRevision=1;approved=false;assert.equal((await request('/api/applications/transition',ops,decision)).status,409);approved=true
    assert.equal(commands.length,type==='AG-04'?0:1)
    calls=50;const response=await request('/api/applications/transition',ops,decision);assert.equal(response.status,200);const row=await response.json();assert.equal(row.approvedImpact.calls30d.count,50);assert.equal(row.approvedFields['影响依据'].keys.count,1);assert.equal(row.preconditions.length,4);assert.ok(!JSON.stringify(row).includes(secret))
    const until=Date.now()+3000;while(commands.length<(type==='AG-04'?1:2) && Date.now()<until)await new Promise(resolve=>setTimeout(resolve,30))
  }
})
