import {agentImpact} from '../../../../../tests/support/agent-impact.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {body,json,listen} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'

test('智能体管理按动作资格受理与复核，允许已下架再发布，拒绝撤权和原版本变化后审批',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'agent-management-')),commands=[],reads=[]
  let actions=[],status='active',publicationVersionId='old',sourceReads=0,revokeOnSource=false
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/catalog/')){reads.push({url:req.url,account:req.headers['x-account']});return json(res,{resourceId:'agent',status,actions,
      data:{appId:'app',workspaceId:'ws',publicationVersionId,workflowSnapshotId:'old-workflow',policyRef:'policy'}})}
    if(path.includes('/resources/')){sourceReads++;if(revokeOnSource)actions=[];return json(res,{snapshotId:'new-snapshot',resourceId:'app',workspaceId:'ws',data:{publicationVersionId:'new',workflowSnapshotId:'new-workflow',catalogRevision:2,dependencies:[],agentImpact:agentImpact('agent','app','ws')}})}
    if(req.method==='POST'){const command=await body(req);commands.push(command);return json(res,mockExecution(command,{status:'succeeded',result:{resultId:'done'}}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const republish={ticketNo:'AG-04-managed',ticketType:'AG-04',resourceId:'agent',workspaceId:'ws',fields:{changeDescription:'修复新版'}}
  assert.equal((await request('/api/applications',user,republish)).status,403);assert.equal(sourceReads,0)
  actions=['republish','withdraw_app'];status='withdrawn'
  revokeOnSource=true
  assert.equal((await request('/api/applications',user,republish)).status,403)
  revokeOnSource=false;actions=['republish','withdraw_app']
  assert.equal((await request('/api/applications',user,republish)).status,201)
  const withdraw={ticketNo:'AG-05-managed',ticketType:'AG-05',resourceId:'agent',workspaceId:'ws',fields:{reason:'主动下架',explanation:'停止服务',effectiveAt:new Date().toISOString()}}
  assert.equal((await request('/api/applications',user,withdraw)).status,403)
  status='unavailable';assert.equal((await request('/api/applications',user,withdraw)).status,201)
  const approve=row=>request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:1,action:'批准',note:'已核验',disposalScope:['仓库下架']})
  actions=[]
  assert.equal((await approve(republish)).status,403);assert.equal((await approve(withdraw)).status,403)
  actions=['republish','withdraw_app'];publicationVersionId='changed'
  assert.equal((await approve(republish)).status,409);assert.equal((await approve(withdraw)).status,409);assert.equal(commands.length,0)
  publicationVersionId='old'
  assert.equal((await approve(republish)).status,200);assert.equal((await approve(withdraw)).status,200)
  const deadline=Date.now()+5000
  while(commands.length<2 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,2);assert.deepEqual(commands.map(c=>c.action).sort(),['republish','withdraw_app'])
  assert.ok(reads.every(row=>row.account==='chen.yu' && /action=(republish|withdraw_app)$/.test(row.url)))
  const before=reads.length
  assert.equal((await request('/api/catalog?kind=agent&action=grant_app_access',user)).status,400)
  assert.equal((await request('/api/catalog?kind=skill&action=republish',user)).status,400)
  assert.equal(reads.length,before)
  assert.equal((await request('/api/catalog/agent/agent?action=republish',user)).status,200)
  assert.equal(reads.at(-1).url,'/internal/v1/catalog/agent/agent?action=republish')
})
