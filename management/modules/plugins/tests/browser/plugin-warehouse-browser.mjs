import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../../../../../runtime/http.mjs'

const dir=await mkdtemp(join(tmpdir(),'plugin-warehouse-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability,release
try {
  let releaseLate=()=>{}
const late=new Promise(resolve=>{releaseLate=resolve})
capability=await listen(async(req,res)=>{
  const workspace=new URL(req.url,'http://localhost').searchParams.get('workspaceId')
  if(req.url.includes('/workspaces'))return json(res,{items:[{workspaceId:'ws-b',name:'乙区'},{workspaceId:'ws-a',name:'甲区'}],nextCursor:null})
  if(workspace==='ws-a'){await late;return json(res,{items:[{resourceId:'stale',name:'过期插件',status:'approved',data:{installed:true,installationId:'old'}}],nextCursor:null})}
  return json(res,{items:[{resourceId:'current',name:'当前插件',status:'approved',data:{}},{resourceId:'absent',name:'明确未装',status:'approved',data:{installed:false}}],nextCursor:null})
})
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0])
  await page.getByRole('button',{name:/^用户/}).click();await page.locator('.app-shell').waitFor()
  await page.getByRole('button',{name:'插件仓库',exact:true}).click()
  await page.getByTestId('plugin-card-current').waitFor()
  await expect(page.getByTestId('plugin-detail')).toHaveCount(0)
  await expect(page.getByTestId('plugin-card-current')).toContainText('未采集')
  await expect(page.getByTestId('plugin-card-absent')).toContainText('未安装')
  releaseLate()
  await page.waitForTimeout(300)
  assert.equal(await page.getByTestId('plugin-card-stale').count(),0)
  release='PASS plugin warehouse: 目录自动读取首个工作区，不展示办理区，null 不显示未安装'
  console.log(release)
} finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
