import {check} from '../../../../runtime/http.mjs'
import {agentWarehouseReport} from './agent-warehouse.mjs'
import {json} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeAgentWarehouse(services) {
  const {applications,directory,identity,options,req,res}=services;

      check(req.method === 'GET' && identity?.active, 403, 'ACCESS_DENIED')
      const query = new URL(req.url, 'http://localhost').searchParams
      const report = agentWarehouseReport({
        query,
        now: (options.now ?? Date.now)(),
        identity,
        applications: applications.records(),
      })
      const current = directory.get(identity.subjectId)
      check(directory.isActive(current) && current.revision === identity.profileRevision && !directory.restricted(identity.account), 403, 'ACTOR_SESSION_CHANGED')
      return json(res, report)
    

}
