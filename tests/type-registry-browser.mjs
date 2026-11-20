import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
const dir=await mkdtemp(join(tmpdir(),'type-registry-browser-'))
process.env.APP_DATA_DIR=dir
let server,browser
try {
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}});await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();page.setDefaultTimeout(10000)
  await page.goto(server.resolvedUrls.local[0])
  await page.getByRole('button',{name:/^系统管理员/}).click()
  await page.getByRole('button',{name:'工单类型',exact:true}).click()
  await page.getByLabel('类型编码',{exact:true}).fill('EVT-01')
  await page.getByRole('checkbox',{name:'业务一部',exact:true}).check()
  await page.getByRole('button',{name:'保存草稿',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('草稿已保存')
  await page.getByRole('button',{name:'发布版本',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('版本已发布')
  await expect(page.getByRole('checkbox',{name:'业务一部',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'复制为新版本草稿',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('已复制为新版本草稿，请核验后发布')
  await expect(page.getByLabel('版本',{exact:true})).toHaveValue('2')
  await expect(page.getByRole('checkbox',{name:'业务一部',exact:true})).toBeChecked()
  await page.getByRole('checkbox',{name:'业务一部',exact:true}).uncheck()
  await page.getByRole('checkbox',{name:'平台运营组',exact:true}).check()
  await page.getByRole('button',{name:'保存草稿',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('草稿已保存')
  await page.getByRole('button',{name:'发布版本',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('版本已发布')
  const registry=await(await page.request.get(new URL('/api/types',page.url()).href)).json()
  assert.deepEqual(registry.versions.find(v=>v.version==='1').enabledOrgs,['业务一部'])
  assert.deepEqual(registry.versions.find(v=>v.version==='2').enabledOrgs,['平台运营组'])
  console.log('PASS Edge: 类型版本复制、组织范围编辑、发布锁定，源版本保持原值')
}finally {await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}
