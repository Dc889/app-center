import {readFileSync} from 'node:fs'
import {body,check,json,ledger,id,digest} from '../../../../runtime/http.mjs'
import {isUtcTimestamp} from '../../../../runtime/execution-state.mjs'
const schemas=JSON.parse(readFileSync(new URL('../../../../contracts/management-api/draft-fields.json',import.meta.url),'utf8'))
const words=s=>(s ?? '').split(' ').filter(Boolean)
const text=v=>typeof v==='string' && v.length<=4000
const plain=v=>!!v && typeof v==='object' && !Array.isArray(v)
const activeClaims=new Set()
const at=()=>new Date().toISOString()
const endpoints=['/api/events','/api/applications','/api/account-applications','/api/tickets','/api/execute']
const stable=value=>Array.isArray(value)?value.map(stable):plain(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value
export function draftApi(dir,owns=(account,identity)=>account===identity.account,options={}) {
  const drafts=ledger(dir,'application-drafts',options.actorSnapshot)
  function authorized(type,identity) {
    check(identity?.active,403,'ACCESS_DENIED')
    check(!type?.startsWith('ACC-') || identity.roles.includes('admin'),403,'ACCESS_DENIED')
    check(Object.hasOwn(schemas,type),400,'INVALID_DRAFT_TYPE','系统转单或未知类型不能作为人工申请草稿')
  }
  const own=(row,identity)=>row && (row.ownerSubjectId?row.ownerSubjectId===identity?.subjectId:owns(row.account,identity))
  function claimBusy(row) {
    if(row.submission.processId===process.pid)return activeClaims.has(row.submission.claimId)
    try{process.kill(row.submission.processId,0);return true}catch(error){return error.code!=='ESRCH'}
  }
  function fields(type,value) {
    check(plain(value),400,'INVALID_FIELDS')
    const schema=schemas[type],allowed=[...words(schema.strings),...words(schema.dates),...words(schema.lists),...Object.keys(schema.records ?? {})]
    check(Object.keys(value).every(k=>allowed.includes(k)),400,'INVALID_DRAFT_FIELD','草稿只允许可编辑业务字段，不保存凭证或产品快照')
    for(const [key,v] of Object.entries(value)) {
      if(words(schema.strings).includes(key))check(text(v),400,'INVALID_DRAFT_FIELD')
      else if(words(schema.dates).includes(key))check(text(v) && (!v || isUtcTimestamp(v)),400,'DRAFT_TIMEZONE_REQUIRED')
      else if(words(schema.lists).includes(key))check(Array.isArray(v) && v.length<=200 && v.every(text),400,'INVALID_DRAFT_FIELD')
      else check(Array.isArray(v) && v.length<=100 && v.every(item=>plain(item) && Object.keys(item).every(k=>words(schema.records[key]).includes(k)) && Object.values(item).every(text)),400,'INVALID_DRAFT_FIELD')
    }
    return value
  }
  const workspace=row=>row.fields.workspaceId ?? ''
  function version(row){return options.activeVersion?.(row.ticketType,workspace(row)) ?? '1'}
  function validateVersion(row) {
    const current=version(row)
    check(!row.ticketTypeVersion || current===row.ticketTypeVersion,409,'DRAFT_TYPE_VERSION_CHANGED','类型版本已变化，请核对后保存为新草稿')
  }
  function reconcile(row) {
    if(row.status!=='submitting')return row
    const ticket=options.findSubmission?.(row)
    if(!ticket)return row
    return drafts.transaction(()=>{
      const current=drafts.get(row.draftId)
      if(current.status!=='submitting' || current.submission.claimId!==row.submission.claimId)return current
      return drafts.put(row.draftId,{...current,status:'submitted',revision:current.revision+1,updatedAt:at(),
        history:[...(current.history ?? []),{at:at(),actor:'system',action:'草稿归档关联工单',ticketNo:row.submission.ticketNo}]})
    })
  }
  function project(row) {
    let restoreBlockedCode=null
    if(['draft','submitting'].includes(row.status))try{validateVersion(row)}catch(error){restoreBlockedCode=error.code ?? 'TYPE_UNAVAILABLE'}
    return {...row,canRestore:row.status==='draft' && !restoreBlockedCode,canRecover:row.status==='submitting' && !restoreBlockedCode && !claimBusy(row) && !options.findSubmission?.(row),restoreBlockedCode}
  }
  async function handle(req,res,identity,path='/api/drafts') {
    check(identity?.active,403,'ACCESS_DENIED')
    if(req.method==='GET' && path==='/api/drafts')return json(res,{items:drafts.all().filter(d=>own(d,identity) && Object.hasOwn(schemas,d.ticketType) &&
      (!d.ticketType.startsWith('ACC-') || identity.roles.includes('admin'))).map(reconcile).reverse().map(project)})
    check(req.method==='POST' && (!req.headers.origin || new URL(req.headers.origin).host===req.headers.host),403,'ACCESS_DENIED')
    const input=await body(req)
    check(typeof input?.draftId==='string' && /^[\w-]{1,100}$/.test(input.draftId) && Number.isInteger(input.revision) && input.revision>=0,400,'INVALID_DRAFT')
    const previous=drafts.get(input.draftId)
    check(!previous || own(previous,identity),404,'NOT_FOUND')
    if(path==='/api/drafts/recover') {
      check(previous,404,'NOT_FOUND');authorized(previous.ticketType,identity)
      const row=reconcile(previous)
      validateVersion(row)
      return json(res,drafts.transaction(()=>{
        const current=drafts.get(input.draftId)
        check(current.revision===input.revision && current.status==='submitting' && row.status!=='submitted',409,'DRAFT_NOT_EDITABLE')
        check(!claimBusy(current) && !options.findSubmission?.(current),409,'DRAFT_SUBMISSION_BUSY')
        return drafts.put(current.draftId,{...current,status:'draft',submission:null,revision:current.revision+1,updatedAt:at(),
          history:[...(current.history ?? []),{at:at(),actor:identity.account,action:'恢复未受理草稿',ticketNo:current.submission.ticketNo}]})
      }))
    }
    if(path==='/api/drafts/restore') {
      check(previous,404,'NOT_FOUND');authorized(previous.ticketType,identity)
      const row=reconcile(previous)
      check(row.status==='draft' && row.revision===input.revision,409,'DRAFT_NOT_EDITABLE')
      validateVersion(row);fields(row.ticketType,row.fields)
      return json(res,project(row))
    }
    check(path==='/api/drafts',404,'NOT_FOUND');authorized(input.ticketType,identity)
    const value=fields(input.ticketType,input.fields)
    return json(res,drafts.transaction(()=>{
      const current=drafts.get(input.draftId)
      check(!current || own(current,identity),404,'NOT_FOUND')
      check((current?.revision ?? 0)===input.revision,409,'VERSION_CONFLICT','草稿已更新，请重新读取')
      check(!current || current.status==='draft',409,'DRAFT_NOT_EDITABLE')
      check(!current || current.ticketType===input.ticketType,409,'TYPE_CONFLICT')
      const row={draftId:input.draftId,ticketType:input.ticketType,fields:value}
      const selectedVersion=version(row)
      check(!current?.ticketTypeVersion || current.ticketTypeVersion===selectedVersion,409,'DRAFT_TYPE_VERSION_CHANGED','类型版本已变化，请核对后保存为新草稿')
      return drafts.put(input.draftId,{...row,account:current?.account ?? identity.account,ownerSubjectId:current?.ownerSubjectId ?? identity.subjectId,
        ticketTypeVersion:selectedVersion,revision:input.revision+1,status:'draft',updatedAt:at(),
        history:[...(current?.history ?? []),{at:at(),actor:identity.account,action:'保存申请草稿'}]})
    }))
  }
  function submitted(row) {return options.findSubmission?.(row)}
  async function withSubmission(req,res,identity,path,work) {
    if(req.method!=='POST' || !endpoints.includes(path))return work(res)
    const input=await body(req)
    if(!input?.draft)return work(res)
    check(identity?.active && (!req.headers.origin || new URL(req.headers.origin).host===req.headers.host),403,'ACCESS_DENIED')
    check(!identity.restricted || path==='/api/account-applications',403,'ACCOUNT_CHANGE_PENDING')
    const ref=input.draft
    check(plain(ref) && typeof ref.draftId==='string' && /^[\w-]{1,100}$/.test(ref.draftId) && Number.isInteger(ref.revision) && ref.revision>=0,400,'INVALID_DRAFT_REFERENCE')
    const previous=drafts.get(ref.draftId)
    check(own(previous,identity),404,'NOT_FOUND');authorized(previous.ticketType,identity)
    check(typeof input.ticketNo==='string' && input.ticketNo.startsWith(previous.ticketType+'-') &&
      (path==='/api/events'?previous.ticketType==='EVT-01':input.ticketType===previous.ticketType) &&
      (previous.ticketType.startsWith('ACC-')?path==='/api/account-applications':previous.ticketType==='EVT-01'?path==='/api/events':true),409,'DRAFT_TICKET_MISMATCH')
    const payload={...input};delete payload.draft
    const hash=digest(JSON.stringify(stable(payload)))
    let claimed=drafts.transaction(()=>{
      const row=drafts.get(ref.draftId)
      if(row.submission) {
        check(row.submission.sourceRevision===ref.revision && row.submission.ticketNo===input.ticketNo && row.submission.hash===hash && row.submission.path===path,409,'DRAFT_SUBMISSION_CONFLICT')
        if(row.status==='submitted' || submitted(row))return row
        check(!claimBusy(row),409,'DRAFT_SUBMISSION_BUSY')
      }else {
        check(row.status==='draft' && row.revision===ref.revision,409,'VERSION_CONFLICT')
        validateVersion(row);fields(row.ticketType,row.fields)
      }
      return drafts.put(row.draftId,{...row,ownerSubjectId:row.ownerSubjectId ?? identity.subjectId,status:'submitting',revision:row.revision+1,updatedAt:at(),
        submission:{ticketNo:input.ticketNo,path,hash,sourceRevision:ref.revision,claimId:id(),processId:process.pid},
        history:[...(row.history ?? []),{at:at(),actor:identity.account,action:'草稿开始提交',ticketNo:input.ticketNo}]})
    })
    if(claimed.status==='submitting' && submitted(claimed))claimed=reconcile(claimed)
    activeClaims.add(claimed.submission.claimId)
    req.draftClaim={draftId:claimed.draftId,sourceRevision:claimed.submission.sourceRevision,hash:claimed.submission.hash,
      ticketNo:claimed.submission.ticketNo,ownerSubjectId:claimed.ownerSubjectId,claimId:claimed.submission.claimId}
    let status=200,output,ended=false
    const headers=new Map()
    const buffered=new Proxy(res,{get(target,key){
      if(key==='setHeader')return (name,value)=>{headers.set(name,value);return buffered}
      if(key==='writeHead')return (code,values)=>{status=code;for(const [name,value] of Object.entries(values ?? {}))headers.set(name,value);return buffered}
      if(key==='end')return value=>{output=value;ended=true;return buffered}
      if(key==='headersSent')return false
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value
    }})
    try {
      await work(buffered)
      const resolved=reconcile(drafts.get(ref.draftId))
      if(ended && status>=300 && resolved.status!=='submitted') {
        const problem=JSON.parse(String(output))
        check(false,status,problem.error?.code ?? 'SUBMISSION_REJECTED',problem.error?.message ?? '提交未受理')
      }
      check(ended && (status>=300 || resolved.status==='submitted'),503,'DRAFT_SUBMISSION_UNCONFIRMED')
      for(const [name,value] of headers)res.setHeader(name,value)
      res.writeHead(status);res.end(output)
    }catch(error) {
      const current=reconcile(drafts.get(ref.draftId))
      if(current.status==='submitting' && !submitted(current))drafts.transaction(()=>{
        const latest=drafts.get(ref.draftId)
        if(latest.submission?.claimId===claimed.submission.claimId)drafts.put(ref.draftId,{...latest,status:'draft',submission:null,
          revision:latest.revision+1,updatedAt:at(),history:[...(latest.history ?? []),{at:at(),actor:'system',action:'草稿提交未受理',code:error.code ?? 'SERVICE_UNAVAILABLE'}]})
      })
      throw error
    }finally{activeClaims.delete(claimed.submission.claimId);delete req.draftClaim}
  }
  return {handle,withSubmission,records:drafts.all,close:drafts.close}
}
