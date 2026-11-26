import {check, json} from '../../../../runtime/http.mjs'
import {probeHostResources} from './host-resources.mjs'
import {dockerRestart, probeSubsystemServices} from './service-probe.mjs'
import {restartUnavailableServices, serviceMonitorReport} from './service-monitor.mjs'

export async function routeServiceMonitor(services) {
  const {applications, directory, hasRole, identity, options, req, res} = services
  check(req.method === 'GET' && identity?.active && (hasRole(identity, 'operator') || hasRole(identity, 'admin')), 403, 'ACCESS_DENIED')
  const current = directory.get(identity.subjectId)
  check(directory.isActive(current) && current.revision === identity.profileRevision && !directory.restricted(identity.account), 403, 'ACTOR_SESSION_CHANGED')
  const now = (options.now ?? Date.now)()
  const probe = await probeSubsystemServices(options.serviceProbe ? {run: options.serviceProbe} : {})
  const enabled = options.serviceAutoRestart ?? false
  const restart = options.serviceRestart ?? dockerRestart
  const actions = probe.availability === 'collected'
    ? await restartUnavailableServices({services: probe.services, applications, restart, now, enabled})
    : []
  const host = options.hostProbe ? await options.hostProbe() : await probeHostResources()
  return json(res, serviceMonitorReport({probe, actions, now, enabled, tickets: applications.records(), host}))
}
