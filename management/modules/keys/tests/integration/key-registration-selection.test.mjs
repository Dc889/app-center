import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'

test('密钥登记候选按身份/动作裁剪，明文不返回或落单，拒绝撤权/错钥/修订变化',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'key-registration-selection-')),reads=[],commands=[]
  const secret='NEVER-RETURN-OR-PERSIST-SECRET'
  let allowed=true,revision=2,keyId='product-key',mode=''
  const registration=()=>({registrationId:'key-reg',appId:'app',workspaceId:'ws',keyId,lastFour:'abcd',status:'active',revision,actions:allowed?['rotate_key','revoke_key']:[],appName:'应用',secret,credential:secret})
  const capability=await listen(async(req,res,path)=>{
    reads.push({url:req.url,account:req.headers['x-account']})
    if(path==='/internal/v1/key-registrations')return json(res,{items:[registration(),{...registration(),registrationId:'revoked',status:'revoked'}],nextCursor:null,secret})
    if(path==='/internal/v1/key-registrations/key-reg')return json(res,registration())
    if(path.includes('/execution-contexts/')) {
      const captured=revision
      if(mode==='revoke')allowed=false
      if(mode==='revision')revision++
      return json(res,{snapshotId:'context',ticketType:'KEY-02',action:new URL(req.url,'http://localhost').searchParams.get('action'),resourceId:'key-reg',fields:{'Dify应用ID':'app','Dify密钥ID':mode==='wrong-key'?'other':keyId,'密钥后四位':'abcd',secret},
        preconditions:[{kind:'key_registration',id:'key-reg',revision:captured},...mode==='duplicate'?[{kind:'key_registration',id:'key-reg',revision:captured}]:[]]})
    }
    if(req.method==='POST'){const c=await body(req);commands.push(c);return json(res,mockExecution(c,{status:'succeeded',result:{resultId:'revoked',details:{secret}}}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json','x-account':'li.qiang'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min')
  assert.equal((await request('/api/key-registrations?action=revoke_key','')).status,403)
  const response=await request('/api/key-registrations?action=revoke_key&q=app&cursor=page&limit=20&account=li.qiang',user)
  assert.equal(response.status,200);const page=await response.json();assert.equal(page.items.length,1);assert.equal(page.items[0].registrationId,'key-reg');assert.ok(!JSON.stringify(page).includes(secret));assert.equal(page.items[0].keyId,undefined)
  assert.ok(reads[0].url.includes('action=revoke_key') && !reads[0].url.includes('account='));assert.equal(reads[0].account,'chen.yu')
  for(const path of ['/api/key-registrations?action=reveal','/api/key-registrations?action=revoke_key&limit=101'])assert.equal((await request(path,user)).status,400)
  const input={ticketNo:'KEY-02-selection',ticketType:'KEY-02',resourceId:'key-reg',fields:{operation:'撤销',reason:'结束调用',effectiveAt:new Date().toISOString(),newExpiresAt:null,secret}}
  for(const failure of ['revoke','revision','wrong-key','duplicate']) {
    allowed=true;revision=2;mode=failure
    assert.equal((await request('/api/applications',user,input)).status,failure==='revoke'?403:409,failure)
  }
  mode='';allowed=true;revision=2
  const accepted=await request('/api/applications',user,input);assert.equal(accepted.status,201);assert.ok(!JSON.stringify(await accepted.json()).includes(secret))
  const approve=()=>request('/api/applications/transition',ops,{ticketNo:input.ticketNo,revision:1,action:'批准',note:'核对登记及用途'})
  allowed=false;assert.equal((await approve()).status,403)
  allowed=true;revision=3;assert.equal((await approve()).status,409)
  revision=2;keyId='replacement-key';assert.equal((await approve()).status,409);assert.equal(commands.length,0)
  keyId='product-key';assert.equal((await approve()).status,200)
  const deadline=Date.now()+5000;while(!commands.length && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,1);assert.equal(commands[0].action,'revoke_key');assert.equal(commands[0].account,'chen.yu')
  const rows=await(await request('/api/applications?view=mine',user)).json();assert.ok(!JSON.stringify(rows).includes(secret))
})
