import {check} from '../../../../runtime/http.mjs'
import {agentMonitorReport} from './agent-monitor.mjs'
import {json} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeAgentMonitor(services) {
  const {applications,cap,directory,hasRole,identity,options,ownerHeaders,req,res,subsystems}=services;

      check(req.method === 'GET' && identity?.active && (hasRole(identity, 'operator') || hasRole(identity, 'admin')), 403, 'ACCESS_DENIED')
      const query = new URL(req.url, 'http://localhost').searchParams
      const report = await agentMonitorReport({
        query,
        now: (options.now ?? Date.now)(),
        cap,
        headers: ownerHeaders({ command: { account: identity.account, actorRole: identity.roles[0] } }),
        identity,
        applications: applications.records(),
        difyInventory: subsystems?.getDifyInventory?.() ?? null,
        directory,
      })
      const current = directory.get(identity.subjectId)
      check(directory.isActive(current) && current.revision === identity.profileRevision && !directory.restricted(identity.account), 403, 'ACTOR_SESSION_CHANGED')
      return json(res, report)
    

}
