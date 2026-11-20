import {check} from '../../../../runtime/http.mjs'
import {loadOverview} from './overview.mjs'
import {json} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeOverview(services) {
  const {accountChanges,applications,cap,directory,events,hasRole,identity,options,ownerHeaders,req,res,tickets}=services;

      check(req.method==='GET' && (hasRole(identity,'operator') || hasRole(identity,'admin')),403,'ACCESS_DENIED')
      const range=new URL(req.url,'http://localhost').searchParams.get('range') ?? '24h'
      check(['1h','24h','7d'].includes(range),400,'INVALID_RANGE')
      const headers=ownerHeaders({command:{account:identity.account,actorRole:identity.roles[0]}})
      const result=await loadOverview({range,now:(options.now ?? Date.now)(),cap,headers,records:()=>({
        applications:applications.records(),accounts:hasRole(identity,'admin')?accountChanges.records():[],
        tickets:tickets.all(),events:events.all(),admin:hasRole(identity,'admin'),
      })})
      const current=directory.get(identity.subjectId)
      check(directory.isActive(current) && current.revision===identity.profileRevision && !directory.restricted(identity.account),403,'ACTOR_SESSION_CHANGED')
      return json(res,result)
    

}
