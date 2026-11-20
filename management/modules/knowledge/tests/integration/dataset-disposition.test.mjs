import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {body,json,listen} from '../../../../../runtime/http.mjs'
import {mockExecution} from '../../../../../tests/support/execution-state.mjs'

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'dataset-disposition-'))
  const commands=[],states=new Map(),failures=new Set()
  let revision=1
  const capability=await listen(async(req,res,path)=>{
    if(path.includes('/execution-contexts/KB-05')) {
      const query=new URL(req.url,'http://localhost').searchParams
      return json(res,{snapshotId:'context-'+revision,ticketType:'KB-05',action:query.get('action'),resourceId:'kb',eligible:true,
        fields:{'知识库名称':'知识库','源workspace/tenant ID':'source-scope','来源系统':'RAGFlow','源知识库ID':'source-kb','文档清单快照ID':'manifest','清单完整':true,
          '文档清单':[{documentId:'doc-1',sha256:'a'.repeat(64)},{documentId:'doc-2',sha256:'b'.repeat(64)}],
          '影响中的授权数':2,'影响中的智能体数':1,
          '处置目标清单':[{system:'平台',objectId:'kb',action:'目录下架'},{system:'平台',objectId:'kb',action:'暂停分享'},
            {system:'平台',objectId:'grant-1',action:'撤销未到期授权'},
            ...['doc-1','doc-2'].map(documentId=>({system:'RAGFlow',objectId:documentId,documentId,action:'停用文档'}))],
          '告警ID':query.get('sourceEventId'),'告警证据':[{evidenceId:'alert-evidence',sha256:'c'.repeat(64)}],
          rawText:'DO NOT PERSIST'},
        preconditions:[{kind:'dataset',id:'kb',revision},{kind:'dataset_manifest',id:'manifest',sha256:'d'.repeat(64)}]})
    }
    if(req.method==='POST' && path==='/internal/v1/executions') {
      const command=await body(req)
      commands.push(command)
      const failed=failures.delete(command.action)
      const state=mockExecution(command,{status:failed?'failed':'succeeded',result:{resultId:failed?'':'result-'+command.executionId,
        retryable:failed,...failed?{failureCode:'TEMPORARY'}:{},details:{values:[{objectId:'doc-1',result:failed?'failed':'succeeded'}]}}})
      states.set(command.executionId,state)
      return json(res,state)
    }
    const state=states.get(path.split('/').at(-1))
    return state?json(res,state):json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const options={dir,token:'test',executor:capability.url}
  let api=await startManagement(options)
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie='',data,headers={})=>fetch(api.url+path,{method:data===undefined?'GET':'POST',
    headers:{cookie,'content-type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data)})
  async function login(account) {
    const r=await request('/api/demo-session','',{account})
    return r.headers.get('set-cookie').split(';')[0]
  }
  async function find(ticketNo,view,cookie) {
    const r=await request('/api/applications?view='+view,cookie)
    assert.equal(r.status,200)
    return (await r.json()).items.find(row=>row.ticketNo===ticketNo)
  }
  async function wait(ticketNo,status,cookie,view='query') {
    const until=Date.now()+6000
    while(Date.now()<until) {
      const row=await find(ticketNo,view,cookie)
      if(row?.status===status)return row
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    assert.fail('未进入 '+status)
  }
  return {request,login,find,wait,commands,failures,url:()=>api.url,
    revise(){revision++},async restart(){await api.close();api=await startManagement(options)}}
}

test('KB-05 人工处置按本人证据和文档清单冻结，过期修订及扩大对象范围被拒绝',async t=>{
  const f=await fixture(t)
  const user=await f.login('chen.yu'),ops=await f.login('zhou.min'),other=await f.login('wang.ning'),admin=await f.login('li.qiang')
  const bytes=Buffer.from('evidence-content')
  const upload=await fetch(f.url()+'/api/evidence',{method:'POST',headers:{cookie:user,'x-filename':encodeURIComponent('证据.txt')},body:bytes})
  assert.equal(upload.status,201)
  const evidence=await upload.json()
  assert.equal((await f.request('/api/evidence/'+evidence.evidenceId,ops)).status,404)
  assert.equal((await f.request('/api/evidence/'+evidence.evidenceId,other)).status,404)
  const input={ticketNo:'KB-05-manual',ticketType:'KB-05',resourceId:'kb',fields:{target:'指定文档',documentIds:['doc-1'],
    reason:'内容违规',facts:'审查不通过',evidenceIds:[]}}
  assert.equal((await f.request('/api/applications',user,input)).status,400)
  input.fields.evidenceIds=[evidence.evidenceId]
  assert.equal((await f.request('/api/applications',other,input)).status,403)
  assert.equal((await f.request('/api/applications',user,{...input,ticketNo:'KB-05-foreign',fields:{...input.fields,documentIds:['foreign']}})).status,409)
  const submitted=await f.request('/api/applications',user,input)
  assert.equal(submitted.status,201)
  assert.equal(JSON.stringify(await submitted.json()).includes('DO NOT PERSIST'),false)
  assert.equal(f.commands.length,0)
  assert.equal((await f.request('/api/evidence/'+evidence.evidenceId,ops)).status,200)
  assert.equal((await f.request('/api/evidence/'+evidence.evidenceId+'?forApplication=1',ops)).status,404)
  assert.equal((await f.request('/api/evidence/'+evidence.evidenceId+'?forApplication=1',user)).status,200)
  assert.deepEqual(Buffer.from(await(await f.request('/api/evidence/'+evidence.evidenceId+'/file',ops)).arrayBuffer()),bytes)
  const approval={ticketNo:input.ticketNo,revision:1,action:'批准',note:'复核文档',dispositionActions:['目录下架']}
  assert.equal((await f.request('/api/applications/transition',admin,approval)).status,403)
  assert.equal((await f.request('/api/applications/transition',ops,approval)).status,400)
  approval.dispositionActions=['停用文档']
  const approved=await(await f.request('/api/applications/transition',ops,approval)).json()
  assert.deepEqual(approved.approvedFields['API执行对象清单'],[{system:'RAGFlow',objectId:'doc-1',documentId:'doc-1',action:'停用文档'}])
  assert.equal(approved.approvedFields['证据附件'][0].sha256,evidence.sha256)
  const row=await f.wait(input.ticketNo,'待结果确认',user,'mine')
  assert.equal((await f.request('/api/applications/transition',user,{ticketNo:row.ticketNo,revision:row.revision,action:'确认结果',note:'已核对'})).status,200)
  const stale={...input,ticketNo:'KB-05-stale'}
  assert.equal((await f.request('/api/applications',user,stale)).status,201)
  f.revise()
  assert.equal((await f.request('/api/applications/transition',ops,{...approval,ticketNo:stale.ticketNo})).status,409)
  await f.restart()
  assert.deepEqual(Buffer.from(await(await f.request('/api/evidence/'+evidence.evidenceId+'/file',user)).arrayBuffer()),bytes)
})

test('KB-05 告警暂停与人工处置分节点恢复，二次失败重试不重放已成功暂停',async t=>{
  const f=await fixture(t)
  const ops=await f.login('zhou.min'),user=await f.login('chen.yu'),admin=await f.login('li.qiang')
  const alert={sourceEventId:'evt-1',resourceId:'kb',fields:{target:'指定文档',documentIds:['doc-1'],reason:'内容违规',facts:'正文审查失败'}}
  assert.equal((await f.request('/internal/v1/dataset-alerts',user,alert)).status,403)
  f.failures.add('pause_share')
  const created=await f.request('/internal/v1/dataset-alerts','',alert,{authorization:'Bearer test'})
  assert.equal(created.status,201)
  let row=await created.json()
  assert.equal((await f.request('/internal/v1/dataset-alerts','',{...alert,resourceId:'foreign'},{authorization:'Bearer test'})).status,409)
  row=await f.wait(row.ticketNo,'执行失败',ops)
  assert.equal((await f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'批准',note:'不能越过暂停',dispositionActions:['停用文档']})).status,409)
  assert.equal((await f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'重试执行',note:'恢复暂停'})).status,200)
  row=await f.wait(row.ticketNo,'待运维确认',ops)
  const pausedId=row.command.executionId
  assert.equal((await f.find(row.ticketNo,'mine',user)),undefined)
  assert.equal((await f.find(row.ticketNo,'mine',admin)),undefined)
  await f.restart()
  const duplicate=await(await f.request('/internal/v1/dataset-alerts','',alert,{authorization:'Bearer test'})).json()
  assert.equal(duplicate.command.executionId,pausedId)
  assert.equal(f.commands.length,2)
  f.revise() // The pause changes the directory revision; disposal freezes its own new revision.
  f.failures.add('dispose_dataset')
  const approval={ticketNo:row.ticketNo,revision:row.revision,action:'批准',note:'仅停用命中文档',dispositionActions:['停用文档'],recoveryCondition:'重新审查通过'}
  assert.equal((await f.request('/api/applications/transition',admin,approval)).status,403)
  assert.equal((await f.request('/api/applications/transition',ops,approval)).status,200)
  row=await f.wait(row.ticketNo,'执行失败',ops)
  const callback=await(await fetch(f.url()+'/internal/v1/approved-inputs/'+pausedId,{headers:{authorization:'Bearer test'}})).json()
  assert.equal(callback.action,'pause_share')
  assert.equal(callback.preconditions[0].revision,1)
  assert.equal(row.preconditions[0].revision,2)
  await f.restart()
  assert.equal((await f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'重试执行',note:'重试文档停用'})).status,200)
  row=await f.wait(row.ticketNo,'待结果确认',ops)
  assert.equal(f.commands.filter(c=>c.action==='pause_share').length,2)
  assert.equal(f.commands.filter(c=>c.action==='dispose_dataset').length,2)
  assert.equal(new Set(f.commands.map(c=>c.executionId)).size,4)
  assert.equal((await f.request('/api/applications/transition',ops,{ticketNo:row.ticketNo,revision:row.revision,action:'确认结果',note:'逐对象查证'})).status,200)
})
