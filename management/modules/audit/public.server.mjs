export * from './server/audit-report.mjs'
export * from './server/routeAudit.mjs'

import {routeAudit} from './server/routeAudit.mjs'

export const moduleServer=Object.freeze({
  id:'audit',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/audit' || path==='/api/audit-report' || path==='/api/audit-report/export',handle:routeAudit}),
  ]),
})
