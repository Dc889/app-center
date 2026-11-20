import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,body} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'

test('工具候选按可信身份/操作/工作区裁剪，原生ID独立，审批资格与登记修订复核',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'tool-selection-')),reads=[],commands=[]
  let mode='',allowed=true,revision=1,provider='provider',fingerprint='a'.repeat(64)
  const secret='NEVER-RETURN-TOOL-CREDENTIAL'
  const capability=await listen(async(req,res,path)=>{
    const q=new URL(req.url,'http://localhost').searchParams
    reads.push({url:req.url,account:req.headers['x-account']})
    if(path.endsWith('/candidates'))return json(res,{items:[{resourceId:'canonical-tool',name:'工具',source:q.get('operation')==='撤销批准'?'tool_approval':'dify_tool',workspaceId:mode==='scope'?'wrong':q.get('workspaceId') || 'retired-ws',secret}],nextCursor:mode==='cursor'?undefined:null,secret})
    if(path.includes('/execution-contexts/')) {
      const operation=q.get('operation')
      return json(res,{snapshotId:'tool-context',ticketType:'TOL-01',action:'set_tool_approval',operation:mode==='operation'?'wrong':operation,eligible:allowed,resourceId:'canonical-tool',
        fields:{'Dify workspace ID':q.get('workspaceId'),'Dify工具ID':'native-shared-name','Dify工具提供者ID':provider,'工具名称':'工具','工具提供者名称':'提供者','配置来源':operation==='撤销批准'?'批准登记':'产品现状',
          '工具版本':'2','工具配置指纹':fingerprint,'输入参数schema':{type:'object',properties:{query:{type:'string'}}},'输出说明':'检索结果',secret,
          ...operation==='首次批准'?{}:{'原批准工单号':'TOL-01-old','原工具版本':'1','原工具配置指纹':'b'.repeat(64),...mode==='diff'?{}:{'配置差异':[{差异项:'版本',原值摘要:'1',新值摘要:'2'}]}}},
        preconditions:[{kind:'tool_configuration',id:'canonical-tool',sha256:fingerprint},{kind:'tool_approval',id:'canonical-tool',revision:mode==='revision'?-1:operation==='首次批准'?0:revision},...mode==='duplicate'?[{kind:'tool_approval',id:'canonical-tool',revision}]:[]]})
    }
    if(req.method==='POST'){const c=await body(req);commands.push(c);return json(res,mockExecution(c,{status:'succeeded',result:{resultId:'approval'}}))}
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json','x-account':'li.qiang'},body:data?JSON.stringify(data):undefined})
  async function login(account){const r=await request('/api/demo-session','',{account});return r.headers.get('set-cookie').split(';')[0]}
  const user=await login('chen.yu'),ops=await login('zhou.min')
  const list='/api/execution-candidates?ticketType=TOL-01&action=set_tool_approval&operation='+encodeURIComponent('首次批准')+'&workspaceId=ws'
  assert.equal((await request(list,'')).status,403)
  const page=await request(list+'&account=li.qiang&limit=20',user);assert.equal(page.status,200);assert.ok(!JSON.stringify(await page.json()).includes(secret))
  assert.equal(reads[0].account,'chen.yu');assert.ok(!reads[0].url.includes('account='))
  for(const query of ['&limit=101','&operation=invalid','&workspaceId='])assert.equal((await request(list.replace(/&operation=[^&]+|&workspaceId=[^&]+/g,'')+query,user)).status,400)
  for(const failure of ['scope','cursor']){mode=failure;assert.equal((await request(list,user)).status,503)}
  mode='';const revoked=await request('/api/execution-candidates?ticketType=TOL-01&action=set_tool_approval&operation='+encodeURIComponent('撤销批准'),user)
  assert.equal(revoked.status,200);assert.equal((await revoked.json()).items[0].workspaceId,'retired-ws')
  const input={ticketNo:'TOL-01-selected',ticketType:'TOL-01',resourceId:'canonical-tool',workspaceId:'ws',fields:{operation:'变更再审',description:'说明',purpose:'业务',permissions:['读取'],targetOrgs:['业务一部'],classification:'内部',businessLine:'业务'}}
  for(const failure of ['operation','revision','duplicate','diff']){mode=failure;assert.equal((await request('/api/applications',user,input)).status,409,failure)}
  mode='';allowed=false;assert.equal((await request('/api/applications',user,input)).status,403)
  allowed=true;const accepted=await request('/api/applications',user,input);assert.equal(accepted.status,201);assert.ok(!JSON.stringify(await accepted.json()).includes(secret))
  const decision={ticketNo:input.ticketNo,revision:1,action:'批准',note:'核验工具配置',securityVerdict:'通过',securityNote:'安全核验通过',externalAllowed:'允许'}
  const approve=()=>request('/api/applications/transition',ops,decision)
  allowed=false;assert.equal((await approve()).status,403);allowed=true
  for(const failure of ['revision','provider','fingerprint']){
    revision=failure==='revision'?2:1;provider=failure==='provider'?'other':'provider';fingerprint=(failure==='fingerprint'?'c':'a').repeat(64)
    assert.equal((await approve()).status,409,failure);assert.equal(commands.length,0)
  }
  revision=1;provider='provider';fingerprint='a'.repeat(64)
  const approved=await approve();assert.equal(approved.status,200);const result=await approved.json()
  assert.equal(result.approvedFields['Dify工具ID'],'native-shared-name');assert.equal(result.approvedFields['原工具配置指纹'],'b'.repeat(64));assert.equal(result.preconditions.length,2)
  const rows=await(await request('/api/applications?view=mine',user)).json();assert.ok(!JSON.stringify(rows).includes(secret))
})
