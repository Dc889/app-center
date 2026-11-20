import {check} from '../../../../runtime/http.mjs'
import {json} from '../../../../runtime/http.mjs'
import {eventMonitor} from './event-monitor.mjs'
import {eventEvidence} from './event-monitor.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeEventMonitor(services) {
  const {accountChanges,applications,events,hasRole,identity,options,path,req,res,tickets}=services;

      check(req.method==='GET' && (hasRole(identity,'operator') || hasRole(identity,'admin')),403,'ACCESS_DENIED')
      const now=(options.now ?? Date.now)()
      if(path==='/api/event-monitor')return json(res,eventMonitor(events.all(),new URL(req.url,'http://localhost').searchParams,now,hasRole(identity,'admin')))
      const ticketNo=path.slice('/api/event-monitor/'.length)
      check(/^EVT-01-[\w-]{1,90}$/.test(ticketNo),400,'INVALID_EVENT')
      const row=events.get(ticketNo);check(row,404,'NOT_FOUND')
      return json(res,eventEvidence(row,[...applications.records(),...tickets.all(),...(hasRole(identity,'admin')?accountChanges.records():[])],now,hasRole(identity,'admin')))
    

}
