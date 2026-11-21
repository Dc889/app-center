import {AsyncLocalStorage} from 'node:async_hooks'
import {isIP} from 'node:net'
import {readFileSync} from 'node:fs'
import {dispatchModuleRoute,executionContextHandlers} from './module-registry.mjs'
import {deliveryControl} from '../../platform/delivery/public.server.mjs'
import {executionCandidates} from './execution-candidates.mjs'
import {readExecution} from '../../../runtime/execution-state.mjs'
import {identityDirectory} from '../../platform/identity/public.server.mjs'
import {accountWorkflows} from '../../modules/accounts/public.server.mjs'
import {evidenceStore} from '../../platform/evidence/public.server.mjs'
import {intakeApi} from '../../platform/packages/public.server.mjs'
import {mcpRegistration} from '../../modules/mcp/public.server.mjs'
import {policyDecision} from '../../platform/access/public.server.mjs'
import {applicationApi} from './application-workflows.mjs'
import {draftApi,typeRegistry} from '../../platform/workflow/public.server.mjs'
import {body,check,client,digest,id,json,ledger,listen} from '../../../runtime/http.mjs'

const executionRoutes=JSON.parse(readFileSync(new URL('../../../contracts/capability-api/actions.json',import.meta.url),'utf8'))
const hasRole=(identity,role)=>!!identity?.active && identity.roles?.includes(role)

export function managementApi(options) {
  const auditContext=new AsyncLocalStorage()
  function actorSnapshot(account) {
    if(['system','system_event','capability'].includes(account))return {org:'系统服务',actorSubjectId:'service:'+account,actorRole:'system',actorRevision:null,actorSource:'service'}
    const identity=auditContext.getStore()
    const profile=directory.byAccount(account)
    if(identity?.account===account) {
      check(profile?.revision===identity.profileRevision && directory.isActive(profile),403,'ACTOR_SESSION_CHANGED')
      return {org:identity.org,actorSubjectId:identity.subjectId,actorRole:identity.roles[0],actorRevision:identity.profileRevision,actorSource:'session_snapshot',sourceIp:identity.sourceIp ?? null}
    }
    return {org:profile?.org ?? null,actorSubjectId:profile?.subjectId ?? null,actorRevision:profile?.revision ?? null,actorRole:null,
      actorSource:profile?'directory_at_write':'not_collected'}
  }
  const tickets = ledger(options.dir,'tickets',actorSnapshot)
  const cap = client(options.executor,options.token)
  const directory=identityDirectory(options.dir,options.initialSubjects,options.now,actorSnapshot)
  const demoAccounts=directory.accounts
  function ownerHeaders(row,allowRestricted=false) {
    if(row.command.account==='system_event')return {'x-account':'system_event','x-org':encodeURIComponent('系统服务'),'x-role':'system'}
    const profile=directory.byAccount(row.command.account)
    check(directory.isActive(profile) && (allowRestricted || !directory.restricted(row.command.account)),403,'ACCOUNT_RESTRICTED')
    const role=row.command.actorRole ?? demoAccounts.role(profile.account)
    check(profile.roles.includes(role),403,'ROLE_CHANGED')
    return {'x-account':profile.account,'x-subject-id':profile.subjectId,'x-org':encodeURIComponent(profile.org),'x-role':role}
  }

  const intake=intakeApi(options,identity=>ownerHeaders({command:{account:identity.account,org:identity.org,actorRole:identity.roles[0]}}),directory.owns)
  const identities = ledger(options.dir,"demo-sessions")
  const events = ledger(options.dir,'reported-events',actorSnapshot)
  const types = typeRegistry(options.dir,cap,actorSnapshot,{organizations:()=>directory.catalog.orgs,currentOrg:()=>auditContext.getStore()?.org ?? null})
  const drafts=draftApi(options.dir,directory.owns,{activeVersion:types.activeVersion,actorSnapshot,
    findSubmission(draft){
      const no=draft.submission.ticketNo
      const row=draft.ticketType==='EVT-01'?events.get(no):draft.ticketType.startsWith('ACC-')?accountChanges.records().find(r=>r.ticketNo===no):
        draft.ticketType==='SKL-03'?tickets.get(no):applications.records().find(r=>r.ticketNo===no)
      const origin=row?.originDraft
      return origin?.draftId===draft.draftId && origin.sourceRevision===draft.submission.sourceRevision && origin.hash===draft.submission.hash &&
        (!!draft.ownerSubjectId && row.applicantSubjectId===draft.ownerSubjectId || directory.owns(row.account ?? row.command?.account,{subjectId:draft.ownerSubjectId}))?row:null
    },
  })
  const evidence=evidenceStore(options.dir,{resolveSubjectId:account=>directory.byAccount(account)?.subjectId,ownsHistorical:directory.owns})
  const accountChanges=accountWorkflows({directory,cap,types,headersFor:ownerHeaders,now:options.now,catalog:options.directoryCatalog ?? directory.catalog})
  const applications=applicationApi(options.dir,cap,types,demoAccounts,ownerHeaders,resourceId=>!tickets.all().some(row=>row.command.resourceId===resourceId && row.deliveryClosure?.state!=='closed_unserved' && (row.receipt || ['sending','pending_receipt','interrupted','uncertain'].includes(row.delivery?.status))),evidence,{
    now:options.now,onPluginEmergency:recordPluginEmergency,isAccountRestricted:directory.restricted,ownsHistorical:directory.owns,actorSnapshot,
    isCurrentOperator(identity){const p=directory.get(identity.subjectId);return directory.isActive(p) && p.revision===identity.profileRevision && p.roles.includes('operator')},
  })
  function recordPluginEmergency(row,urgent) {
    const ticketNo='EVT-01-plugin-'+digest(urgent.executionId).slice(0,40)
    const existing=events.get(ticketNo)
    if(existing)return existing.ticketNo
    const at=new Date((options.now ?? Date.now)()).toISOString()
    const facts='插件定向禁用失败或结果待查证；关联工单 '+row.ticketNo+'；错误 '+urgent.code
    events.put(ticketNo,{ticketNo,account:'system_event',org:'系统服务',resourceId:row.submission.resourceId,
      facts,objectType:'插件',creationMode:'系统告警',alertId:'AL-'+digest(urgent.executionId).slice(0,40),
      ruleCode:'PLUGIN_DISABLE_FAILED',originalSeverity:'紧急',firstOccurredAt:at,lastOccurredAt:at,
      sourceTicketNo:row.ticketNo,relatedTicketNos:[row.ticketNo],evidence:{executionId:urgent.executionId,code:urgent.code,
        workspaceId:row.submission.workspaceId,installationId:row.snapshot.fields['安装实例ID']},
      status:'未研判',version:types.activeVersion('EVT-01','',null),revision:1,history:[{at,actor:'system_event',action:'定向禁用失败升级紧急告警',fromStatus:null,toStatus:'未研判'}]})
    return ticketNo
  }
  const flushing = new Map()
  const cancelling = new Map()
  let stopped=false
  function deliveryProfile(row) {
    const p=row.ownerSubjectId?directory.get(row.ownerSubjectId):directory.byAccount(row.command.account) ??
      directory.subjects().find(person=>person.aliases.includes(row.command.account))
    check(p,409,'DELIVERY_IDENTITY_UNRESOLVED')
    return p
  }
  function deliveryHeaders(row,settlement=false) {
    const p=deliveryProfile(row)
    if(!settlement)check(directory.isActive(p) && !directory.restricted(p.account),403,'ACCOUNT_RESTRICTED')
    return {'x-account':p.account,'x-subject-id':p.subjectId,'x-org':encodeURIComponent(p.org),
      'x-role':demoAccounts.role(p.account),...(settlement?{'x-receipt-mode':'server-settlement'}:{})}
  }
  function originalExecutionIdentity(row) {
    const p=deliveryProfile(row)
    check(directory.isActive(p) && !directory.restricted(p.account) && p.account===row.command.account && p.org===row.command.org &&
      p.revision===(row.ownerRevision ?? 1),409,'EXECUTION_IDENTITY_CHANGED','执行身份已变化，不能重建原执行，请重新核对申请')
  }
  async function currentDownloadGrant(row,p) {
    let resource=await findSkill(row.command.resourceId,{account:p.account,org:p.org,actorRole:demoAccounts.role(p.account)})
    if(resource.data?.version!==row.command.payload.version)resource=await(await cap('/catalog/skill/'+encodeURIComponent(row.command.resourceId)+
      '?version='+encodeURIComponent(row.command.payload.version),'GET',undefined,deliveryHeaders(row))).json()
    check(resource.resourceId===row.command.resourceId && resource.actions?.includes('download') &&
      ['available','approved'].includes(resource.status) && resource.data?.version===row.command.payload.version &&
      resource.data?.sha256===row.command.payload.sha256,403,'DELIVERY_GRANT_UNAVAILABLE')
  }
  const delivery=deliveryControl(tickets)
  async function writeBack(row) {
    if (!row.receipt) return
    if (flushing.has(row.ticketNo)) return flushing.get(row.ticketNo)
    const task = (async () => {
      const state = await readExecution(await cap('/downloads/'+row.resultId+'/receipt','PUT',row.receipt,{...deliveryHeaders(row,true),
        ...(row.receiptSourceIp?{'x-source-ip':row.receiptSourceIp}:{})}),row.command,{expectedResultId:row.resultId,previous:row.state})
      check(state.status==='succeeded',409,'INVALID_RECEIPT_RESULT')
      if(stopped)return
      tickets.transaction(()=>{
      const latest=tickets.get(row.ticketNo)
      if(!latest.receipt)return
      tickets.put(row.ticketNo,{...latest,state,receipt:null,receiptError:null,
        history:[...(latest.history ?? []),{at:new Date().toISOString(),actor:'system',action:'确认文件回执'}],
        delivery:{...latest.delivery,status:'confirmed',updatedAt:new Date().toISOString()}})
      })
    })().catch(error=>{
      if(!stopped)tickets.transaction(()=>{const latest=tickets.get(row.ticketNo);if(latest.receipt)tickets.put(row.ticketNo,{...latest,
        receiptError:{code:error.code ?? 'NETWORK_ERROR',at:new Date().toISOString()}})})
      throw error
    }).finally(()=>flushing.delete(row.ticketNo))
    flushing.set(row.ticketNo,task)
    return task
  }
  async function cancelExecution(row,{queryOnly=false}={}) {
    if(cancelling.has(row.ticketNo))return cancelling.get(row.ticketNo)
    const task=(async()=>{
      try {
        let state=await readExecution(await cap('/executions/'+row.command.executionId),row.command,{expectedResultId:row.resultId,previous:row.state})
        if(!queryOnly && !['succeeded','failed','cancelled'].includes(state.status)) {
          let response
          try {response=await cap('/executions/'+row.command.executionId+'/cancel','POST',{})}
          catch(error){if(error.status!==409)throw error;response=await cap('/executions/'+row.command.executionId)}
          state=await readExecution(response,row.command,{expectedResultId:row.resultId,previous:row.state})
        }
        check(state.status!=='succeeded',409,'DELIVERY_UNCERTAIN','组件报告交付成功，需核对本地发送和回执证据')
        if(stopped)return
        tickets.transaction(()=>{
          const latest=tickets.get(row.ticketNo)
          if(latest.receipt || latest.delivery?.status==='confirmed')return
          const terminal=['failed','cancelled'].includes(state.status)
          check(!terminal || state.result,409,'EXECUTION_MISMATCH')
          tickets.put(row.ticketNo,{...latest,state,resultId:latest.resultId ?? state.delivery?.resultId,
            cancelRequest:{...latest.cancelRequest,status:terminal?'resolved':'pending',error:terminal?null:'CANCELLATION_UNCONFIRMED'},
            history:terminal?[...(latest.history ?? []),{at:new Date().toISOString(),actor:'system',action:'取消查证结果 '+state.status}]:latest.history})
        })
      }catch(error){if(!stopped)tickets.transaction(()=>{
        const latest=tickets.get(row.ticketNo)
        if(latest.cancelRequest?.status==='resolved')return
        tickets.put(row.ticketNo,{...latest,cancelRequest:{...latest.cancelRequest,status:error.status===501?'unsupported':'uncertain',error:error.code ?? 'NETWORK_ERROR'}})
      })}
    })().finally(()=>cancelling.delete(row.ticketNo))
    cancelling.set(row.ticketNo,task);return task
  }
  const retry = setInterval(()=> {
    for (const event of events.all()) {
      if (event.status==='观察中' && Date.parse(event.observeUntil)<=Date.now()) {
        events.put(event.ticketNo,{...event,status:'待复核',observeUntil:null,revision:event.revision+1,
          history:[...event.history,{at:new Date().toISOString(),actor:'system',action:'观察到期',fromStatus:'观察中',toStatus:'待复核'}]})
      }
    }
    for (const row of tickets.all()) {
      if (row.receipt) void writeBack(row).catch(()=>{})
      else if(row.cancelRequest){if(['pending','uncertain'].includes(row.cancelRequest.status))void cancelExecution(row).catch(()=>{})}
      else if (!row.protocolBlocked && (!row.state || ['queued','running','reconciling'].includes(row.state.status))) void refresh(row).catch(()=>{})
    }
  },3000)
  retry.unref()
  function close() { stopped=true;clearInterval(retry); tickets.close(); identities.close(); types.close(); events.close(); drafts.close();applications.close();intake.close();evidence.close();accountChanges.close();directory.close() }
  function visible(row) {
    const state = row.state ?? {status:'reconciling'}
    return {ticketNo:row.ticketNo,status:state.status,ok:state.status==='succeeded',executionId:row.command.executionId,
      cancelStatus:row.cancelRequest?.status ?? null,cancelError:row.cancelRequest?.error ?? null,deliveryClosed:!!row.deliveryClosure,
      resultId:row.resultId ?? state.result?.resultId ?? '',failureReason:state.result?.failureReason ?? '',
      downloadUrl:state.delivery && !row.deliveryClosure && !row.cancelRequest ? '/api/tickets/'+row.ticketNo+'/file' : null}
  }
  async function findSkill(resourceId,command) {
    const seen=new Set()
    let cursor=''
    do {
      check(!seen.has(cursor),503,'INVALID_CATALOG_CURSOR','能力目录返回了重复游标')
      seen.add(cursor)
      const query=new URLSearchParams({kind:'skill'})
      if(cursor)query.set('cursor',cursor)
      const page=await(await cap('/catalog?'+query,'GET',undefined,ownerHeaders({command}))).json()
      check(Array.isArray(page.items),503,'INVALID_CATALOG')
      const item=page.items.find(i=>i.resourceId===resourceId || i.name===resourceId)
      if(item)return item
      cursor=page.nextCursor ?? ''
      check(typeof cursor==='string',503,'INVALID_CATALOG_CURSOR')
    } while(cursor)
    check(false,403,'ACCESS_DENIED','不在下载范围内')
  }
  async function refresh(row,{queryOnly=false}={}) {
    if(row.cancelRequest){if(['pending','uncertain'].includes(row.cancelRequest.status))await cancelExecution(row,{queryOnly});return tickets.get(row.ticketNo)}
    if (row.receipt && !queryOnly) await writeBack(row)
    const latest = tickets.get(row.ticketNo)
    if (latest.state?.result) return latest
    if(latest.state?.status==='queued')originalExecutionIdentity(latest)
    let response,state
    try {
      response = await cap('/executions/'+latest.command.executionId)
    } catch (err) {
      if (err.status !== 404) throw err
      if(queryOnly)throw err
      originalExecutionIdentity(latest)
      check(!latest.executionKnown && !latest.state && !tickets.get(row.ticketNo).deliveryClosure && !tickets.get(row.ticketNo).cancelRequest,409,'EXECUTION_NOT_FOUND')
      response = await cap('/executions','POST',latest.command,ownerHeaders({command:{...latest.command,actorRole:latest.ownerRole ?? demoAccounts.role(latest.command.account)}}))
    }
    if(stopped)return latest
    tickets.transaction(()=>{const current=tickets.get(row.ticketNo);tickets.put(row.ticketNo,{...current,executionKnown:true})})
    try {
      state=await readExecution(response,latest.command,{expectedResultId:latest.resultId,expectedDelivery:latest.deliveryMetadata,previous:latest.state})
      check(latest.command.action!=='download' || state.status!=='succeeded' ||
        latest.delivery?.status==='confirmed' || latest.receipt || latest.history?.some(h=>h.action==='文件发送完成'),409,'LOCAL_DELIVERY_REQUIRED')
    }catch(error){if(!stopped)tickets.transaction(()=>{const current=tickets.get(row.ticketNo);tickets.put(row.ticketNo,{...current,
      protocolBlocked:true,lastError:{code:error.code ?? 'INVALID_EXECUTION_STATE',at:new Date().toISOString()}})});throw error}
    if(stopped)return latest
    return tickets.transaction(()=>{
    const current = tickets.get(row.ticketNo)
    if (current.receipt || current.state?.result || current.cancelRequest) return current
    return tickets.put(row.ticketNo,{...current,state,executionKnown:true,protocolBlocked:false,lastError:null,
      deliveryMetadata:state.delivery ?? current.deliveryMetadata,
      history:current.state?.status===state.status ? current.history : [...(current.history ?? []),{at:new Date().toISOString(),actor:'system',action:'执行状态 '+state.status}],resultId:state.delivery?.resultId ?? state.result?.resultId})
    })
  }
  async function dispatch(req,res,path) {
    const closeDelivery=/^\/internal\/v1\/delivery-checks\/([\w-]+)\/close$/.exec(path)
    if(closeDelivery) {
      check(req.method==='POST' && req.headers.authorization==='Bearer '+options.token,403,'ACCESS_DENIED')
      const result=delivery.close(closeDelivery[1])
      const row=tickets.get(result.ticketNo)
      if(row.receipt)void writeBack(row).catch(()=>{})
      check(result.state!=='uncertain',409,'DELIVERY_UNCERTAIN','文件在途或发送证据不完整，保留查证')
      return json(res,{state:result.state})
    }
    if(path==='/internal/v1/policy-decisions') return policyDecision(req,res,{
      token:options.token,records:applications.records,resolveAccount:options.resolvePolicyAccount && (async account=>{
        const external=await options.resolvePolicyAccount(account)
        const local=directory.byAccount(account)
        if(local) {
          if(directory.restricted(account))return {account,active:false}
          if(local.revision>1 && external)return {...external,account,active:true,role:local.roles[0],org:local.org,businessLines:[local.businessLine]}
        }else if(directory.subjects().some(p=>p.aliases.includes(account)))return {account,active:false}
        return external
      })})
    const token = /(?:^|; *)management_identity=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]
    const identity = directory.session(token && identities.get(digest(token)))
    const subjectMatch=/^\/internal\/v1\/subjects\/([\w-]+)$/.exec(path)
    if(subjectMatch) {
      check(req.method==='GET' && req.headers.authorization==='Bearer '+options.token,403,'ACCESS_DENIED')
      const p=directory.get(subjectMatch[1]);check(p,404,'NOT_FOUND')
      return json(res,{subjectId:p.subjectId,account:p.account,active:directory.isActive(p),org:p.org,revision:p.revision,
        ragflowAccountId:p.ragflowAccountId,difyAccountId:p.difyAccountId,workspaceId:p.workspaceId,
        ragflowPermission:p.ragflowPermission,difyRole:p.difyRole,restricted:directory.restricted(p.account)})
    }
    const commitMatch=/^\/internal\/v1\/account-changes\/([\w-]+)\/commit$/.exec(path)
    if(commitMatch)return accountChanges.commit(req,res,commitMatch[1],options.token)
    if(path==='/api/account-applications' || path==='/api/account-applications/transition')return accountChanges.handle(req,res,path,identity)
    if(path==='/api/subjects') {
      check(req.method==='GET' && hasRole(identity,'admin'),403,'ACCESS_DENIED')
      return json(res,{items:directory.subjects(),catalog:options.directoryCatalog ?? directory.catalog})
    }
    if(identity?.restricted && path.startsWith('/api/') && !['/api/demo-session','/api/audit','/api/account-applications','/api/account-applications/transition'].includes(path)) {
      check(req.method==='GET' && ['/api/applications','/api/tickets','/api/events'].includes(path),403,'ACCOUNT_CHANGE_PENDING')
    }
    if(await dispatchModuleRoute(path,{accountChanges,applications,cap,demoAccounts,directory,drafts,events,hasRole,identity,options,ownerHeaders,path,req,res,tickets,types}))return
    if(path==='/internal/v1/plugin-alerts') {
      check(req.method==='POST' && req.headers.authorization==='Bearer '+options.token,403,'ACCESS_DENIED')
      return json(res,await applications.ingestPluginAlert(await body(req)),201)
    }
    if(path==='/internal/v1/dataset-changes') {
      check(req.method==='POST' && req.headers.authorization==='Bearer '+options.token,403,'ACCESS_DENIED')
      return json(res,await applications.ingestDatasetChanges(await body(req)),201)
    }
    if(path==='/internal/v1/dataset-alerts') {
      check(req.method==='POST' && req.headers.authorization==='Bearer '+options.token,403,'ACCESS_DENIED')
      return json(res,await applications.ingestDatasetAlert(await body(req)),201)
    }
    if(path==='/api/evidence' || path.startsWith('/api/evidence/'))return evidence.handle(req,res,path,identity,
      key=>(hasRole(identity,'operator') || hasRole(identity,'admin')) && applications.records().some(row=>(row.evidenceRefs?.some(e=>e.evidenceId===key) || row.attempts?.some(a=>a.approvedFields?.['修复附件']?.some(e=>e.evidenceId===key)))))
    if(path.startsWith('/api/intake/'))return intake.handle(req,res,path,identity)
    if (path==='/api/applications' || path==='/api/applications/transition' || path==='/api/applications/reveal') return applications.handle(req,res,path,identity)
    if(path==='/api/execution-contexts') {
      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      const query=new URL(req.url,'http://localhost').searchParams
      const ticketType=query.get('ticketType'),action=query.get('action'),resourceId=query.get('resourceId')
      check(Object.hasOwn(executionRoutes,ticketType) && executionRoutes[ticketType].includes(action) &&
        typeof resourceId==='string' && resourceId.length>0 && resourceId.length<=200,400,'INVALID_EXECUTION_CONTEXT')
      if(ticketType.startsWith('ACC-'))check(hasRole(identity,'admin'),403,'ACCESS_DENIED')
      if(['KB-04','PLG-04'].includes(ticketType))check(hasRole(identity,'operator') || hasRole(identity,'admin'),403,'ACCESS_DENIED')
      const contextHandler=executionContextHandlers[ticketType]
      if(contextHandler)return json(res,await contextHandler({cap,headers:ownerHeaders({command:{account:identity.account,org:identity.org,actorRole:identity.roles[0]}}),query,resourceId,ticketType,action}))
      const params=new URLSearchParams({action,resourceId})
      const workspace=query.get('workspaceId')
      if(workspace){check(workspace.length<=200,400,'INVALID_WORKSPACE');params.set('workspaceId',workspace)}
      const snapshot=await(await cap('/execution-contexts/'+ticketType+'?'+params,'GET',undefined,
        ownerHeaders({command:{account:identity.account,org:demoAccounts.get(identity.account),actorRole:identity.roles[0]}}))).json()
      check(snapshot.ticketType===ticketType && snapshot.action===action && snapshot.resourceId===resourceId &&
        typeof snapshot.snapshotId==='string' && snapshot.snapshotId && snapshot.fields &&
        typeof snapshot.fields==='object' && !Array.isArray(snapshot.fields) && Array.isArray(snapshot.preconditions),
        503,'INVALID_EXECUTION_CONTEXT','对端返回的执行依据与请求不匹配')
      return json(res,snapshot)
    }
    if(path==='/api/catalog' || path.startsWith('/api/catalog/')) {
      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      const params=new URL(req.url,'http://localhost').searchParams
      const parts=path.split('/').slice(3)
      const kind=parts.length?parts[0]:params.get('kind')
      check(['skill','plugin','mcp','agent'].includes(kind),400,'INVALID_CATALOG_KIND')
      check(!parts.length || parts.length===2 && parts[1] || parts.length===3 && kind==='skill' && parts[1] && parts[2]==='versions',400,'INVALID_CATALOG_PATH')
      const query=new URLSearchParams()
      if(!parts.length)query.set('kind',kind)
      const action=params.get('action')
      if(action){check(parts.length<=2 && (kind==='agent' && ['republish','withdraw_app'].includes(action) || kind==='skill' && action==='withdraw_skill' || kind==='mcp' && ['unbind_mcp','isolate_mcp','withdraw_mcp'].includes(action)),400,'INVALID_CATALOG_ACTION');query.set('action',action)}
      for(const key of ['q','workspaceId','cursor','limit','version']) {
        const value=params.get(key)
        if(value){check(value.length<=200,400,'INVALID_QUERY');query.set(key,value)}
      }
      const endpoint=parts.length?'/catalog/'+kind+'/'+encodeURIComponent(decodeURIComponent(parts[1]))+(parts.length===3?'/versions':''):'/catalog'
      const response=await cap(endpoint+(query.size?'?'+query:''),'GET',undefined,
        ownerHeaders({command:{account:identity.account,org:demoAccounts.get(identity.account),actorRole:identity.roles[0]}}))
      return json(res,await response.json())
    }
    if(path==='/api/execution-candidates') {
      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      return json(res,await executionCandidates(cap,ownerHeaders({command:{account:identity.account,org:identity.org,actorRole:identity.roles[0]}}),new URL(req.url,'http://localhost').searchParams))
    }
    if(path==='/api/workspaces') {
      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      const input=new URL(req.url,'http://localhost').searchParams
      check(input.get('product')==='dify',400,'INVALID_PRODUCT')
      const params=new URLSearchParams({product:'dify'})
      for(const key of ['cursor','limit']) {
        const value=input.get(key)
        if(value){check(value.length<=200 && (key!=='limit' || /^\d{1,3}$/.test(value) && Number(value)>=1 && Number(value)<=100),400,'INVALID_QUERY');params.set(key,value)}
      }
      const response=await cap('/workspaces?'+params,'GET',undefined,
        ownerHeaders({command:{account:identity.account,org:identity.org,actorRole:identity.roles[0]}}))
      const data=await response.json()
      check(Array.isArray(data.items) && data.items.every(row=>row && typeof row.workspaceId==='string' && row.workspaceId.trim() &&
        row.workspaceId.length<=200 && typeof row.name==='string' && row.name.trim() && row.name.length<=200) &&
        (data.nextCursor==null || typeof data.nextCursor==='string' && data.nextCursor.length<=200),503,'INVALID_WORKSPACE_DIRECTORY')
      return json(res,{items:data.items.map(({workspaceId,name})=>({workspaceId,name})),nextCursor:data.nextCursor ?? null})
    }
    if (path==='/api/resources' || path.startsWith('/api/resources/')) {
      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      const query=new URL(req.url,'http://localhost').searchParams
      const parts=path.split('/').slice(3)
      const kind=parts.length ? parts[0] : query.get('kind')
      check(['dify_app','ragflow_dataset','dify_dataset','mcp_registration','model','skill','plugin'].includes(kind),400,'INVALID_RESOURCE_KIND')
      check(parts.length===0 || parts.length===2 && parts[1],400,'INVALID_RESOURCE_PATH')
      const params=new URLSearchParams()
      if(!parts.length) params.set('kind',kind)
      for(const key of ['workspaceId','q',...parts.length?[]:['cursor','limit']]) {
        const value=query.get(key)
        if(value) {check(value.length<=200 && (key!=='limit' || /^\d{1,3}$/.test(value) && Number(value)>=1 && Number(value)<=100),400,'INVALID_QUERY');params.set(key,value)}
      }
      const suffix=params.size?'?'+params:''
      const endpoint=parts.length ? '/resources/'+kind+'/'+encodeURIComponent(decodeURIComponent(parts[1])) : '/resources'
      const headers=ownerHeaders({command:{account:identity.account,org:demoAccounts.get(identity.account),actorRole:identity.roles[0]}})
      if(parts.length && kind==='mcp_registration')return json(res,await mcpRegistration(cap,headers,decodeURIComponent(parts[1])))
      const response=await cap(endpoint+suffix,'GET',undefined,headers)
      return json(res,await response.json())
    }
    if (['/api/drafts','/api/drafts/restore','/api/drafts/recover'].includes(path)) return drafts.handle(req,res,identity,path)
    if (path==='/api/demo-session' || path.startsWith('/api/types')) {
      check(!req.headers.origin || new URL(req.headers.origin).host===req.headers.host,403,'ACCESS_DENIED')
      if (path==='/api/demo-session') {
        if (req.method==='GET') {
          if (!identity?.active) return json(res,{active:false})
          const profile=directory.get(identity.subjectId)
          if (!directory.isActive(profile)) return json(res,{active:false})
          return json(res,{active:true,account:profile.account,name:profile.name,org:profile.org,businessLine:profile.businessLine,roles:profile.roles,actingRole:identity.actingRole,subjectId:profile.subjectId})
        }
        if (req.method==='DELETE') {
          if (identity) identities.put(digest(token),{active:false})
          res.setHeader('set-cookie','management_identity=; Path=/api; Max-Age=0; HttpOnly; SameSite=Strict')
          return json(res,{active:false})
        }
        check(req.method==='POST',405,'METHOD_NOT_ALLOWED')
        const input=await body(req)
        const profile=directory.byAccount(input.account)
        check(directory.isActive(profile),403,'ACCOUNT_INACTIVE')
        const actingRole=input.role ?? (profile.roles.includes('admin')?'admin':profile.roles.includes('operator')?'operator':'user')
        check(profile.roles.includes(actingRole),403,'ROLE_NOT_ASSIGNED')
        if (identity) identities.put(digest(token),{active:false})
        const fresh=id()
        identities.put(digest(fresh),{account:profile.account,subjectId:profile.subjectId,profileRevision:profile.revision,actingRole,active:true})
        res.setHeader('set-cookie','management_identity='+fresh+'; Path=/api; HttpOnly; SameSite=Strict')
        return json(res,{account:profile.account,name:profile.name,org:profile.org,businessLine:profile.businessLine,roles:profile.roles,actingRole,subjectId:profile.subjectId})
      }
      check(identity?.active && hasRole(identity,'admin'),403,'ACCESS_DENIED','仅系统管理员可管理工单类型')
      return types.handle(req,res,path,identity.account)
    }
    const approved = /^\/internal\/v1\/approved-inputs\/([\w-]+)(\/documents)?$/.exec(path)
    if (approved && req.method === 'GET') {
      check(req.headers.authorization === 'Bearer '+options.token,403,'ACCESS_DENIED')
      const row = [...tickets.all(),...accountChanges.records().flatMap(row=>[row,...row.attempts]),...applications.records().flatMap(row=>[row,...(row.attempts ?? []).map(attempt=>({...attempt,preconditions:attempt.preconditions ?? row.preconditions}))])].find(ticket => ticket.command?.executionId === approved[1])
      check(row,404,'NOT_FOUND')
      const c=row.command
      if(approved[2]) {
        check(['KB-02','KB-04'].includes(c.ticketType),404,'NOT_FOUND')
        const fields=row.approvedFields
        const entries=fields?.['文档确认记录']
        check(Array.isArray(entries) && typeof fields['文档清单快照ID']==='string',409,'DOCUMENT_REVIEW_NOT_FROZEN')
        const query=new URL(req.url,'http://localhost').searchParams
        const cursor=query.get('cursor') ?? '0',limit=query.get('limit') ?? '50'
        check(/^(0|[1-9]\d{0,8})$/.test(cursor) && /^[1-9]\d{0,2}$/.test(limit) && Number(limit)<=100 && Number(cursor)<=entries.length,400,'INVALID_DOCUMENT_PAGE')
        const end=Number(cursor)+Number(limit)
        return json(res,{snapshotId:fields['文档清单快照ID'],items:entries.slice(Number(cursor),end).map(d=>({
          documentId:d.documentId,sha256:d.sha256,verdict:({'通过':'pass','不通过':'reject'})[d.verdict] ?? 'unconfirmed'})),
          nextCursor:end<entries.length?String(end):null})
      }
      return json(res,{decisionRef:'dec-'+c.executionId,ticketNo:c.ticketNo,ticketType:c.ticketType,
        ticketTypeVersion:c.ticketTypeVersion,action:c.action,resourceId:c.resourceId,account:c.account,org:c.org,
        ...(['ACC-01','ACC-02'].includes(c.ticketType)?{recoveryBaseline:row.recoveryBaseline ?? row.snapshot?.recoveryBaseline ?? null}:{}),
        fields:row.approvedFields ?? c.payload,preconditions:row.preconditions ?? (['AG-02','AG-03','AG-04','AG-05'].includes(c.ticketType) ? [{kind:'agent',id:c.resourceId,revision:(row.approvedFields ?? c.payload).expectedRevision}] : [{kind:c.ticketType==='SKL-03'?'skill':'plugin',id:c.resourceId,sha256:c.payload.sha256}])})
    }
    // The role selector is a local demo identity. Ticket URLs belong to a browser session.
    let session = /(?:^|; *)app_session=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]
    function owns(row) {
      if(row.ownerSubjectId && identity?.active && row.ownerSubjectId!==identity.subjectId)return false
      if (identity?.active && !directory.owns(row.command.account,identity)) return false
      if (row.owner.startsWith('account:')) return identity?.active && directory.owns(row.owner.slice(8),identity)
      if(identity?.active)return session && row.owner===digest(session)
      const p=deliveryProfile(row)
      if(!directory.isActive(p) || directory.restricted(p.account) || p.revision!==(row.ownerRevision ?? 1) || p.account!==row.command.account)return false
      return session && row.owner===digest(session)
    }
    if (req.method==='POST' && (path==='/api/tickets' || path==='/api/execute')) {
      check(!req.headers.origin || new URL(req.headers.origin).host===req.headers.host,403,'ACCESS_DENIED')
      const input = await body(req)
      check(input && /^[A-Za-z0-9-]{1,100}$/.test(input.ticketNo) && typeof input.ticketNo==='string' && demoAccounts.has(input.account),400,'INVALID_REQUEST')
      check(input.version===undefined || typeof input.version==='string' && input.version.length>0 && input.version.length<=128,400,'INVALID_VERSION')
      check(input.ticketType==='SKL-03' && input.action==='download' || input.ticketType==='PLG-03' && input.action==='install',501,'UPSTREAM_UNSUPPORTED','此工单动作尚未接入')
      if (!session) { session=id(); res.setHeader('set-cookie','app_session='+session+'; Path=/api; HttpOnly; SameSite=Strict') }
      check(!identity?.active || identity.account===input.account,403,'ACCESS_DENIED')
      const owner = identity?.active ? 'account:'+identity.account : digest(session)
      let row=tickets.get(input.ticketNo)
      if (row) {
        check(owns(row) && row.command.account===input.account,404,'NOT_FOUND')
        check(row.selection===input.resourceId && row.command.ticketType===input.ticketType && (input.version===undefined || row.command.payload.version===input.version),409,'EXECUTION_CONFLICT')
      } else {
        const command={executionId:id(),ticketNo:input.ticketNo,ticketType:input.ticketType,ticketTypeVersion:types.activeVersion(input.ticketType,input.ticketType==='PLG-03'?process.env.DIFY_WORKSPACE_ID:''),action:input.action,resourceId:input.resourceId,account:input.account,org:demoAccounts.get(input.account)}
        if (input.ticketType==='SKL-03') {
          const item=await findSkill(input.resourceId,command)
          command.resourceId=item.resourceId
          let version=item
          if(input.version!==undefined) {
            version=await(await cap('/catalog/skill/'+encodeURIComponent(item.resourceId)+'?version='+encodeURIComponent(input.version),
              'GET',undefined,ownerHeaders({command}))).json()
            check(version.resourceId===item.resourceId && version.data?.version===input.version &&
              version.actions?.includes('download') && !['withdrawn','unavailable'].includes(version.status),403,'VERSION_UNAVAILABLE')
          }
          command.payload={version:version.data.version,sha256:version.data.sha256}
        } else {
          check(options.resolveInstallAccount && await options.resolveInstallAccount(req)===input.account,501,'UPSTREAM_UNSUPPORTED','真实安装需要已验证的管理端会话')
          check(process.env.DIFY_INSTALL_ACCOUNT===input.account && process.env.DIFY_WORKSPACE_ID,501,'UPSTREAM_UNSUPPORTED','无法自动执行：未配置 Dify 安装身份')
          const item = await (await cap('/catalog/plugin/'+encodeURIComponent(input.resourceId),'GET',undefined,ownerHeaders({command}))).json()
          command.payload={version:item.data.version,sha256:item.data.sha256,workspaceId:process.env.DIFY_WORKSPACE_ID}
        }
        // Recheck after asynchronous preflight, before inserting the frozen command.
        row=tickets.get(input.ticketNo)
        if (row) check(owns(row) && row.command.account===input.account && row.selection===input.resourceId && row.command.ticketType===input.ticketType && (input.version===undefined || row.command.payload.version===input.version),409,'EXECUTION_CONFLICT')
        else {
          check(types.activeVersion(input.ticketType,input.ticketType==='PLG-03'?process.env.DIFY_WORKSPACE_ID:'')===command.ticketTypeVersion,
            409,'TYPE_VERSION_CHANGED','类型版本已变化，请重新申请')
          const p=directory.byAccount(input.account)
          row=tickets.put(input.ticketNo,{ticketNo:input.ticketNo,owner,ownerSubjectId:p.subjectId,ownerRevision:p.revision,originDraft:req.draftClaim ?? null,
            ownerRole:identity?.roles[0] ?? demoAccounts.role(input.account),selection:input.resourceId,command,state:null,
            history:[{at:new Date().toISOString(),actor:input.account,action:'提交执行申请'}]})
        }
      }
      return json(res,visible(await refresh(row)))
    }
    if (req.method==='GET' && path==='/api/tickets') {
      const query=new URL(req.url,'http://localhost').searchParams
      const todo=query.get('view')==='todo'
      const staffQuery=query.get('view')==='query' || todo
      if(todo)check(identity?.active && hasRole(identity,'operator'),403,'ACCESS_DENIED')
      if (staffQuery) check(identity?.active && (hasRole(identity,'operator') || hasRole(identity,'admin')),403,'ACCESS_DENIED')
      const account=query.get('account') ?? identity?.account
      const items=tickets.all().filter(row=>{
        if(todo)return row.command.ticketType==='SKL-03' && !row.state?.result
        if (staffQuery) return hasRole(identity,'admin') || !row.command.ticketType.startsWith('ACC-')
        return owns(row) && (row.command.account===account || account===identity?.account && directory.owns(row.command.account,identity))
      }).reverse().map(row=>({
        ...(!staffQuery && row.state ? visible(row) : {}),
        ticketNo:row.ticketNo,ticketType:row.command.ticketType,selection:row.selection,executionId:row.command.executionId,
        cancelStatus:row.cancelRequest?.status ?? null,cancelError:row.cancelRequest?.error ?? null,deliveryClosed:!!row.deliveryClosure,
        status:row.state?.status ?? 'reconciling',failureReason:row.state?.result?.failureReason ?? '',
        updatedAt:row.state?.updatedAt ?? '',account:row.command.account,
      }))
      return json(res,{items})
    }
    const reconcile=/^\/api\/tickets\/([\w-]+)\/reconcile$/.exec(path)
    if(reconcile) {
      check(req.method==='POST' && identity?.active && hasRole(identity,'operator') &&
        (!req.headers.origin || new URL(req.headers.origin).host===req.headers.host),403,'ACCESS_DENIED')
      const row=tickets.get(reconcile[1]);check(row?.command.ticketType==='SKL-03',404,'NOT_FOUND')
      const input=await body(req)
      check(input.executionId===row.command.executionId,409,'EXECUTION_MISMATCH')
      check(typeof input.note==='string' && input.note.trim() && input.note.length<=4000,400,'NOTE_REQUIRED')
      tickets.transaction(()=>{const current=tickets.get(row.ticketNo);tickets.put(row.ticketNo,{...current,
        history:[...(current.history ?? []),{at:new Date().toISOString(),actor:identity.account,action:'查证文件原执行',note:input.note.trim(),executionId:row.command.executionId}]})})
      const current=await refresh(tickets.get(row.ticketNo),{queryOnly:true})
      const p=directory.get(identity.subjectId)
      check(directory.isActive(p) && p.revision===identity.profileRevision && p.roles.includes('operator'),403,'OPERATOR_SESSION_CHANGED')
      return json(res,visible(current))
    }
    const cancel=/^\/api\/tickets\/([\w-]+)\/cancel$/.exec(path)
    if(cancel) {
      check(req.method==='POST' && identity?.active && hasRole(identity,'operator') &&
        (!req.headers.origin || new URL(req.headers.origin).host===req.headers.host),403,'ACCESS_DENIED')
      const row=tickets.get(cancel[1]);check(row,404,'NOT_FOUND')
      const input=await body(req)
      check(typeof input.note==='string' && input.note.trim() && input.note.length<=4000,400,'NOTE_REQUIRED')
      const requested=delivery.beginCancel(row.ticketNo,input.executionId,identity.account,input.note.trim())
      if(requested.state?.status!=='cancelled' && requested.cancelRequest?.status!=='resolved')await cancelExecution(requested)
      const p=directory.get(identity.subjectId)
      check(directory.isActive(p) && p.revision===identity.profileRevision && p.roles.includes('operator'),403,'OPERATOR_SESSION_CHANGED')
      return json(res,visible(tickets.get(row.ticketNo)))
    }
    const match = /^\/api\/tickets\/([\w-]+)(\/file)?$/.exec(path)
    const row = match && tickets.get(match[1])
    check(req.method==='GET' && row && owns(row),404,'NOT_FOUND')
    if(match[2])check(!row.deliveryClosure && !row.cancelRequest,409,'DELIVERY_CLOSED','此流水已封住新领取')
    const current = await refresh(row)
    if (!match[2]) return json(res,visible(current))
    check(current.command.action==='download' && current.resultId,409,'NOT_READY')
    check(current.deliveryMetadata,409,'DELIVERY_METADATA_REQUIRED')
    const transferId=delivery.claim(row.ticketNo)
    function interrupted() {
      delivery.interrupt(row.ticketNo,transferId)
    }
    res.once('close',interrupted)
    try {
      const profile=deliveryProfile(current)
      check(directory.isActive(profile) && !directory.restricted(profile.account),403,'ACCOUNT_RESTRICTED')
      await currentDownloadGrant(current,profile)
      const file=await cap('/downloads/'+current.resultId,'GET',undefined,deliveryHeaders(current))
      const bytes=Buffer.from(await file.arrayBuffer())
      const sha256=digest(bytes)
      check(sha256===current.command.payload.sha256 && sha256===file.headers.get('x-content-sha256') && bytes.length===Number(file.headers.get('content-length')) &&
        bytes.length===current.deliveryMetadata.sizeBytes,409,'INVALID_DELIVERY')
      const fresh=directory.get(profile.subjectId)
      check(directory.isActive(fresh) && !directory.restricted(fresh.account) && fresh.revision===profile.revision &&
        (!identity || directory.session(token && identities.get(digest(token)))),403,'DELIVERY_IDENTITY_CHANGED')
      if (res.destroyed) {interrupted();return}
      delivery.emitting(row.ticketNo,transferId)
      for (const k of ['content-type','content-length','content-disposition','x-content-sha256']) res.setHeader(k,file.headers.get(k))
      res.setHeader('cache-control','no-store')
      res.once('finish',()=>{
        const address=options.resolveSourceIp?options.resolveSourceIp(req):req.socket.remoteAddress
        const pending=delivery.finish(row.ticketNo,transferId,{sha256,bytesSent:bytes.length,sourceIp:isIP(address ?? '')?address:null,
          recipient:{recipientSubjectId:profile.subjectId,recipientAccount:profile.account,recipientRevision:profile.revision}})
        if(!pending)return
        if (pending.receipt) void writeBack(pending).catch(()=>{})
      })
      res.end(bytes)
    } catch(error) {interrupted();throw error}
  }
  function handle(req,res,path) {
    const token=/(?:^|; *)management_identity=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]
    const identity=directory.session(token && identities.get(digest(token)))
    const address=options.resolveSourceIp?options.resolveSourceIp(req):req.socket?.remoteAddress
    return auditContext.run(identity?{...identity,sourceIp:isIP(address ?? '')?address:null}:identity,()=>drafts.withSubmission(req,res,identity,path,target=>dispatch(req,target,path)))
  }
  return {handle,close}
}
export function startManagement(options) {
  const api=managementApi(options)
  return listen(api.handle,{port:options.port,close:api.close})
}
