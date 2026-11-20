import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'

test('Skill下架不能借下载权受理，预检中撤权、版本变化与歧义修订失败，审批重新核验',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'skill-withdrawal-selection-')),commands=[],reads=[]
  let allowed=false,version='1',mode='',contexts=0
  const capability=await listen(async(req,res,path)=>{
    reads.push({url:req.url,account:req.headers['x-account']})
    if(path.includes('/catalog/skill/'))return json(res,{resourceId:'skill',status:'available',actions:allowed?['download','withdraw_skill']:['download'],data:{version}})
    if(path.includes('/execution-contexts/')) {
      contexts++;const captured=version
      if(mode==='revoke')allowed=false
      if(mode==='version')version='2'
      return json(res,{snapshotId:'context',ticketType:'SKL-04',action:'withdraw_skill',resourceId:'skill',fields:{'Skill名称':'技能','当前版本号':captured,'历史下载次数':mode==='count'?-1:10,'历史下载人数':3},
        preconditions:[{kind:'skill',id:'skill',revision:1},...mode==='duplicate'?[{kind:'skill',id:'skill',revision:2}]:[]]})
    }
    if(req.method==='POST'){const command=await body(req);commands.push(command);return json(res,mockExecution(command,{status:'succeeded',result:{resultId:'withdrawn'}}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json','x-account':'li.qiang'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const input={ticketNo:'SKL-04-selection',ticketType:'SKL-04',resourceId:'skill',fields:{reason:'主动下架',explanation:'停止使用',effectiveAt:new Date().toISOString()}}
  assert.equal((await request('/api/applications',user,input)).status,403);assert.equal(contexts,0)
  const contextPath='/api/execution-contexts?ticketType=SKL-04&action=withdraw_skill&resourceId=skill'
  assert.equal((await request(contextPath,user)).status,403)
  for(const failure of ['revoke','version','count','duplicate']) {
    allowed=true;version='1';mode=failure
    assert.equal((await request('/api/applications',user,input)).status,failure==='revoke'?403:409,failure)
  }
  mode='';version='1';allowed=true
  assert.equal((await request('/api/applications',user,input)).status,201)
  const approve=()=>request('/api/applications/transition',ops,{ticketNo:input.ticketNo,revision:1,action:'批准',note:'保留历史文件与流水'})
  allowed=false;assert.equal((await approve()).status,403)
  allowed=true;version='2';assert.equal((await approve()).status,409);assert.equal(commands.length,0)
  version='1';assert.equal((await approve()).status,200)
  const deadline=Date.now()+5000
  while(!commands.length && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,1);assert.equal(commands[0].action,'withdraw_skill');assert.equal(commands[0].account,'chen.yu')
  assert.ok(reads.filter(row=>row.url.includes('/catalog/') || row.url.includes('/execution-contexts/')).every(row=>row.account==='chen.yu'))
  const before=reads.length
  for(const path of ['/api/catalog?kind=skill&action=republish','/api/catalog?kind=agent&action=withdraw_skill','/api/catalog/skill/skill/versions?action=withdraw_skill'])assert.equal((await request(path,user)).status,400)
  assert.equal(reads.length,before)
})
