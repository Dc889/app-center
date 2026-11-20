import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startManagement} from '../../management/app/server/service.mjs'
import {listen,json} from '../../runtime/http.mjs'

test('资源选择代理按服务端会话转发身份与分页，不转发凭证或伪造范围',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'resource-selection-')),reads=[]
  const capability=await listen((req,res,path)=>{
    reads.push({path:req.url,headers:req.headers})
    if(path.endsWith('/workspaces'))return json(res,{items:[{workspaceId:'ws',name:'本人工作区',credential:'must-not-return'}],nextCursor:'next'})
    return json(res,{items:[],nextCursor:null})
  })
  const api=await startManagement({dir,token:'internal',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  assert.equal((await fetch(api.url+'/api/workspaces?product=dify')).status,403)
  const login=await fetch(api.url+'/api/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'chen.yu'})})
  const cookie=login.headers.get('set-cookie').split(';')[0]
  const get=path=>fetch(api.url+path,{headers:{cookie,'x-account':'li.qiang','x-role':'admin','x-org':'spoof'}})
  const response=await get('/api/workspaces?product=dify&cursor=page2&limit=50&account=li.qiang')
  assert.deepEqual(await response.json(),{items:[{workspaceId:'ws',name:'本人工作区'}],nextCursor:'next'})
  assert.equal(reads[0].path,'/internal/v1/workspaces?product=dify&cursor=page2&limit=50')
  assert.equal(reads[0].headers['x-account'],'chen.yu');assert.equal(reads[0].headers['x-role'],'user')
  assert.equal(reads[0].headers['x-subject-id'],'person-chen-yu')
  assert.equal(reads[0].headers['x-org'],encodeURIComponent('业务一部'))
  assert.equal(reads[0].headers.authorization,'Bearer internal')
  assert.equal((await get('/api/resources?kind=dify_app&workspaceId=ws&q=test&cursor=more&limit=25&account=li.qiang')).status,200)
  assert.equal(reads[1].path,'/internal/v1/resources?kind=dify_app&workspaceId=ws&q=test&cursor=more&limit=25')
  for(const path of ['/api/workspaces?product=other','/api/workspaces?product=dify&limit=101','/api/resources?kind=dify_app&limit=0'])assert.equal((await get(path)).status,400)
  assert.equal(reads.length,2)
})

test('工作区目录不完整时失败，不生成可选项或执行命令',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'workspace-selection-'))
  const capability=await listen((req,res)=>json(res,{items:[{workspaceId:'ws'}],nextCursor:null}))
  const api=await startManagement({dir,token:'internal',executor:capability.url})
  t.after(async()=>{await api.close();await capability.close();await rm(dir,{recursive:true,force:true})})
  const login=await fetch(api.url+'/api/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'chen.yu'})})
  const response=await fetch(api.url+'/api/workspaces?product=dify',{headers:{cookie:login.headers.get('set-cookie').split(';')[0]}})
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,'INVALID_WORKSPACE_DIRECTORY')
})
