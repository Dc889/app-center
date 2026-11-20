import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'
test('知识库绑定候选区分本人纳管与共享，范围/权限/清单/修订复核且凭证不落单',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'binding-selection-')),reads=[],commands=[]
  let mode='',allowed=true,revision=1,hash='a'.repeat(64)
  const secret='NEVER-PERSIST-DATASET-CREDENTIAL'
  const capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push({url:req.url,account:req.headers['x-account']})
    if(path.endsWith('/candidates'))return json(res,{items:[{resourceId:'shared',name:'共享库',source:mode==='private'?'本人纳管':'已发布共享',sourceSystem:'Dify',sourceScopeId:'source',sourceResourceId:'product',ownerAccount:'other',workspaceId:mode==='scope'?'wrong':q.get('workspaceId'),secret}],nextCursor:null,secret})
    if(path.includes('/execution-contexts/'))return json(res,{snapshotId:'context',ticketType:'KB-03',action:'bind_dataset',resourceId:'shared',eligible:allowed,
      fields:{'目录来源':mode==='private'?'本人纳管':'已发布共享','来源系统':'Dify','知识库名称':'共享库','源知识库ID':'product','源所有者账户名':'other',
        '目标Dify workspace ID':mode==='scope'?'wrong':q.get('workspaceId'),'源workspace/tenant ID':'source','实现方式':mode==='variant'?'Dify同workspace授权':'Dify跨workspace复制',
        '组织边界':['业务一部'],'密级':'内部','业务线':'业务','边界匹配结果':mode==='boundary'?'不符合':'符合','允许申请权限':mode==='permission'?['检索使用']:['检索使用','编排绑定'],
        '源文档版本指纹':hash,'文档清单快照ID':'manifest',policyRef:'policy',secret},
      preconditions:[{kind:'dataset_catalog',id:'shared',revision},...mode==='duplicate'?[{kind:'dataset_catalog',id:'shared',revision}]:[],{kind:'dataset_manifest',id:mode==='manifest'?'wrong':'manifest',sha256:hash}]})
    if(req.method==='POST'){const c=await body(req);commands.push(c);return json(res,mockExecution(c,{status:'succeeded',result:{resultId:'bound'}}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json','x-account':'li.qiang'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const list='/api/execution-candidates?ticketType=KB-03&action=bind_dataset&workspaceId=target&permission='+encodeURIComponent('编排绑定')
  assert.equal((await request(list,'')).status,403)
  const response=await request(list+'&account=li.qiang',user);assert.equal(response.status,200);assert.ok(!JSON.stringify(await response.json()).includes(secret));assert.equal(reads[0].account,'chen.yu');assert.ok(!reads[0].url.includes('account='))
  for(const failure of ['scope','private']){mode=failure;assert.equal((await request(list,user)).status,503)}
  mode='';assert.equal((await request(list.replace('&workspaceId=target',''),user)).status,400);assert.equal((await request(list+'&limit=101',user)).status,400)
  const input={ticketNo:'KB-03-selected',ticketType:'KB-03',resourceId:'shared',workspaceId:'target',fields:{purpose:'跨区绑定',permission:'编排绑定',targetAppId:'',startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),secret}}
  for(const failure of ['private','boundary','permission','scope','variant','manifest','duplicate']){
    mode=failure;assert.equal((await request('/api/applications',user,input)).status,['private','boundary','permission'].includes(failure)?403:409,failure)
  }
  mode='';allowed=false;assert.equal((await request('/api/applications',user,input)).status,403);allowed=true
  const preview=await request('/api/execution-contexts?ticketType=KB-03&action=bind_dataset&resourceId=shared&workspaceId=target&permission='+encodeURIComponent('编排绑定'),user)
  assert.equal(preview.status,200);assert.ok(!JSON.stringify(await preview.json()).includes(secret))
  const accepted=await request('/api/applications',user,input);assert.equal(accepted.status,201);assert.ok(!JSON.stringify(await accepted.json()).includes(secret))
  const decision={ticketNo:input.ticketNo,revision:1,action:'批准',note:'核验跨区复制与策略'}
  const approve=()=>request('/api/applications/transition',ops,decision)
  allowed=false;assert.equal((await approve()).status,403);allowed=true
  revision=2;assert.equal((await approve()).status,409);revision=1
  hash='b'.repeat(64);assert.equal((await approve()).status,409);hash='a'.repeat(64);assert.equal(commands.length,0)
  const approved=await approve();assert.equal(approved.status,200);const row=await approved.json();assert.equal(row.approvedFields['目录来源'],'已发布共享');assert.equal(row.approvedFields['实现方式'],'Dify跨workspace复制');assert.equal(row.preconditions.length,2)
  const mine=await(await request('/api/applications?view=mine',user)).json();assert.ok(!JSON.stringify(mine).includes(secret))
})
