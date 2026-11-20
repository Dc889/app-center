import { check, digest } from '../../../../runtime/http.mjs'

export async function installPlugin(command, plugin) {
  const {DIFY_API_BASE:base,DIFY_CONSOLE_TOKEN:token,DIFY_WORKSPACE_ID:workspace,DIFY_INSTALL_ACCOUNT:account} = process.env
  check(base && token && workspace && account,501,'UPSTREAM_UNSUPPORTED','无法自动执行：未配置已核验的 Dify 安装身份')
  check(command.account === account && command.payload.workspaceId === workspace,403,'ACCESS_DENIED')
  const headers = {Authorization:'Bearer '+token}
  const current = await fetch(new URL('/console/api/workspaces/current',base),{method:'POST',headers,signal:AbortSignal.timeout(15000)})
  check(current.ok && (await current.json()).id===workspace,403,'ACCESS_DENIED','Dify 身份与目标工作区不一致')
  const call = async (route,options={}) => {
    const r = await fetch(new URL('/console/api/workspaces/current/plugin/'+route,base),{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(15000)})
    if (!r.ok) throw Error('Dify 请求需查证')
    return r.json()
  }
  const path = '/plugins/'+encodeURIComponent(command.resourceId)+'/versions/'+encodeURIComponent(command.payload.version)
  const bytes = await (await plugin(path+'/file')).arrayBuffer()
  check(digest(Buffer.from(bytes)) === command.payload.sha256,409,'STALE_SNAPSHOT')
  const form = new FormData()
  form.append('pkg',new Blob([bytes]),'plugin.difypkg')
  const uploaded = await call('upload/pkg',{method:'POST',body:form})
  if (!uploaded.unique_identifier) throw Error('缺少上传结果')
  const installation = await call('install/pkg',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plugin_unique_identifiers:[uploaded.unique_identifier]})})
  return {pluginUniqueIdentifier:uploaded.unique_identifier,workspaceId:workspace,upstreamTaskId:installation.task_id ?? null}
}

export async function installed(task) {
  const base=process.env.DIFY_API_BASE
  if (!base) return false
  let page=1
  for (;;) {
    const url=new URL('/console/api/workspaces/current/plugin/list',base)
    url.search=new URLSearchParams({page:String(page),page_size:'100'}).toString()
    const response=await fetch(url,{headers:{Authorization:'Bearer '+process.env.DIFY_CONSOLE_TOKEN},signal:AbortSignal.timeout(15000)})
    if (!response.ok) return false
    const list=await response.json()
    if (!Array.isArray(list.plugins)) return false
    if (list.plugins.some(p=>p.tenant_id===task.workspaceId && p.plugin_unique_identifier===task.pluginUniqueIdentifier)) return true
    if (!list.plugins.length || page*100>=list.total || !Number.isInteger(list.total)) return false
    page++
  }
}
