import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {check,json,ledger,id,digest} from '../../../../runtime/http.mjs'

export function evidenceStore(dir,{resolveSubjectId,ownsHistorical,auditLogger}={}) {
  const records=ledger(dir,'evidence')
  const auditStore=ledger(dir,'evidence-audit')
  const folder=join(dir,'evidence-files')
  function owns(row,account,subjectId) {
    if(!row)return false
    const currentSubjectId=subjectId ?? resolveSubjectId?.(account)
    return row.ownerSubjectId?row.ownerSubjectId===currentSubjectId:
      row.account===account || currentSubjectId && ownsHistorical?.(row.account,{subjectId:currentSubjectId})
  }
  function references(ids,account) {
    check(Array.isArray(ids) && ids.length<=20 && new Set(ids).size===ids.length,400,'INVALID_EVIDENCE')
    return ids.map(key=>{
      const row=typeof key==='string' && records.get(key)
      check(owns(row,account),403,'EVIDENCE_NOT_OWNED')
      return {evidenceId:row.evidenceId,filename:row.filename,sha256:row.sha256,sizeBytes:row.sizeBytes}
    })
  }
  async function handle(req,res,path,identity,canReview) {
    check(identity?.active,403,'ACCESS_DENIED')
    if(path==='/api/evidence' && req.method==='POST') {
      check(!req.headers.origin || new URL(req.headers.origin).host===req.headers.host,403,'ACCESS_DENIED')
      let filename
      try{filename=decodeURIComponent(req.headers['x-filename'] ?? '')}catch{check(false,400,'INVALID_FILENAME')}
      check(filename && filename.length<=200 && !/[\\/]/.test(filename) && ![...filename].some(c=>c.charCodeAt(0)<32),400,'INVALID_FILENAME')
      const chunks=[]
      let sizeBytes=0
      for await(const chunk of req) {
        sizeBytes+=chunk.length
        check(sizeBytes<=10*1024*1024,413,'EVIDENCE_TOO_LARGE','证据附件不能超过10MB')
        chunks.push(chunk)
      }
      check(sizeBytes>0,400,'EMPTY_EVIDENCE')
      const evidenceId=id(),bytes=Buffer.concat(chunks)
      const row={evidenceId,account:identity.account,ownerSubjectId:identity.subjectId,filename,sizeBytes,sha256:digest(bytes),createdAt:new Date().toISOString()}
      await mkdir(folder,{recursive:true})
      const file=join(folder,evidenceId)
      await writeFile(file,bytes,{flag:'wx'})
      try {
        records.put(evidenceId,row)
        const auditEntry={
          action:'upload_evidence',evidenceId,account:identity.account,
          ownerSubjectId:identity.subjectId,filename,sizeBytes,sha256:row.sha256,at:new Date().toISOString()
        }
        auditStore.put(id(),auditEntry)
        auditLogger?.(auditEntry)
      }catch(error){await unlink(file);throw error}
      return json(res,row,201)
    }
    const match=/^\/api\/evidence\/([a-f0-9-]{36})(\/file)?$/.exec(path)
    const row=match && records.get(match[1])
    const applicationOnly=new URL(req.url,'http://localhost').searchParams.get('forApplication')==='1'
    check(req.method==='GET' && row && (owns(row,identity.account,identity.subjectId) || !applicationOnly && canReview(row.evidenceId,identity)),404,'NOT_FOUND')
    if(!match[2]) {
      const auditEntry={action:'query_evidence_meta',evidenceId:row.evidenceId,account:identity.account,at:new Date().toISOString()}
      auditStore.put(id(),auditEntry)
      auditLogger?.(auditEntry)
      return json(res,row)
    }
    const bytes=await readFile(join(folder,row.evidenceId))
    check(digest(bytes)===row.sha256,409,'EVIDENCE_CORRUPT')
    const auditEntry={action:'download_evidence_file',evidenceId:row.evidenceId,account:identity.account,filename:row.filename,at:new Date().toISOString()}
    auditStore.put(id(),auditEntry)
    auditLogger?.(auditEntry)
    res.writeHead(200,{'content-type':'application/octet-stream','content-length':bytes.length,
      'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(row.filename),'cache-control':'no-store',
      'x-content-type-options':'nosniff','x-content-sha256':row.sha256})
    res.end(bytes)
  }
  return {references,handle,auditRecords:()=>auditStore.all(),close:()=>{records.close();auditStore.close()}}
}
