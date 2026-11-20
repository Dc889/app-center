import {ApiError,check,client,digest,json,ledger} from '../../../../runtime/http.mjs'
export function intakeApi({dir,executor,token},headersFor,ownsHistorical) {
  const refs=ledger(dir,'upload-references')
  const cap=client(executor,token)
  async function handle(req,res,path,identity) {
    check(identity?.active,403,'ACCESS_DENIED')
    const match=/^\/api\/intake\/(skill|plugin)(?:\/([\w-]+))?$/.exec(path)
    check(match,404,'NOT_FOUND')
    const [,kind,intakeId]=match
    const headers=headersFor(identity)
    const owns=reference=>reference && (reference.ownerSubjectId?reference.ownerSubjectId===identity.subjectId:
      reference.account===identity.account || ownsHistorical?.(reference.account,identity))
    if(req.method==='GET' && intakeId) {
      const reference=refs.get(kind+'/'+intakeId)
      check(owns(reference),404,'NOT_FOUND')
      const data=await(await cap('/intake/'+kind+'/'+encodeURIComponent(intakeId),'GET',undefined,headers)).json()
      check(data.intakeId===intakeId,503,'INTAKE_MISMATCH')
      if(identity.roles.includes('user') && data.scan)data.scan={checkedAt:data.scan.checkedAt,verdict:data.scan.verdict}
      return json(res,data)
    }
    check(req.method==='POST' && !intakeId,405,'METHOD_NOT_ALLOWED')
    check(!req.headers.origin || new URL(req.headers.origin).host===req.headers.host,403,'ACCESS_DENIED')
    const key=req.headers['idempotency-key']
    check(typeof key==='string' && /^[\w-]{1,100}$/.test(key),400,'UPLOAD_KEY_REQUIRED')
    const contentType=req.headers['content-type']
    check(typeof contentType==='string' && contentType.length<=200 &&
      /^multipart\/form-data;\s*boundary=/.test(contentType),400,'INVALID_UPLOAD_FORMAT')
    const abort=new AbortController()
    const disconnect=()=>abort.abort()
    req.once('aborted',disconnect)
    res.once('close',()=>{if(!res.writableFinished)abort.abort()})
    try {
      const response=await fetch(executor+'/internal/v1/intake/'+kind,{method:'POST',
        headers:{authorization:'Bearer '+token,...headers,'content-type':contentType,
          'Idempotency-Key':digest((identity.subjectId ?? identity.account)+'/'+kind+'/'+key)},
        body:req,duplex:'half',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(120000)])})
      const data=await response.json()
      if(!response.ok)throw new ApiError(response.status,data.error?.code ?? 'INTAKE_ERROR',data.error?.message ?? '上传未受理')
      check(typeof data.intakeId==='string' && /^[\w-]+$/.test(data.intakeId) &&
        ['received','scanning','ready','rejected','failed'].includes(data.status),503,'INVALID_INTAKE_RESPONSE')
      const existing=refs.get(kind+'/'+data.intakeId)
      check(!existing || owns(existing),409,'INTAKE_OWNER_CONFLICT')
      refs.put(kind+'/'+data.intakeId,{account:existing?.account ?? identity.account,ownerSubjectId:identity.subjectId,
        kind,intakeId:data.intakeId,status:data.status})
      if(!res.destroyed)return json(res,{intakeId:data.intakeId,status:data.status},response.status)
    } finally {req.off('aborted',disconnect)}
  }
  return {handle,close:refs.close}
}
