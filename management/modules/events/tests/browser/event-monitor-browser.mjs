import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {ledger,listen,json} from '../../../../../runtime/http.mjs'
const dir=await mkdtemp(join(tmpdir(),'event-monitor-browser-'))
process.env.APP_DATA_DIR=dir
let browser,server,cap,posts=0
try {
  const now=Date.now(),at=m=>new Date(now-m*60000).toISOString(),events=ledger(dir,'reported-events')
  for(let i=0;i<26;i++)events.put('EVT-01-old-'+i,{ticketNo:'EVT-01-old-'+i,alertId:'AL-old-'+i,resourceId:'old-'+i,objectType:'知识库',creationMode:'人工报告',status:'未研判',firstOccurredAt:at(120+i),originalSeverity:'一般',revision:1,history:[{at:at(120+i),actor:'chen.yu',action:'人工报告'}]})
  events.put('EVT-01-evidence',{ticketNo:'EVT-01-evidence',alertId:'AL-evidence',resourceId:'evidence-plugin',objectType:'插件',creationMode:'系统告警',status:'未研判',originalSeverity:'严重',firstOccurredAt:at(20),lastOccurredAt:at(1),revision:1,
    evidence:{metrics:{resourceId:'evidence-plugin',alertId:'AL-evidence',unit:'%',points:[{at:at(3),value:40,threshold:30},{at:at(2),value:45,threshold:30}]},logs:[{at:at(2),source:'plugin',level:'ERROR',resourceId:'evidence-plugin',redacted:true,message:'token=SECRET 调用超时'}]},history:[{at:at(20),actor:'system_event',action:'定向禁用失败升级紧急告警'}]})
  events.close()
  cap=await listen((req,res)=>{if(req.method==='POST')posts++;return json(res,{error:{code:'NOT_FOUND'}},404)})
  process.env.CAPABILITY_URL=cap.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  async function login(role){const p=await browser.newPage();p.setDefaultTimeout(15000);await p.goto(server.resolvedUrls.local[0]);await p.getByRole('button',{name:new RegExp('^'+role)}).click();return p}
  const ops=await login('运维人员');await ops.getByRole('button',{name:'安全事件',exact:true}).click()
  const root=ops.getByTestId('event-monitor')
  await expect(root.getByText('共27条；第1页。进行中时长为截至本次读取的历时。',{exact:true})).toBeVisible()
  await root.getByRole('button',{name:'下一页',exact:true}).click();await expect(root.getByText(/共27条；第2页/)).toBeVisible()
  await root.getByLabel('对象类型',{exact:true}).selectOption('插件');await expect(root.getByText(/共1条；第1页/)).toBeVisible()
  await root.getByRole('button',{name:'查看证据 EVT-01-evidence',exact:true}).click();let drawer=ops.getByRole('dialog',{name:'单事件证据'})
  await expect(drawer.getByText('规则原始单位：%',{exact:true})).toBeVisible();await expect(drawer.getByText(/token=\[REDACTED\] 调用超时/)).toBeVisible();assert.ok(!(await drawer.innerText()).includes('SECRET'))
  await expect(drawer.getByRole('button',{name:'前往运维待办办理',exact:true})).toBeVisible();await drawer.getByRole('button',{name:'关闭证据',exact:true}).click()
  await root.getByLabel('对象类型',{exact:true}).selectOption('');await root.getByLabel('事件搜索',{exact:true}).fill('old-0');await root.getByRole('button',{name:'查询事件',exact:true}).click();await expect(root.getByText(/共1条；第1页/)).toBeVisible()
  await root.getByRole('button',{name:'查看证据 EVT-01-old-0',exact:true}).click();drawer=ops.getByRole('dialog',{name:'单事件证据'});await expect(drawer.getByText('无时序指标',{exact:true})).toBeVisible();await expect(drawer.getByText('未采集脱敏日志',{exact:true})).toBeVisible();await drawer.getByRole('button',{name:'关闭证据',exact:true}).click()
  const user=await login('用户'),created=await user.request.post(server.resolvedUrls.local[0]+'api/events',{data:{ticketNo:'EVT-01-new-live',resourceId:'live',objectType:'MCP',facts:'浏览器真实上报'}});assert.equal(created.status(),201)
  await root.getByLabel('事件搜索',{exact:true}).fill('new-live');await root.getByRole('button',{name:'查询事件',exact:true}).click();await expect(root.getByText(/共1条；第1页/)).toBeVisible()
  await root.getByLabel('趋势范围',{exact:true}).selectOption('1h');await root.getByRole('button',{name:'刷新事件监控',exact:true}).click();await expect(root.getByRole('button',{name:'查看证据 EVT-01-new-live',exact:true})).toBeVisible()
  const admin=await login('系统管理员');await admin.getByRole('button',{name:'安全事件',exact:true}).click();await admin.getByRole('button',{name:'查看证据 EVT-01-new-live',exact:true}).click();const readOnly=admin.getByRole('dialog',{name:'单事件证据'});await expect(readOnly.getByText('管理员只读，不办理事件',{exact:true})).toBeVisible();await expect(readOnly.getByRole('button',{name:'前往运维待办办理',exact:true})).toHaveCount(0)
  await expect(user.getByRole('button',{name:'安全事件',exact:true})).toHaveCount(0);assert.equal(posts,0)
  console.log('PASS Edge: 安全事件六区块、真实报告刷新、分页筛选、证据五块、原单位阈值、脱敏、人工空态和管理员只读；无能力写入')
}finally{await browser?.close();await server?.close();await cap?.close();await rm(dir,{recursive:true,force:true})}
