import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../../../../../runtime/http.mjs'

const dir=await mkdtemp(join(tmpdir(),'skill-warehouse-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability
try {
  capability=await listen(async(req,res)=>{
    const cursor=new URL(req.url,'http://localhost').searchParams.get('cursor')
    const items=cursor?[{resourceId:'old-skill',name:'已下架技能',status:'withdrawn',actions:[],data:{version:'0',description:'历史'}}]:[{resourceId:'live-skill',name:'可下载技能',status:'approved',actions:['download'],data:{version:'2',description:'当前',successfulDownloadCount:3}}]
    return json(res,{items,nextCursor:cursor?null:'next'})
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const base=server.resolvedUrls.local[0]
  async function login(role){const page=await browser.newPage();await page.goto(base);await page.getByRole('button',{name:new RegExp('^'+role)}).click();await page.locator('.app-shell').waitFor();return page}
  const user=await login('用户')
  await user.getByRole('button',{name:'Skill仓库',exact:true}).click()
  await user.getByTestId('catalog-card-live-skill').waitFor()
  assert.equal(await user.getByTestId('catalog-card-old-skill').count(),0)
  await expect(user.getByText('3 次').first()).toBeVisible()
  await user.getByRole('button',{name:'加载更多目录',exact:true}).click()
  assert.equal(await user.getByTestId('catalog-card-old-skill').count(),0)
  const ops=await login('运维人员')
  await ops.getByRole('button',{name:'Skill仓库',exact:true}).click()
  await ops.getByRole('button',{name:'加载更多目录',exact:true}).click()
  await ops.getByTestId('catalog-card-old-skill').waitFor()
  await ops.getByTestId('catalog-card-old-skill').click()
  await expect(ops.getByRole('button',{name:'下载',exact:true})).toBeDisabled()
  console.log('PASS skill warehouse: 用户只见可下载项，运维可见下架且不能下载')
} finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
