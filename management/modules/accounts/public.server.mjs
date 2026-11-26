export * from './server/account-monitor.mjs'
export * from './server/account-recovery.mjs'
export * from './server/account-workflows.mjs'
export * from './server/routeAccountMonitor.mjs'
export * from './server/routeResourceHandover.mjs'
export * from './server/routeExpirations.mjs'
export * from './server/routeModelQuotas.mjs'
export * from './server/routeModelBatch.mjs'
export * from './server/routeProfile.mjs'

import {routeAccountMonitor} from './server/routeAccountMonitor.mjs'
import {routeResourceHandover} from './server/routeResourceHandover.mjs'
import {routeExpirations} from './server/routeExpirations.mjs'
import {routeModelQuotas} from './server/routeModelQuotas.mjs'
import {routeModelBatch} from './server/routeModelBatch.mjs'
import {routeProfile} from './server/routeProfile.mjs'

export const moduleServer=Object.freeze({
  id:'accounts',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/account-monitor',handle:routeAccountMonitor}),
    Object.freeze({match:path=>path==='/api/resource-handover' || path==='/api/resource-handover/approve',handle:routeResourceHandover}),
    Object.freeze({match:path=>path==='/api/expirations' || path==='/api/expirations/renew' || path==='/api/expirations/revoke',handle:routeExpirations}),
    Object.freeze({match:path=>path==='/api/model-quotas' || path.startsWith('/api/model-quotas/'),handle:routeModelQuotas}),
    Object.freeze({match:path=>path==='/api/model-batch' || path.startsWith('/api/model-batch/'),handle:routeModelBatch}),
    Object.freeze({match:path=>path==='/api/profile/me' || path==='/api/org-role-requests' || path==='/api/org-role-requests/approve',handle:routeProfile}),
  ]),
})
