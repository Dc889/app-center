import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen,ledger} from '../../../../../runtime/http.mjs'
import {overviewFixture} from '../../../../../tests/support/overview.mjs'
const dir=await mkdtemp(join(tmpdir(),'overview-browser-'))
process.env.APP_DATA_DIR=dir
let browser,server,cap,mode='missing'
const ranges=[]
try {
  const events=ledger(dir,'reported-events');events.put('EVT-01-live',{ticketNo:'EVT-01-live',objectType:'插件',resourceId:'live-plugin',status:'未研判',creationMode:'系统告警',originalSeverity:'严重',history:[{at:new Date().toISOString(),actor:'zhou.min',action:'真实管理事件'}]});events.close()
  const ids=ledger(dir,'identity-workflows');ids.put('ticket:ACC-secret',{kind:'account-ticket',ticketNo:'ACC-secret',ticketType:'ACC-01',status:'待受理',history:[{at:new Date().toISOString(),actor:'li.qiang',action:'账号私有事件'}]});ids.close()
  cap=await listen((req,res,path)=>{
    if(path!=='/internal/v1/overview-summary' || mode==='missing')return json(res,{error:{code:'NOT_FOUND'}},404)
    const q=new URL(req.url,'http://localhost').searchParams;ranges.push(q.get('range'))
    const window={from:q.get('from'),to:q.get('to'),bucketMs:Number(q.get('bucketMs'))},raw=overviewFixture(window)
    raw.resources.data[0].count=17;raw.resources.data[0].yesterdayCount=15
    raw.resources.data[1]={key:'datasets',state:'unavailable',count:null,yesterdayCount:null}
    raw.health.data[0].evidenceRef='management-probe-test'
    raw.health.data[1]={key:'ragflow',status:'unavailable',instance:null,version:null,checkedAt:null,latencyMs:null,consecutiveFailures:null,evidenceRef:null}
    if(mode==='stale')raw.health.capturedAt='2020-01-01T00:00:00Z'
    if(mode==='broken')raw.calls.data.pop()
    return json(res,raw)
  })
  process.env.CAPABILITY_URL=cap.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  async function login(role){const p=await browser.newPage();p.setDefaultTimeout(15000);await p.goto(server.resolvedUrls.local[0]);await p.getByRole('button',{name:new RegExp('^'+role)}).click();return p}
  const ops=await login('运维人员'),root=ops.getByTestId('real-overview')
  await expect(root.getByRole('heading',{name:'当前未关闭告警：1'})).toBeVisible()
  await expect(root.getByText('真实管理事件',{exact:true})).toBeVisible();await expect(root.getByText('账号私有事件',{exact:true})).toHaveCount(0)
  await expect(root.locator('.metric-card').first()).toContainText('未采集');await expect(ops.getByText('服务运行正常',{exact:true})).toHaveCount(0)
  mode='ok';await root.getByRole('button',{name:'刷新总览',exact:true}).click();await expect(root.locator('.metric-card').first()).toContainText('17');await expect(root.locator('.metric-card').first()).toContainText('+2 较昨日')
  await expect(root.locator('.metric-card').nth(1)).toContainText('未采集')
  await root.getByRole('button',{name:'查看探测依据',exact:true}).first().click();await expect(root.getByText('探测依据编号：management-probe-test',{exact:true})).toBeVisible()
  mode='broken';await root.getByRole('button',{name:'近 1 小时',exact:true}).click();await expect(root.getByText('未采集，暂无可展示的趋势；不以零曲线替代。',{exact:true})).toHaveCount(1)
  mode='stale';await root.getByRole('button',{name:'近 7 天',exact:true}).click();await expect(root.getByText(/数据已过期，仅供参考/)).toBeVisible();assert.ok(ranges.includes('1h') && ranges.includes('7d'))
  const admin=await login('系统管理员');await expect(admin.getByTestId('real-overview').getByText('账号私有事件',{exact:true})).toBeVisible();await expect(admin.getByTestId('real-overview').getByText(/账号配置未办结：1/)).toBeVisible()
  const user=await login('用户');await expect(user.getByTestId('real-overview')).toHaveCount(0)
  console.log('PASS Edge: 总览真实台账、角色隔离、未采集与零、日差、独立健康缺采集、探测依据、趋势窗口、不完整趋势和过期标记')
}finally{await browser?.close();await server?.close();await cap?.close();await rm(dir,{recursive:true,force:true})}
