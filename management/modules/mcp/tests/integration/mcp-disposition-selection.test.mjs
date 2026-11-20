import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'

test('MCP处置按动作资格发现范围，隐藏provider，拒绝不完整/歧义范围并只冻结所选账户工作区',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'mcp-disposition-selection-')),commands=[],reads=[]
  let allowed=false,mode='',changed=false
  const bindings=[{account:'chen.yu',workspaceId:'ws',providerId:'private-provider-a'},{account:'chen.yu',workspaceId:'ws',providerId:'private-provider-b'},{account:'other',workspaceId:'ws-other',providerId:'private-provider-c'}]
  const capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams;reads.push({url:req.url,account:req.headers['x-account']})
    if(path.includes('/catalog/mcp/'))return json(res,{resourceId:'mcp',status:'active',actions:allowed?['unbind_mcp','isolate_mcp','withdraw_mcp']:['bind']})
    if(path.includes('/execution-contexts/')) {
      if(mode==='revoke')allowed=false
      const rows=mode==='duplicate'?[...bindings,bindings[0]]:mode==='outside'?[bindings[2]]:bindings.map(b=>changed?{...b,providerId:b.providerId+'-changed'}:b)
      return json(res,{snapshotId:'context',ticketType:'MCP-03',action:q.get('action'),resourceId:'mcp',fields:{'绑定清单快照ID':'manifest','绑定清单完整':mode!=='incomplete','绑定清单':rows,credential:'must-not-leak'},
        preconditions:[{kind:'mcp',id:'mcp',revision:mode==='negative'?-1:1}]})
    }
    if(req.method==='POST'){const c=await body(req);commands.push(c);return json(res,mockExecution(c,{status:'succeeded',result:{resultId:'disposed'}}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const path='/api/execution-contexts?ticketType=MCP-03&action=unbind_mcp&resourceId=mcp'
  assert.equal((await request(path,user)).status,403)
  allowed=true
  const discovery=await(await request(path,user)).json()
  assert.deepEqual(discovery.fields['绑定清单'],[{account:'chen.yu',workspaceId:'ws'},{account:'other',workspaceId:'ws-other'}])
  assert.ok(!JSON.stringify(discovery).includes('private-provider'));assert.ok(!JSON.stringify(discovery).includes('must-not-leak'))
  const input={ticketNo:'MCP-03-scoped',ticketType:'MCP-03',resourceId:'mcp',workspaceId:'ws',fields:{operation:'单用户解绑',targetAccount:'chen.yu',reason:'主动解绑',facts:'结束使用'}}
  for(const failure of ['revoke','incomplete','duplicate','negative','outside']) {
    allowed=true;mode=failure
    assert.equal((await request('/api/applications',user,input)).status,['revoke','outside'].includes(failure)?403:409,failure)
  }
  allowed=true;mode=''
  const response=await request('/api/applications',user,input);assert.equal(response.status,201)
  const row=await response.json();assert.equal(row.snapshot.fields['绑定清单'].length,2)
  assert.ok(!JSON.stringify(row).includes('must-not-leak'))
  assert.ok(row.snapshot.fields['绑定清单'].every(b=>b.account==='chen.yu' && b.workspaceId==='ws'))
  const approve=()=>request('/api/applications/transition',ops,{ticketNo:input.ticketNo,revision:1,action:'批准',note:'核对目标绑定'})
  allowed=false;assert.equal((await approve()).status,403)
  allowed=true;changed=true;assert.equal((await approve()).status,409);assert.equal(commands.length,0)
  changed=false;const approved=await(await approve()).json();assert.equal(approved.approvedFields['绑定清单'].length,2)
  const deadline=Date.now()+5000;while(!commands.length && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(commands.length,1);assert.equal(commands[0].action,'unbind_mcp')
  assert.ok(reads.some(r=>r.url.includes('workspaceId=ws') && r.url.includes('targetAccount=chen.yu') && r.account==='chen.yu'))
  mode='incomplete'
  assert.equal((await request(path.replace('unbind_mcp','isolate_mcp'),user)).status,409)
  assert.equal((await request('/api/catalog?kind=agent&action=unbind_mcp',user)).status,400)
})
