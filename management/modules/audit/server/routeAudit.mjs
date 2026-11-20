import {check} from '../../../../runtime/http.mjs'
import {json} from '../../../../runtime/http.mjs'
import {localAudit} from './audit-report.mjs'
import {auditReport} from './audit-report.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeAudit(services) {
  const {accountChanges,applications,cap,directory,drafts,events,hasRole,identity,options,ownerHeaders,path,req,res,tickets,types}=services;

      check(req.method==='GET' && identity?.active && (hasRole(identity,'operator') || hasRole(identity,'admin')),403,'ACCESS_DENIED')
      const records=()=>({drafts:drafts.records(),events:events.all(),types:types.records(),tickets:tickets.all(),applications:applications.records(),accounts:hasRole(identity,'admin')?accountChanges.records():[]})
      if(path==='/api/audit')return json(res,{items:localAudit(records(),identity)})
      const query=new URL(req.url,'http://localhost').searchParams
      if(path.endsWith('/export'))check(['management','access'].includes(query.get('table')),400,'INVALID_EXPORT')
      const report=await auditReport({query,now:(options.now ?? Date.now)(),cap,headers:ownerHeaders({command:{account:identity.account,actorRole:identity.roles[0]}}),identity,records})
      const current=directory.get(identity.subjectId)
      check(directory.isActive(current) && current.revision===identity.profileRevision && !directory.restricted(identity.account),403,'ACTOR_SESSION_CHANGED')
      const {exportManagement,exportAccess,...publicReport}=report
      if(path.endsWith('/export'))return json(res,query.get('table')==='management'?exportManagement:exportAccess)
      return json(res,publicReport)
    

}
