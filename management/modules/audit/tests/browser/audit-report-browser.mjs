import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {ledger,listen,json} from '../../../../../runtime/http.mjs'

const dir=await mkdtemp(join(tmpdir(),'audit-report-browser-'))
process.env.APP_DATA_DIR=dir
let browser,server,cap,posts=0
try {
  const now=Date.now(),at=m=>new Date(now-m*60000).toISOString()
  const freshAsOf=new Date(now-30000).toISOString(),staleAsOf=new Date(now-600000).toISOString()

  const events=ledger(dir,'reported-events')
  events.put('EVT-01-ops-live',{ticketNo:'EVT-01-ops-live',resourceId:'plugin-ops',objectType:'插件',status:'未研判',revision:1,history:[
    {at:at(15),actor:'zhou.min',org:'平台运营组',actorRole:'operator',actorSubjectId:'person-zhou-min',actorRevision:1,actorSource:'session_snapshot',action:'人工报告',sourceIp:'10.24.8.16'},
  ]})
  events.put('EVT-01-other-live',{ticketNo:'EVT-01-other-live',resourceId:'plugin-other',objectType:'插件',status:'未研判',revision:1,history:[
    {at:at(14),actor:'chen.yu',org:'业务一部',actorRole:'user',actorSubjectId:'person-chen-yu',actorRevision:1,actorSource:'session_snapshot',action:'人工报告',sourceIp:'10.24.16.72'},
  ]})
  events.close()

  const idb=ledger(dir,'identity-workflows')
  idb.put('ticket:ACC-01-browser',{kind:'account-ticket',ticketNo:'ACC-01-browser',ticketType:'ACC-01',subjectId:'person-chen-yu',status:'待受理',history:[
    {at:at(13),actor:'li.qiang',org:'平台运营组',actorRole:'admin',actorSubjectId:'person-li-qiang',actorRevision:1,actorSource:'session_snapshot',action:'提交账号申请',sourceIp:'10.24.1.9'},
  ]})
  idb.close()

  let mode='full'
  cap=await listen((req,res,path)=>{
    if(req.method==='POST')posts++
    if(path!=='/internal/v1/observations' || mode==='missing')return json(res,{error:{code:'NOT_FOUND'}},404)
    const q=new URL(req.url,'http://localhost').searchParams,source=q.get('source')
    if(source==='execution')return json(res,{availability:'collected',asOf:freshAsOf,nextCursor:null,items:[
      {eventId:'ex-poll',occurredAt:at(12),source:'execution',resourceId:'app-ops',workspaceId:'ws-1',outcome:'pending',data:{executionId:'exe-ops-1',ticketNo:'AG-02-ops',ticketType:'AG-02',org:'平台运营组',action:'publish'}},
      {eventId:'ex-1',occurredAt:at(11),source:'execution',resourceId:'app-ops',workspaceId:'ws-1',outcome:'success',data:{executionId:'exe-ops-1',ticketNo:'AG-02-ops',ticketType:'AG-02',org:'平台运营组',action:'publish',account:'zhou.min'}},
      {eventId:'ex-acc',occurredAt:at(10),source:'execution',resourceId:'person-chen-yu',workspaceId:null,outcome:'success',data:{executionId:'exe-acc-1',ticketNo:'ACC-01-browser',ticketType:'ACC-01',org:'平台运营组',action:'apply_account_change',account:'li.qiang'}},
    ]})
    if(source==='skill_delivery')return json(res,{availability:'collected',asOf:staleAsOf,nextCursor:null,items:[
      {eventId:'dl-1',occurredAt:at(9),source:'skill_delivery',resourceId:'skl-ops',workspaceId:null,outcome:'success',data:{executionId:'exe-dl-ops',ticketNo:'SKL-03-ops',ticketType:'SKL-03',org:'平台运营组',account:'zhou.min',downloadIp:'10.24.8.16'}},
      {eventId:'dl-dup',occurredAt:at(8),source:'skill_delivery',resourceId:'skl-ops',workspaceId:null,outcome:'success',data:{executionId:'exe-dl-ops',ticketNo:'SKL-03-ops',ticketType:'SKL-03',org:'平台运营组',account:'zhou.min',downloadIp:'10.24.8.16'}},
    ]})
    if(source==='external_api')return json(res,{availability:'collected',asOf:freshAsOf,nextCursor:null,items:[
      {eventId:'ext-ops',occurredAt:at(7),source:'external_api',resourceId:'app-ops',workspaceId:'ws-1',outcome:'success',data:{registrationId:'reg-ops-1',callerName:'运营外部调用',callerOrg:'平台运营组',sourceIp:'10.10.1.1',path:'/v1/run?api_key=SECRET',appId:'app-ops',runId:'run-shared-1',latencyMs:95,httpStatus:200,traceId:'NO-TRACE'}},
      {eventId:'ext-other',occurredAt:at(6),source:'external_api',resourceId:'app-other',workspaceId:'ws-2',outcome:'success',data:{registrationId:'reg-other-1',callerName:'业务外部调用',callerOrg:'业务一部',sourceIp:'10.10.2.2',path:'/v1/run',appId:'app-other',runId:'run-other-1',latencyMs:105,httpStatus:200}},
    ]})
    if(source==='dify_run')return json(res,{availability:'collected',asOf:freshAsOf,nextCursor:null,items:[
      {eventId:'web-dup',occurredAt:at(7),source:'dify_run',resourceId:'app-ops',workspaceId:'ws-1',outcome:'success',data:{callerKind:'web',account:'zhou.min',org:'平台运营组',runId:'run-shared-1',httpStatus:200}},
      {eventId:'web-ops',occurredAt:at(5),source:'dify_run',resourceId:'app-ops',workspaceId:'ws-1',outcome:'success',data:{callerKind:'web',account:'zhou.min',org:'平台运营组',sourceIp:'10.24.8.16',path:'/web/chat',appId:'app-ops',runId:'run-web-ops',latencyMs:66,httpStatus:200}},
    ]})
    return json(res,{availability:'not_collected',asOf:null,nextCursor:null,items:[]})
  })
  process.env.CAPABILITY_URL=cap.url

  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const login=async role=>{const p=await browser.newPage();p.setDefaultTimeout(15000);await p.goto(server.resolvedUrls.local[0]);await p.getByRole('button',{name:new RegExp('^'+role)}).click();return p}

  // 1) 运维人员：仅见本组织非 ACC，验证六区块、过期标记、目录变更未采集、双表导出同权限范围
  const ops=await login('运维人员')
  await ops.getByRole('button',{name:'审计追踪',exact:true}).click()
  const root=ops.getByTestId('audit-report')
  await expect(root.getByRole('heading',{name:'管理端审计记录',exact:true})).toBeVisible()
  await expect(root.getByRole('heading',{name:'访问审计记录',exact:true})).toBeVisible()
  const metrics=root.getByTestId('audit-metrics')
  await expect(metrics.getByText('目录变更',{exact:true})).toBeVisible()
  await expect(metrics.locator('article').nth(0).locator('strong')).toHaveText('1') // 今日本地工单动作
  await expect(metrics.locator('article').nth(1).locator('strong')).toHaveText('1') // API执行（排除ACC和pending）
  await expect(metrics.locator('article').nth(2).locator('strong')).toHaveText('未采集') // 目录变更
  await expect(metrics.locator('article').nth(3).locator('strong')).toHaveText('1') // 下载（去重且标过期）
  await expect(metrics.locator('article').nth(3)).toContainText('数据已过期')
  await expect(metrics.locator('article').nth(4).locator('strong')).toHaveText('2') // 访问（外部API + 广场Web，排除双源重复）
  const pageText=await root.innerText()
  assert.ok(!pageText.includes('ACC-01-browser') && !pageText.includes('EVT-01-other-live') && !pageText.includes('reg-other-1') && !pageText.includes('NO-TRACE') && !pageText.includes('SECRET'))

  // 管理审计导出与访问审计导出均限于本组织非ACC
  let dl=ops.waitForEvent('download')
  await root.getByRole('button',{name:'导出当前筛选',exact:true}).click()
  const opsMgmtExport=JSON.parse(await readFile(await(await dl).path(),'utf8'))
  assert.equal(opsMgmtExport.length,3) // 1本地 + 1能力执行 + 1Skill交付
  assert.ok(!JSON.stringify(opsMgmtExport).includes('ACC-01') && !JSON.stringify(opsMgmtExport).includes('EVT-01-other-live'))

  dl=ops.waitForEvent('download')
  await root.getByRole('button',{name:'导出访问审计',exact:true}).click()
  const opsAccessExport=JSON.parse(await readFile(await(await dl).path(),'utf8'))
  assert.equal(opsAccessExport.length,2)
  assert.ok(!JSON.stringify(opsAccessExport).includes('reg-other-1'))

  // 2) 能力源缺失时：刷新后明确显示未采集，不伪造0
  mode='missing'
  await root.getByRole('button',{name:'刷新',exact:true}).click()
  await expect(metrics.locator('article').nth(1).locator('strong')).toHaveText('未采集')
  await expect(metrics.locator('article').nth(3).locator('strong')).toHaveText('未采集')
  await expect(metrics.locator('article').nth(4).locator('strong')).toHaveText('未采集')
  await expect(root.getByTestId('audit-distribution')).toContainText('执行：未采集')
  await expect(root.getByTestId('audit-distribution')).toContainText('下载：未采集')
  await expect(root.getByTestId('audit-distribution')).toContainText('访问：未采集')

  // 3) 系统管理员：可见全分区含ACC与他组织；检查访问审计两类字段规范和筛选
  mode='full'
  const admin=await login('系统管理员')
  await admin.getByRole('button',{name:'审计追踪',exact:true}).click()
  const adminRoot=admin.getByTestId('audit-report')
  await expect(adminRoot.getByTestId('audit-management-table')).toContainText('ACC-01-browser')
  await expect(adminRoot.getByTestId('audit-management-table')).toContainText('EVT-01-other-live')
  await expect(adminRoot.getByTestId('audit-access-table')).toContainText('reg-other-1')
  const extTr=adminRoot.getByTestId('audit-access-table').locator('tbody tr').filter({hasText:'reg-ops-1'})
  await expect(extTr.locator('td').nth(3)).toHaveText('—')
  await expect(extTr.locator('td').nth(4)).toHaveText('—')
  const webTr=adminRoot.getByTestId('audit-access-table').locator('tbody tr').filter({hasText:'run-web-ops'})
  await expect(webTr.locator('td').nth(5)).toHaveText('—')
  await expect(webTr.locator('td').nth(6)).toHaveText('—')

  // 来源筛选 + 关键字搜索同步更新汇总与导出
  await adminRoot.getByLabel('审计来源',{exact:true}).selectOption('外部API')
  await expect(adminRoot.getByTestId('audit-access-table')).toContainText('共 2 条访问记录')
  await adminRoot.getByLabel('搜索审计记录',{exact:true}).fill('reg-other-1')
  await expect(adminRoot.getByTestId('audit-access-table')).toContainText('共 1 条访问记录')
  dl=admin.waitForEvent('download')
  await adminRoot.getByRole('button',{name:'导出访问审计',exact:true}).click()
  const filteredAccess=JSON.parse(await readFile(await(await dl).path(),'utf8'))
  assert.equal(filteredAccess.length,1);assert.equal(filteredAccess[0].keyRegistrationId,'reg-other-1')

  // 4) 普通用户无入口且接口403
  const user=await login('用户')
  await expect(user.getByRole('button',{name:'审计追踪',exact:true})).toHaveCount(0)
  assert.equal((await user.request.get(server.resolvedUrls.local[0]+'api/audit-report')).status(),403)
  assert.equal(posts,0)
  console.log('PASS Edge: 审计追踪六区块、运维/管理员同口径汇总与双表导出、未采集/过期标注、双源/重复下载去重及普通用户拒绝通过')
}finally{
  await browser?.close();await server?.close();await cap?.close();await rm(dir,{recursive:true,force:true})
}
