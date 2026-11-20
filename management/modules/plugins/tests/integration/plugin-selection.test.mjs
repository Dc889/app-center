import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'

test('插件动作候选与精确实例映射，卸载独立于目录，拒绝错实例/歧义修订/升级版本变化',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'plugin-selection-')),reads=[],commands=[]
  let mode='',allowed=true,revision=1,hash='a'.repeat(64),catalogReads=0
  const secret='NEVER-PERSIST-PLUGIN-CREDENTIAL'
  const capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push({url:req.url,account:req.headers['x-account']})
    if(path.endsWith('/capabilities'))return json(res,{items:['install','upgrade','uninstall'].map(action=>({ticketType:'PLG-03',ticketTypeVersion:'1',action,variant:null,state:'verified'}))})
    if(path.endsWith('/candidates')){
      const row={resourceId:'plugin',name:'插件',source:'installation',workspaceId:mode==='scope'?'wrong':q.get('workspaceId') || 'retired-ws',installationId:q.get('operation')==='安装'?null:'instance',secret}
      return json(res,{items:[row,...q.get('operation')==='安装'?[]:[{...row,installationId:mode==='duplicate'?'instance':mode==='missing'?'':'other-instance'}]],nextCursor:mode==='cursor'?undefined:null,secret})
    }
    if(path.includes('/catalog/plugin/')){catalogReads++;return json(res,{resourceId:'plugin',name:'插件',status:'approved',data:{version:'2',sha256:hash,installAccess:allowed?'instant':'denied',secret}})}
    if(path.includes('/execution-contexts/')){
      const uninstall=q.get('action')==='uninstall'
      return json(res,{snapshotId:'plugin-context',ticketType:'PLG-03',action:q.get('action'),resourceId:mode==='resource'?'other':'plugin',eligible:allowed,
        fields:{'目标Dify workspace ID':mode==='workspace'?'wrong':q.get('workspaceId'),'插件名称':'插件','批准版本号':uninstall?'1':'2','版本指纹':uninstall?'b'.repeat(64):hash,
          '原安装版本号':'1','原安装指纹':(mode==='uninstall-hash'?'c':'b').repeat(64),'安装实例ID':mode==='instance'?'wrong':q.get('installationId'),'权限匹配结果':'需审批','升级策略':'逐个工单升级',secret},
        preconditions:[{kind:'plugin_installation',id:q.get('installationId'),revision:mode==='negative'?-1:revision},...mode==='duplicate-revision'?[{kind:'plugin_installation',id:q.get('installationId'),revision}]:[],
          ...!uninstall && mode!=='target-missing'?[{kind:'plugin',id:'plugin',sha256:hash}]:[]]})
    }
    if(req.method==='POST'){const c=await body(req);commands.push(c);return json(res,mockExecution(c,{status:'succeeded',result:{resultId:'instance'}}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json','x-account':'li.qiang'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min'),admin=await login('li.qiang')
  const list='/api/execution-candidates?ticketType=PLG-03&action=upgrade&operation='+encodeURIComponent('升级')+'&workspaceId=ws'
  assert.equal((await request(list,'')).status,403)
  const response=await request(list+'&account=li.qiang',user);assert.equal(response.status,200);const page=await response.json();assert.equal(page.items.length,2);assert.ok(!JSON.stringify(page).includes(secret));assert.equal(page.items[1].installationId,'other-instance')
  assert.equal(reads[0].account,'chen.yu');assert.ok(!reads[0].url.includes('account='))
  for(const failure of ['scope','duplicate','missing','cursor']){mode=failure;assert.equal((await request(list,user)).status,503,failure)}
  mode='';assert.equal((await request(list.replace('&workspaceId=ws',''),user)).status,400)
  assert.equal((await request(list.replace('action=upgrade','action=uninstall'),user)).status,400)
  const cleanup=await request('/api/execution-candidates?ticketType=PLG-03&action=uninstall&operation='+encodeURIComponent('卸载'),user);assert.equal(cleanup.status,200);assert.equal((await cleanup.json()).items[0].workspaceId,'retired-ws')
  const config={code:'PLG-03',version:'1',name:'插件操作',workspaceId:'',revision:0,branchFlows:{upgrade:'approval',uninstall:'approval'}}
  const saved=await(await request('/api/types/draft',admin,config)).json();assert.equal((await request('/api/types/publish',admin,saved)).status,200)
  const input={ticketNo:'PLG-03-precise',ticketType:'PLG-03',resourceId:'plugin',workspaceId:'ws',fields:{operation:'升级',purpose:'升级验证',installationId:'instance',secret}}
  assert.equal((await request('/api/applications',user,{...input,fields:{...input.fields,installationId:''}})).status,400)
  for(const failure of ['resource','workspace','instance','negative','duplicate-revision','target-missing']){mode=failure;assert.equal((await request('/api/applications',user,input)).status,409,failure)}
  mode='';allowed=false;assert.equal((await request('/api/applications',user,input)).status,403);allowed=true
  assert.equal((await request('/api/applications',user,input)).status,201)
  const decision={ticketNo:input.ticketNo,revision:1,action:'批准',note:'确认版本和具体实例'}
  const approve=()=>request('/api/applications/transition',ops,decision)
  allowed=false;assert.equal((await approve()).status,403);allowed=true
  revision=2;assert.equal((await approve()).status,409);revision=1
  hash='c'.repeat(64);assert.equal((await approve()).status,409);hash='a'.repeat(64);assert.equal(commands.length,0)
  const approved=await approve();assert.equal(approved.status,200);const row=await approved.json();assert.equal(row.approvedFields['安装实例ID'],'instance');assert.equal(row.approvedFields['原安装版本号'],'1');assert.equal(row.preconditions.length,2)
  const before=catalogReads,uninstall={...input,ticketNo:'PLG-03-cleanup',workspaceId:'retired-ws',fields:{operation:'卸载',purpose:'清理旧安装',installationId:'other-instance'}}
  mode='uninstall-hash';assert.equal((await request('/api/applications',user,uninstall)).status,409)
  mode='';const clean=await request('/api/applications',user,uninstall);assert.equal(clean.status,201);assert.equal(catalogReads,before);const cleanupRow=await clean.json();assert.equal(cleanupRow.snapshot.data.installationId,'other-instance');assert.equal(cleanupRow.snapshot.data.version,'1');assert.equal(cleanupRow.preconditions.length,1)
  const rows=await(await request('/api/applications?view=mine',user)).json();assert.ok(!JSON.stringify(rows).includes(secret))
})
