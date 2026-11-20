import {check} from '../../../../runtime/http.mjs'
import {skillMonitorReport} from './skill-monitor.mjs'
import {json} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeSkillMonitor(services) {
  const {applications,cap,directory,hasRole,identity,options,ownerHeaders,req,res,tickets}=services;

      check(req.method === 'GET' && identity?.active && (hasRole(identity, 'operator') || hasRole(identity, 'admin')), 403, 'ACCESS_DENIED')
      const query = new URL(req.url, 'http://localhost').searchParams
      const report = await skillMonitorReport({
        query,
        now: (options.now ?? Date.now)(),
        cap,
        headers: ownerHeaders({ command: { account: identity.account, actorRole: identity.roles[0] } }),
        identity,
        tickets: tickets.all(),
        applications: applications.records(),
        directory,
      })
      const current = directory.get(identity.subjectId)
      check(directory.isActive(current) && current.revision === identity.profileRevision && !directory.restricted(identity.account), 403, 'ACTOR_SESSION_CHANGED')
      return json(res, report)
    

}
