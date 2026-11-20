export * from './server/account-monitor.mjs'
export * from './server/account-recovery.mjs'
export * from './server/account-workflows.mjs'
export * from './server/routeAccountMonitor.mjs'

import {routeAccountMonitor} from './server/routeAccountMonitor.mjs'

export const moduleServer=Object.freeze({
  id:'accounts',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/account-monitor',handle:routeAccountMonitor}),
  ]),
})
