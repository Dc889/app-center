import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json} from '../../../../../runtime/http.mjs'
test('处置候选/完整清单按身份核验，嵌套字段裁剪，拒绝歧义修订和不可执行文档',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'disposition-selection-')),reads=[]
  let mode='',allowed=true
  const secret='PRIVATE-DOCUMENT-OR-CREDENTIAL'
  const capability=await listen(async(req,res,path)=>{
    reads.push({url:req.url,account:req.headers['x-account']})
    if(path.endsWith('/candidates'))return json(res,{items:[{resourceId:'kb',name:'知识库',source:'RAGFlow',sourceScopeId:'tenant',sourceResourceId:'source',secret}],nextCursor:mode==='cursor'?undefined:null})
    if(path.includes('/execution-contexts/KB-05'))return json(res,{snapshotId:'context',ticketType:'KB-05',action:'dispose_dataset',resourceId:'kb',eligible:allowed,
      fields:{'知识库名称':'知识库','来源系统':'RAGFlow','源workspace/tenant ID':'tenant','源知识库ID':'source','文档清单快照ID':'manifest','清单完整':mode!=='partial',
        '文档清单':[{documentId:'doc,1',sha256:'a'.repeat(64),body:secret},{documentId:'unsupported',sha256:'b'.repeat(64),secret}],
        '影响中的授权数':mode==='count'?-1:0,'影响中的智能体数':0,
        '处置目标清单':[{system:'RAGFlow',objectId:'product-doc',documentId:'doc,1',action:'停用文档',secret},...mode==='target'?[{system:'RAGFlow',objectId:'product-doc',documentId:'doc,1',action:'停用文档'}]:[]],secret},
      preconditions:[{kind:'dataset',id:'kb',revision:mode==='negative'?-1:1},...mode==='duplicate'?[{kind:'dataset',id:'kb',revision:1}]:[],{kind:'dataset_manifest',id:'manifest',sha256:'c'.repeat(64)}]})
    return json(res,{error:{code:'NOT_FOUND'}},404)
  })
  const api=await startManagement({dir,token:'test',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const request=(path,cookie,data)=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json','x-account':'li.qiang'},body:data?JSON.stringify(data):undefined})
  const session=await request('/api/demo-session','',{account:'chen.yu'}),user=session.headers.get('set-cookie').split(';')[0]
  const list='/api/execution-candidates?ticketType=KB-05&action=dispose_dataset'
  assert.equal((await request(list,'')).status,403)
  const candidates=await request(list+'&account=li.qiang',user);assert.equal(candidates.status,200);assert.ok(!JSON.stringify(await candidates.json()).includes(secret));assert.equal(reads[0].account,'chen.yu');assert.ok(!reads[0].url.includes('account='))
  assert.equal((await request(list.replace('dispose_dataset','pause_share'),user)).status,400)
  mode='cursor';assert.equal((await request(list,user)).status,503);mode=''
  const preview='/api/execution-contexts?ticketType=KB-05&action=dispose_dataset&resourceId=kb'
  const response=await request(preview,user);assert.equal(response.status,200);const data=await response.json();assert.ok(!JSON.stringify(data).includes(secret));assert.equal(data.fields['处置目标清单'],undefined);assert.deepEqual(data.disposableDocumentIds,['doc,1'])
  for(const failure of ['partial','count','negative','duplicate','target']){mode=failure;assert.equal((await request(preview,user)).status,409,failure)}
  mode='';allowed=false;assert.equal((await request(preview,user)).status,403);allowed=true
  const input={ticketNo:'KB-05-selected',ticketType:'KB-05',resourceId:'kb',fields:{target:'指定文档',documentIds:['unsupported'],reason:'主动下架',facts:'停止使用',secret}}
  assert.equal((await request('/api/applications',user,input)).status,409)
  input.fields.documentIds=['doc,1'];const submitted=await request('/api/applications',user,input);assert.equal(submitted.status,201);const row=await submitted.json();assert.ok(!JSON.stringify(row).includes(secret));assert.deepEqual(row.submission.fields.documentIds,['doc,1']);assert.equal(row.evidenceRefs.length,0)
})
