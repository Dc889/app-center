import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {auditReport} from '../../server/audit-report.mjs'
import {startManagement} from '../../../../app/server/service.mjs'
import {listen,json,ledger} from '../../../../../runtime/http.mjs'

const now=Date.parse('2026-11-19T02:00:00Z')
const at=minutes=>new Date(now-minutes*60000).toISOString()
const adminUser={account:'li.qiang',subjectId:'person-li-qiang',org:'信息科',roles:['admin'],active:true,profileRevision:1}
const opsUser={account:'zhou.min',subjectId:'person-zhou-min',org:'平台运营组',roles:['operator'],active:true,profileRevision:1}

function makeCap(pagesBySource) {
  return async path=>{
    const u=new URL(path,'http://localhost')
    const source=u.searchParams.get('source'),cursor=u.searchParams.get('cursor') ?? ''
    assert.equal(u.searchParams.get('view'),'audit')
    const spec=pagesBySource[source]
    if(!spec)throw Object.assign(Error('NOT_FOUND'),{status:404,code:'NOT_FOUND'})
    const payload=typeof spec==='function'?spec(cursor,u.searchParams):spec[cursor] ?? spec
    return {json:async()=>payload}
  }
}

test('审计汇总区分来源、排除重复下载/轮询/双源运行，不从工单推算能力指标，并校验过期/损坏降级与非法查询',async()=>{
  const records=()=>({
    drafts:[],
    types:[],
    accounts:[],
    events:[{
      ticketNo:'EVT-01-1',resourceId:'plugin-a',history:[
        {at:at(180),actor:'zhou.min',org:'平台运营组',actorRole:'operator',actorSubjectId:'person-zhou-min',actorRevision:1,actorSource:'session_snapshot',action:'人工报告',sourceIp:'10.1.1.2'},
        {at:at(20),actor:'zhou.min',org:'平台运营组',actorRole:'operator',actorSubjectId:'person-zhou-min',actorRevision:1,actorSource:'session_snapshot',action:'开始处置',note:'排查日志'},
      ],
    }],
    tickets:[{
      ticketNo:'SKL-03-1',command:{executionId:'exe-dl-1',ticketNo:'SKL-03-1',ticketType:'SKL-03',resourceId:'skl-1',account:'chen.yu',org:'业务一部',action:'download'},
      history:[
        {at:at(30),actor:'chen.yu',org:'业务一部',actorRole:'user',actorSubjectId:'person-chen-yu',actorRevision:1,actorSource:'session_snapshot',action:'提交执行申请'},
        {at:at(29),actor:'system',org:'系统服务',actorRole:'system',actorSubjectId:'service:system',actorRevision:null,actorSource:'service',action:'执行状态 succeeded'},
        {at:at(28),actor:'system',org:'系统服务',actorRole:'system',actorSubjectId:'service:system',actorRevision:null,actorSource:'service',action:'确认文件回执'},
      ],
    }],
    applications:[{
      ticketNo:'KEY-01-1',ticketType:'KEY-01',submission:{resourceId:'app-1'},
      history:[{at:at(25),actor:'chen.yu',org:'业务一部',actorRole:'user',actorSubjectId:'person-chen-yu',actorRevision:1,actorSource:'session_snapshot',action:'一次性领取密钥'}],
    }],
  })

  // 1) 能力源未接入时，绝不从本地工单动作（执行状态/确认文件回执/一次性领取密钥）推算API、下载、访问或目录变更
  const missing=await auditReport({query:new URLSearchParams('range=1h'),now,cap:makeCap({}),headers:{},identity:adminUser,records})
  assert.equal(missing.metrics.workflow.count,5)
  assert.equal(missing.metrics.workflow.todayCount,6) // 不被 1h 截断，包含 180 分钟前今日动作
  for(const k of ['api','catalog','download','access']){
    assert.equal(missing.metrics[k].availability,'not_collected')
    assert.equal(missing.metrics[k].count,null)
  }
  assert.ok(missing.trend.every(p=>p.api===null && p.catalog===null && p.download===null && p.access===null))
  assert.equal(missing.distribution.find(d=>d.category==='执行').count,null)
  assert.equal(missing.distribution.find(d=>d.category==='下载').count,null)
  assert.equal(missing.distribution.find(d=>d.category==='访问').count,null)
  // 切换仅筛选本地来源时，未采集能力源不能伪装成 0
  const localOnly=await auditReport({query:new URLSearchParams('range=24h&source=执行工单'),now,cap:makeCap({}),headers:{},identity:adminUser,records})
  assert.equal(localOnly.metrics.api.availability,'not_collected');assert.equal(localOnly.metrics.api.count,null)
  assert.equal(localOnly.metrics.download.availability,'not_collected');assert.equal(localOnly.metrics.download.count,null)

  // 2) 能力源已采集：分页、去重（重复下载/轮询pending/双源runId）、过期标记、脱敏裁剪、操作者排行排除系统与运行调用
  const freshAsOf=new Date(now-60000).toISOString(),staleAsOf=new Date(now-600000).toISOString()
  const cap=makeCap({
    execution:{
      '':{availability:'collected',asOf:freshAsOf,nextCursor:'p2',items:[
        {eventId:'ex-poll',occurredAt:at(15),source:'execution',resourceId:'app-1',workspaceId:'ws-1',outcome:'pending',data:{executionId:'exe-1',ticketNo:'AG-02-1',ticketType:'AG-02',org:'平台运营组',action:'publish'}},
        {eventId:'ex-old',occurredAt:at(14),source:'execution',resourceId:'app-1',workspaceId:'ws-1',outcome:'failure',data:{executionId:'exe-1',ticketNo:'AG-02-1',ticketType:'AG-02',org:'平台运营组',action:'publish',failureCode:'TEMP'}},
      ]},
      p2:{availability:'collected',asOf:freshAsOf,nextCursor:null,items:[
        {eventId:'ex-final',occurredAt:at(12),source:'execution',resourceId:'app-1',workspaceId:'ws-1',outcome:'success',data:{executionId:'exe-1',ticketNo:'AG-02-1',ticketType:'AG-02',org:'平台运营组',action:'publish',account:'zhou.min'}},
      ]},
    },
    skill_delivery:{availability:'collected',asOf:staleAsOf,nextCursor:null,items:[
      {eventId:'dl-pending',occurredAt:at(29),source:'skill_delivery',resourceId:'skl-1',workspaceId:null,outcome:'pending',data:{executionId:'exe-dl-1',ticketNo:'SKL-03-1',org:'业务一部',account:'chen.yu'}},
      {eventId:'dl-1',occurredAt:at(28),source:'skill_delivery',resourceId:'skl-1',workspaceId:null,outcome:'success',data:{executionId:'exe-dl-1',ticketNo:'SKL-03-1',org:'业务一部',account:'chen.yu',downloadIp:'10.2.3.4'}},
      {eventId:'dl-dup',occurredAt:at(27),source:'skill_delivery',resourceId:'skl-1',workspaceId:null,outcome:'success',data:{executionId:'exe-dl-1',ticketNo:'SKL-03-1',org:'业务一部',account:'chen.yu',downloadIp:'10.2.3.4'}},
    ]},
    external_api:{availability:'collected',asOf:freshAsOf,nextCursor:null,items:[
      {eventId:'ext-poll',occurredAt:at(11),source:'external_api',resourceId:'app-1',workspaceId:'ws-1',outcome:'pending',data:{registrationId:'reg-1',callerName:'外呼系统',callerOrg:'平台运营组',runId:'run-shared'}},
      {eventId:'ext-1',occurredAt:at(10),source:'external_api',resourceId:'app-1',workspaceId:'ws-1',outcome:'success',data:{registrationId:'reg-1',callerName:'外呼系统',callerOrg:'平台运营组',sourceIp:'10.8.8.8',path:'/v1/chat?api_key=SECRET',appId:'app-1',runId:'run-shared',latencyMs:120,httpStatus:200,traceId:'FORBIDDEN-TRACE',modelCenterIdentity:'FORBIDDEN-MC',secret:'SECRET'}},
      {eventId:'ext-dup-run',occurredAt:at(9),source:'external_api',resourceId:'app-1',workspaceId:'ws-1',outcome:'success',data:{registrationId:'reg-1',callerName:'外呼系统',callerOrg:'平台运营组',sourceIp:'10.8.8.8',path:'/v1/chat',appId:'app-1',runId:'run-shared',latencyMs:130,httpStatus:200}},
    ]},
    dify_run:{availability:'collected',asOf:freshAsOf,nextCursor:null,items:[
      {eventId:'run-api-dup',occurredAt:at(10),source:'dify_run',resourceId:'app-1',workspaceId:'ws-1',outcome:'success',data:{callerKind:'external_api',account:'chen.yu',org:'平台运营组',runId:'run-shared'}},
      {eventId:'run-mislabeled-dup',occurredAt:at(9),source:'dify_run',resourceId:'app-1',workspaceId:'ws-1',outcome:'success',data:{callerKind:'web',account:'zhou.min',org:'平台运营组',runId:'run-shared'}},
      {eventId:'run-web-poll',occurredAt:at(8),source:'dify_run',resourceId:'app-1',workspaceId:'ws-1',outcome:'pending',data:{callerKind:'web',account:'zhou.min',org:'平台运营组',runId:'run-web-1'}},
      {eventId:'run-web-1',occurredAt:at(7),source:'dify_run',resourceId:'app-1',workspaceId:'ws-1',outcome:'success',data:{callerKind:'web',account:'zhou.min',org:'平台运营组',sourceIp:'10.9.9.9',path:'/web/run?token=SECRET',appId:'app-1',runId:'run-web-1',latencyMs:85,httpStatus:200,traceId:'FORBIDDEN-TRACE'}},
    ]},
  })

  const full=await auditReport({query:new URLSearchParams('range=24h'),now,cap,headers:{},identity:adminUser,records})
  assert.equal(full.metrics.workflow.count,6)
  assert.equal(full.metrics.api.availability,'collected');assert.equal(full.metrics.api.count,1)
  assert.equal(full.metrics.download.availability,'stale');assert.equal(full.metrics.download.count,1)
  assert.equal(full.metrics.catalog.availability,'not_collected');assert.equal(full.metrics.catalog.count,null)
  assert.equal(full.metrics.access.availability,'collected');assert.equal(full.metrics.access.count,2)
  assert.equal(full.managementTotal,8) // 6 本地 + 1 执行 + 1 下载
  assert.equal(full.accessTotal,2)     // 1 外部API + 1 广场Web（双源 run-shared 去重）
  assert.equal(full.trend.reduce((s,p)=>s+p.workflow,0),6)
  assert.equal(full.trend.reduce((s,p)=>s+p.api,0),1)
  assert.equal(full.trend.reduce((s,p)=>s+p.download,0),1)
  assert.equal(full.trend.reduce((s,p)=>s+p.access,0),2)
  assert.equal(full.distribution.find(d=>d.category==='执行').count,1)
  assert.equal(full.distribution.find(d=>d.category==='下载').count,1)
  assert.equal(full.distribution.find(d=>d.category==='访问').count,2)
  // 操作者排行仅统计本地人工操作，排除 system 与能力/运行调用
  assert.deepEqual(full.ranking,[{actor:'chen.yu',count:2},{actor:'zhou.min',count:2}])
  // 访问审计白名单：外部API无账户/用户组织，广场Web无密钥字段，URL去参数，不含traceId/modelCenterIdentity/SECRET
  const extRow=full.accessItems.find(r=>r.mode==='外部API'),webRow=full.accessItems.find(r=>r.mode==='广场Web')
  assert.equal(extRow.account,null);assert.equal(extRow.org,null);assert.equal(extRow.keyRegistrationId,'reg-1');assert.equal(extRow.callerOrg,'平台运营组');assert.equal(extRow.path,'/v1/chat')
  assert.equal(webRow.account,'zhou.min');assert.equal(webRow.keyRegistrationId,null);assert.equal(webRow.callerName,null);assert.equal(webRow.path,'/web/run')
  const serialized=JSON.stringify(full)
  assert.ok(!serialized.includes('FORBIDDEN-TRACE') && !serialized.includes('FORBIDDEN-MC') && !serialized.includes('SECRET'))

  // 3) 损坏数据（游标循环/事件冲突/未来asOf）降级为 not_collected，不污染结果
  const badCap=makeCap({
    execution:{'':{availability:'collected',asOf:freshAsOf,nextCursor:'loop',items:[]},loop:{availability:'collected',asOf:freshAsOf,nextCursor:'loop',items:[]}},
    skill_delivery:{availability:'collected',asOf:new Date(now+60000).toISOString(),nextCursor:null,items:[]},
    external_api:{availability:'collected',asOf:freshAsOf,nextCursor:null,items:[
      {eventId:'same',occurredAt:at(5),source:'external_api',resourceId:'a',workspaceId:null,outcome:'success',data:{callerOrg:'平台运营组',httpStatus:200}},
      {eventId:'same',occurredAt:at(5),source:'external_api',resourceId:'a',workspaceId:null,outcome:'failure',data:{callerOrg:'平台运营组',httpStatus:500}},
    ]},
    dify_run:{availability:'collected',asOf:freshAsOf,nextCursor:null,items:[
      {eventId:'out-of-window',occurredAt:new Date(now+10000).toISOString(),source:'dify_run',resourceId:'a',workspaceId:null,outcome:'success',data:{callerKind:'web'}},
    ]},
  })
  const degraded=await auditReport({query:new URLSearchParams('range=24h'),now,cap:badCap,headers:{},identity:adminUser,records})
  for(const k of ['execution','skill_delivery','external_api','dify_run']){
    assert.equal(degraded.sources[k].availability,'not_collected')
    assert.equal(degraded.sources[k].reasonCode,'INVALID_SOURCE_DATA')
  }
  assert.equal(degraded.accessTotal,0)

  // 4) Asia/Shanghai 零点边界
  const midnight=Date.parse('2026-11-18T16:00:00Z')
  const dayRecs=()=>({drafts:[],types:[],tickets:[],applications:[],accounts:[],events:[{
    ticketNo:'EVT-01-day',resourceId:'p',history:[
      {at:'2026-11-18T15:59:59.000Z',actor:'zhou.min',org:'平台运营组',actorRole:'operator',action:'人工报告'},
      {at:'2026-11-18T16:00:00.000Z',actor:'zhou.min',org:'平台运营组',actorRole:'operator',action:'开始处置'},
    ],
  }]})
  const boundary=await auditReport({query:new URLSearchParams('range=24h'),now:midnight,cap:makeCap({}),headers:{},identity:opsUser,records:dayRecs})
  assert.equal(boundary.metrics.workflow.count,2)
  assert.equal(boundary.metrics.workflow.todayCount,1)

  // 5) 非法查询参数均 400
  for(const qs of ['range=forever','source=不存在','page=0','accessPage=1.5','limit=101','from=2026-11-19T02:00:00Z&to=2026-11-19T01:00:00Z','from=2026-09-01T00:00:00Z&to=2026-11-19T00:00:00Z','from=2026-11-19T01:00:00Z&to=2026-11-19T03:00:00Z']) {
    await assert.rejects(()=>auditReport({query:new URLSearchParams(qs),now,cap:makeCap({}),headers:{},identity:adminUser,records}),e=>e.status===400)
  }
})

test('审计追踪与导出先按角色/组织过滤再汇总分页，隔离ACC、拒绝普通用户、防会话变更越权且重启保留',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'audit-report-'))
  const baseNow=Date.parse('2026-11-19T02:00:00Z'),ts=m=>new Date(baseNow-m*60000).toISOString()
  let pauseObs=null,api
  const cap=await listen(async(req,res,path)=>{
    if(path!=='/internal/v1/observations')return json(res,{error:{code:'NOT_FOUND'}},404)
    assert.ok(['operator','admin'].includes(req.headers['x-role']))
    if(pauseObs)await pauseObs()
    const q=new URL(req.url,'http://localhost').searchParams,source=q.get('source'),asOf=new Date(baseNow-30000).toISOString()
    if(source==='execution')return json(res,{availability:'collected',asOf,nextCursor:null,items:[
      {eventId:'ex-ops',occurredAt:ts(10),source:'execution',resourceId:'p-ops',workspaceId:'ws-1',outcome:'success',data:{executionId:'e1',ticketNo:'PLG-03-ops',ticketType:'PLG-03',org:'平台运营组',action:'install'}},
      {eventId:'ex-other',occurredAt:ts(9),source:'execution',resourceId:'p-other',workspaceId:'ws-2',outcome:'success',data:{executionId:'e2',ticketNo:'PLG-03-other',ticketType:'PLG-03',org:'业务一部',action:'install'}},
      {eventId:'ex-acc',occurredAt:ts(8),source:'execution',resourceId:'person-chen-yu',workspaceId:null,outcome:'success',data:{executionId:'e3',ticketNo:'ACC-01-secret',ticketType:'ACC-01',org:'平台运营组',action:'apply_account_change'}},
      {eventId:'ex-unknown-org',occurredAt:ts(7),source:'execution',resourceId:'p-u',workspaceId:null,outcome:'success',data:{executionId:'e4',ticketNo:'PLG-03-u',ticketType:'PLG-03',action:'install'}},
    ]})
    if(source==='skill_delivery')return json(res,{availability:'not_collected',asOf:null,nextCursor:null,items:[]})
    if(source==='dify_run')return json(res,{availability:'collected',asOf,nextCursor:null,items:[
      {eventId:'web-ops',occurredAt:ts(6),source:'dify_run',resourceId:'app-ops',workspaceId:'ws-1',outcome:'success',data:{callerKind:'web',account:'zhou.min',org:'平台运营组',runId:'r-ops',httpStatus:200,latencyMs:40}},
      {eventId:'web-other',occurredAt:ts(5),source:'dify_run',resourceId:'app-other',workspaceId:'ws-2',outcome:'success',data:{callerKind:'web',account:'chen.yu',org:'业务一部',runId:'r-other',httpStatus:200,latencyMs:50}},
    ]})
    if(source==='external_api')return json(res,{availability:'collected',asOf,nextCursor:null,items:[
      {eventId:'ext-ops',occurredAt:ts(4),source:'external_api',resourceId:'app-ops',workspaceId:'ws-1',outcome:'success',data:{registrationId:'reg-ops',callerName:'运营门户',callerOrg:'平台运营组',runId:'r-ext-ops',httpStatus:200,latencyMs:60}},
      {eventId:'ext-other',occurredAt:ts(3),source:'external_api',resourceId:'app-other',workspaceId:'ws-2',outcome:'success',data:{registrationId:'reg-other',callerName:'刑侦外部',callerOrg:'业务一部',runId:'r-ext-other',httpStatus:200,latencyMs:70}},
    ]})
    return json(res,{availability:'not_collected',asOf:null,nextCursor:null,items:[]})
  })
  api=await startManagement({dir,executor:cap.url,token:'test',now:()=>baseNow})
  t.after(async()=>{await api.close();await cap.close();await rm(dir,{recursive:true,force:true})})

  const req=(path,cookie,data,extra={})=>fetch(api.url+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json',...extra},body:data?JSON.stringify(data):undefined})
  const login=async account=>(await req('/api/demo-session','',{account})).headers.get('set-cookie').split(';')[0]
  const user=await login('chen.yu'),ops=await login('zhou.min'),admin=await login('li.qiang')

  // 写入不同组织的真实管理事件与账号配置台账
  const evStore=ledger(dir,'reported-events')
  evStore.put('EVT-01-ops',{ticketNo:'EVT-01-ops',resourceId:'p-ops',objectType:'插件',status:'未研判',revision:1,history:[
    {at:ts(20),actor:'zhou.min',org:'平台运营组',actorRole:'operator',actorSubjectId:'person-zhou-min',actorRevision:1,actorSource:'session_snapshot',action:'人工报告'},
  ]})
  evStore.put('EVT-01-other',{ticketNo:'EVT-01-other',resourceId:'p-other',objectType:'插件',status:'未研判',revision:1,history:[
    {at:ts(19),actor:'chen.yu',org:'业务一部',actorRole:'user',actorSubjectId:'person-chen-yu',actorRevision:1,actorSource:'session_snapshot',action:'人工报告'},
  ]})
  evStore.close()
  const accStore=ledger(dir,'identity-workflows')
  accStore.put('ticket:ACC-01-private',{kind:'account-ticket',ticketNo:'ACC-01-private',ticketType:'ACC-01',subjectId:'person-zhou-min',status:'待受理',history:[
    {at:ts(18),actor:'li.qiang',org:'平台运营组',actorRole:'admin',actorSubjectId:'person-li-qiang',actorRevision:1,actorSource:'session_snapshot',action:'提交账号申请'},
  ]})
  accStore.close()

  // 未登录/普通用户拒绝
  assert.equal((await req('/api/audit-report','')).status,403)
  assert.equal((await req('/api/audit-report',user)).status,403)
  assert.equal((await req('/api/audit-report/export?table=management',user)).status,403)
  assert.equal((await req('/api/audit-report/export?table=invalid',ops)).status,400)

  // 运维即使伪造 admin 头，也只能看见本组织（平台运营组）非 ACC 记录
  const opsReport=await(await req('/api/audit-report?range=24h&limit=1',ops,undefined,{'x-role':'admin','x-org':encodeURIComponent('业务一部')})).json()
  assert.equal(opsReport.scope,'org_non_account')
  assert.equal(opsReport.metrics.workflow.count,1)
  assert.equal(opsReport.metrics.api.count,1)
  assert.equal(opsReport.metrics.download.count,null)
  assert.equal(opsReport.metrics.access.count,2)
  assert.equal(opsReport.managementTotal,2)
  assert.equal(opsReport.managementItems.length,1) // limit=1 只影响分页，不影响汇总与导出
  assert.equal(opsReport.accessTotal,2)
  assert.deepEqual(opsReport.ranking,[{actor:'zhou.min',count:1}])
  assert.ok(!JSON.stringify(opsReport).includes('ACC-01') && !JSON.stringify(opsReport).includes('EVT-01-other') && !JSON.stringify(opsReport).includes('reg-other'))

  // 导出与报表同权限范围且不受分页截断
  const opsExportMgmt=await(await req('/api/audit-report/export?table=management&range=24h&limit=1',ops)).json()
  const opsExportAccess=await(await req('/api/audit-report/export?table=access&range=24h&limit=1',ops)).json()
  assert.equal(opsExportMgmt.length,2)
  assert.equal(opsExportAccess.length,2)
  assert.ok(!JSON.stringify(opsExportMgmt).includes('ACC-01') && !JSON.stringify(opsExportAccess).includes('r-other'))

  // 管理员可见全分区（含他组织与ACC）
  const adminReport=await(await req('/api/audit-report?range=24h',admin)).json()
  assert.equal(adminReport.scope,'partition_all')
  assert.equal(adminReport.metrics.workflow.count,3)
  assert.equal(adminReport.metrics.api.count,4)
  assert.equal(adminReport.metrics.access.count,4)
  assert.equal(adminReport.managementTotal,7)
  assert.ok(adminReport.managementItems.some(r=>r.ticketNo==='ACC-01-private'))
  assert.ok(adminReport.managementItems.some(r=>r.ticketNo==='ACC-01-secret'))
  const adminExportMgmt=await(await req('/api/audit-report/export?table=management&range=24h',admin)).json()
  assert.equal(adminExportMgmt.length,7)

  // 查询期间人员修订变更 -> 403 ACTOR_SESSION_CHANGED
  let mutated=false
  pauseObs=async()=>{
    if(mutated)return
    mutated=true
    const idb=ledger(dir,'identity-workflows')
    const p=idb.get('person:person-zhou-min')
    idb.put('person:person-zhou-min',{...p,org:'业务一部',revision:p.revision+1})
    idb.close()
  }
  assert.equal((await req('/api/audit-report?range=24h',ops)).status,403)
  pauseObs=null

  // 重启后本地审计与管理员汇总仍持久化可读
  await api.close()
  api=await startManagement({dir,executor:cap.url,token:'test',now:()=>baseNow})
  const adminAfter=await login('li.qiang')
  const afterRestart=await(await req('/api/audit-report?range=24h',adminAfter)).json()
  assert.equal(afterRestart.metrics.workflow.count,3)
  assert.equal(afterRestart.managementTotal,7)
})
