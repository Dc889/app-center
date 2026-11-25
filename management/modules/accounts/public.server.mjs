export * from './server/account-monitor.mjs'
export * from './server/account-recovery.mjs'
export * from './server/account-workflows.mjs'
export * from './server/routeAccountMonitor.mjs'
export * from './server/routeResourceHandover.mjs'
export * from './server/routeExpirations.mjs'

import {routeAccountMonitor} from './server/routeAccountMonitor.mjs'
import {routeResourceHandover} from './server/routeResourceHandover.mjs'
import {routeExpirations} from './server/routeExpirations.mjs'

export const moduleServer=Object.freeze({
  id:'accounts',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/account-monitor',handle:routeAccountMonitor}),
    Object.freeze({match:path=>path==='/api/resource-handover',handle:routeResourceHandover}),
    Object.freeze({match:path=>path==='/api/expirations' || path==='/api/expirations/renew' || path==='/api/expirations/revoke',handle:routeExpirations}),
  ]),
})
