import { body, check, client, digest, id, json, ledger, listen } from '../../runtime/http.mjs'

const demoAccounts = new Map([['chen.yu','业务一部'],['zhou.min','平台运营组'],['li.qiang','系统管理组']])
const ownerHeaders = row => ({'x-account':row.command.account,'x-org':encodeURIComponent(row.command.org),'x-role':({'chen.yu':'user','zhou.min':'operator','li.qiang':'admin'})[row.command.account]})

export function managementApi(options) {
  const tickets = ledger(options.dir,'tickets')
  const cap = client(options.executor,options.token)
  const flushing = new Map()
  async function writeBack(row) {
    if (!row.receipt) return
    if (flushing.has(row.ticketNo)) return flushing.get(row.ticketNo)
    const task = (async () => {
      const state = await (await cap('/downloads/'+row.resultId+'/receipt','PUT',row.receipt,ownerHeaders(row))).json()
      tickets.put(row.ticketNo,{...row,state,receipt:null})
    })().finally(()=>flushing.delete(row.ticketNo))
    flushing.set(row.ticketNo,task)
    return task
  }
  const retry = setInterval(()=> {
    for (const row of tickets.all()) {
      if (row.receipt) void writeBack(row).catch(()=>{})
      else if (!row.state || ['queued','reconciling'].includes(row.state.status)) void refresh(row).catch(()=>{})
    }
  },3000)
  retry.unref()
  function close() { clearInterval(retry); tickets.close() }
  function visible(row) {
    const state = row.state
    return {ticketNo:row.ticketNo,status:state.status,ok:state.status==='succeeded',
      resultId:row.resultId ?? state.result?.resultId ?? '',failureReason:state.result?.failureReason ?? '',
      downloadUrl:state.delivery ? '/api/tickets/'+row.ticketNo+'/file' : null}
  }
  async function refresh(row) {
    if (row.receipt) await writeBack(row)
    const latest = tickets.get(row.ticketNo)
    if (latest.state?.result) return latest
    let state
    try {
      state = await (await cap('/executions/'+latest.command.executionId)).json()
    } catch (err) {
      if (err.status !== 404) throw err
      state = await (await cap('/executions','POST',latest.command)).json()
    }
    const current = tickets.get(row.ticketNo)
    if (current.receipt || current.state?.result) return current
    return tickets.put(row.ticketNo,{...current,state,resultId:state.delivery?.resultId ?? state.result?.resultId})
  }
  async function handle(req,res,path) {
    const approved = /^\/internal\/v1\/approved-inputs\/([\w-]+)$/.exec(path)
    if (approved && req.method === 'GET') {
      check(req.headers.authorization === 'Bearer '+options.token,403,'ACCESS_DENIED')
      const row = tickets.all().find(ticket => ticket.command.executionId === approved[1])
      check(row,404,'NOT_FOUND')
      const c=row.command
      return json(res,{decisionRef:'dec-'+c.executionId,ticketNo:c.ticketNo,ticketType:c.ticketType,
        ticketTypeVersion:c.ticketTypeVersion,action:c.action,resourceId:c.resourceId,account:c.account,org:c.org,
        fields:c.payload,preconditions:[{kind:c.ticketType==='SKL-03'?'skill':'plugin',id:c.resourceId,sha256:c.payload.sha256}]})
    }
    // The role selector is a local demo identity. Ticket URLs belong to a browser session.
    let session = /(?:^|; *)app_session=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]
    if (req.method==='POST' && (path==='/api/tickets' || path==='/api/execute')) {
      check(!req.headers.origin || new URL(req.headers.origin).host===req.headers.host,403,'ACCESS_DENIED')
      const input = await body(req)
      check(input && /^[A-Za-z0-9-]{1,100}$/.test(input.ticketNo) && typeof input.ticketNo==='string' && demoAccounts.has(input.account),400,'INVALID_REQUEST')
      check(input.ticketType==='SKL-03' && input.action==='download' || input.ticketType==='PLG-03' && input.action==='install',501,'UPSTREAM_UNSUPPORTED','此工单动作尚未接入')
      if (!session) { session=id(); res.setHeader('set-cookie','app_session='+session+'; Path=/api; HttpOnly; SameSite=Strict') }
      const owner = digest(session)
      let row=tickets.get(input.ticketNo)
      if (row) {
        check(row.owner===owner && row.command.account===input.account,404,'NOT_FOUND')
        check(row.selection===input.resourceId && row.command.ticketType===input.ticketType,409,'EXECUTION_CONFLICT')
      } else {
        const command={executionId:id(),ticketNo:input.ticketNo,ticketType:input.ticketType,ticketTypeVersion:'1',action:input.action,resourceId:input.resourceId,account:input.account,org:demoAccounts.get(input.account)}
        if (input.ticketType==='SKL-03') {
          const catalog = await (await cap('/catalog?kind=skill','GET',undefined,ownerHeaders({command}))).json()
          const item = catalog.items.find(i=>i.resourceId===input.resourceId || i.name===input.resourceId)
          check(item,403,'ACCESS_DENIED','不在下载范围内')
          command.resourceId=item.resourceId
          command.payload={version:item.data.version,sha256:item.data.sha256}
        } else {
          check(options.resolveInstallAccount && await options.resolveInstallAccount(req)===input.account,501,'UPSTREAM_UNSUPPORTED','真实安装需要已验证的管理端会话')
          check(process.env.DIFY_INSTALL_ACCOUNT===input.account && process.env.DIFY_WORKSPACE_ID,501,'UPSTREAM_UNSUPPORTED','无法自动执行：未配置 Dify 安装身份')
          const item = await (await cap('/catalog/plugin/'+encodeURIComponent(input.resourceId),'GET',undefined,ownerHeaders({command}))).json()
          command.payload={version:item.data.version,sha256:item.data.sha256,workspaceId:process.env.DIFY_WORKSPACE_ID}
        }
        // Recheck after asynchronous preflight, before inserting the frozen command.
        row=tickets.get(input.ticketNo)
        if (row) check(row.owner===owner && row.command.account===input.account && row.selection===input.resourceId && row.command.ticketType===input.ticketType,409,'EXECUTION_CONFLICT')
        else row=tickets.put(input.ticketNo,{ticketNo:input.ticketNo,owner,selection:input.resourceId,command,state:null})
      }
      return json(res,visible(await refresh(row)))
    }
    if (req.method==='GET' && path==='/api/tickets') {
      const account=new URL(req.url,'http://localhost').searchParams.get('account')
      return json(res,{items:session?tickets.all().filter(r=>r.owner===digest(session) && r.command.account===account && r.state).reverse().map(r=>({...visible(r),selection:r.selection,updatedAt:r.state.updatedAt,ticketType:r.command.ticketType})):[]})
    }
    const match = /^\/api\/tickets\/([\w-]+)(\/file)?$/.exec(path)
    const row = match && tickets.get(match[1])
    check(req.method==='GET' && row && session && row.owner===digest(session),404,'NOT_FOUND')
    const current = await refresh(row)
    if (!match[2]) return json(res,visible(current))
    check(current.command.action==='download' && current.resultId,409,'NOT_READY')
    const file=await cap('/downloads/'+current.resultId,'GET',undefined,ownerHeaders(current))
    const bytes=Buffer.from(await file.arrayBuffer())
    const sha256=digest(bytes)
    check(sha256===current.command.payload.sha256 && sha256===file.headers.get('x-content-sha256') && bytes.length===Number(file.headers.get('content-length')),409,'INVALID_DELIVERY')
    for (const k of ['content-type','content-length','content-disposition','x-content-sha256']) res.setHeader(k,file.headers.get(k))
    res.setHeader('cache-control','no-store')
    res.once('finish',()=>{
      const latest=tickets.get(row.ticketNo)
      if (!latest.state?.result) {
        const pending=tickets.put(row.ticketNo,{...latest,receipt:{sha256,bytesSent:bytes.length}})
        void writeBack(pending).catch(()=>{})
      }
    })
    res.end(bytes)
  }
  return {handle,close}
}
export function startManagement(options) {
  const api=managementApi(options)
  return listen(api.handle,{port:options.port,close:api.close})
}
