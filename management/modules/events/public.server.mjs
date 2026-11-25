export * from './server/event-monitor.mjs'
export * from './server/routeEventMonitor.mjs'
export * from './server/routeEvents.mjs'
export * from './server/compliance-reconcile.mjs'
export * from './server/routeComplianceReconcile.mjs'

import {routeEventMonitor} from './server/routeEventMonitor.mjs'
import {routeEvents} from './server/routeEvents.mjs'
import {routeComplianceReconcile} from './server/routeComplianceReconcile.mjs'

export const moduleServer=Object.freeze({
  id:'events',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/event-monitor' || path.startsWith('/api/event-monitor/'),handle:routeEventMonitor}),
    Object.freeze({match:path=>path==='/api/compliance-reconcile' || path==='/api/compliance-reconcile/create-event',handle:routeComplianceReconcile}),
    Object.freeze({match:path=>path==='/api/events' || path==='/api/events/transition' || path==='/api/events/attachments',handle:routeEvents}),
  ]),
})
