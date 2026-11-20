export * from './server/approveSKL01.mjs'
export * from './server/approveSKL04.mjs'
export * from './server/routeSkillMonitor.mjs'
export * from './server/skill-monitor.mjs'
export * from './server/skill-withdrawal.mjs'
export * from './server/submitSKL01.mjs'
export * from './server/submitSKL04.mjs'
export * from './server/workflows.mjs'

import {routeSkillMonitor} from './server/routeSkillMonitor.mjs'
import {skillWithdrawalContext} from './server/skill-withdrawal.mjs'
import {skillsWorkflows} from './server/workflows.mjs'

export const moduleServer=Object.freeze({
  id:'skills',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/skill-monitor',handle:routeSkillMonitor}),
  ]),
  workflows:skillsWorkflows,
  executionContexts:Object.freeze({
    'SKL-04':({cap,headers,resourceId})=>skillWithdrawalContext(cap,headers,resourceId),
  }),
})
