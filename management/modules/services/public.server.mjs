export * from './server/service-probe.mjs'
export * from './server/service-monitor.mjs'
export * from './server/routeServiceMonitor.mjs'
export * from './server/routeServiceRestart.mjs'

import {routeServiceMonitor} from './server/routeServiceMonitor.mjs'
import {routeServiceRestart} from './server/routeServiceRestart.mjs'

export const moduleServer = Object.freeze({
  id: 'services',
  routes: Object.freeze([
    Object.freeze({match: path => path === '/api/service-monitor', handle: routeServiceMonitor}),
    Object.freeze({match: path => path === '/api/service-restart' || path.startsWith('/api/service-restart/'), handle: routeServiceRestart}),
  ]),
})
