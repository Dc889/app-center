import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {json,listen} from '../../../../../runtime/http.mjs'

const dir=await mkdtemp(join(tmpdir(),'mcp-warehouse-'))
process.env.APP_DATA_DIR=dir
let server,browser,capability
try {
  capability=await listen(async(req,res)=>{
    if(req.url.includes('/workspaces'))return json(res,{items:[{workspaceId:'ws-m',name:'MCP区'}],nextCursor:null})
    return json(res,{items:[{resourceId:'mcp-1',name:'档案检索',status:'approved',data:{bindingAccess:'approval',provider:'hidden-provider',endpoint:'http://mcp.internal/raw',name:'档案检索'}}],nextCursor:null})
  })
  process.env.CAPABILITY_URL=capability.url
  server=await createServer({cacheDir:join(dir,'vite-cache'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0])
  await page.getByRole('button',{name:/^用户/}).click();await page.locator('.app-shell').waitFor()
  await page.getByRole('button',{name:'MCP仓库',exact:true}).click()
  await page.getByTestId('mcp-card-mcp-1').waitFor()
  await expect(page.getByTestId('mcp-detail')).toHaveCount(0)
  await expect(page.getByTestId('mcp-card-mcp-1')).toContainText('需申请绑定')
  await expect(page.getByText('http://mcp.internal/raw')).toHaveCount(0)
  await expect(page.getByText('hidden-provider')).toHaveCount(0)
  assert.equal(await page.getByRole('button',{name:'提交 MCP-03 目录隔离',exact:true}).count(),0)
  console.log('PASS mcp warehouse: 不展示办理区，页面不出现 URL 与 provider')
} finally {
  await browser?.close();await server?.close();await capability?.close();await rm(dir,{recursive:true,force:true})
}
