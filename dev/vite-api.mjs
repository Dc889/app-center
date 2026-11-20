import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { localStack } from './services.mjs'
import { managementApi } from '../management/app/server/service.mjs'
import { json } from '../runtime/http.mjs'

export function developmentApi() {
  async function configure(server) {
    const dir=process.env.APP_DATA_DIR ?? resolve('.local-data')
    const token=process.env.INTERNAL_TOKEN ?? randomUUID()
    const stack=process.env.CAPABILITY_URL ? null : await localStack(dir, token, false)
    const api=managementApi({dir,token,executor:process.env.CAPABILITY_URL ?? stack.executor})
    server.httpServer?.once('close',async()=>{api.close(); await stack?.close()})
    server.middlewares.use((req,res,next)=>{
      const path = new URL(req.url,'http://localhost').pathname
      if (!path.startsWith('/api/') && !path.startsWith('/internal/v1/approved-inputs/') && !path.startsWith('/internal/v1/account-changes/') && !path.startsWith('/internal/v1/subjects/') && !path.startsWith('/internal/v1/delivery-checks/') && !['/internal/v1/policy-decisions','/internal/v1/dataset-alerts','/internal/v1/dataset-changes','/internal/v1/plugin-alerts'].includes(path)) return next()
      api.handle(req,res,path).catch(error=>{
        if (res.headersSent) return res.destroy()
        json(res,{error:{code:error.status ? error.code : 'SERVICE_UNAVAILABLE',message:error.status ? error.message : '服务暂不可用'}}, error.status ?? 503)
      })
    })
  }
  return {name:'management-api',configureServer:configure,configurePreviewServer:configure}
}
