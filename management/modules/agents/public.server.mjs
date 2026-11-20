export * from './server/agent-impact.mjs'
export * from './server/agent-management.mjs'
export * from './server/agent-monitor.mjs'
export * from './server/agent-replacements.mjs'
export * from './server/agent-warehouse.mjs'
export * from './server/application-targets.mjs'
export * from './server/approveAG02.mjs'
export * from './server/approveAG03.mjs'
export * from './server/approveAG04.mjs'
export * from './server/approveAG05.mjs'
export * from './server/routeAgentImpact.mjs'
export * from './server/routeAgentMonitor.mjs'
export * from './server/routeAgentReplacements.mjs'
export * from './server/routeAgentWarehouse.mjs'
export * from './server/routeApplicationTargets.mjs'
export * from './server/workflows.mjs'

import {routeAgentImpact} from './server/routeAgentImpact.mjs'
import {routeAgentMonitor} from './server/routeAgentMonitor.mjs'
import {routeAgentReplacements} from './server/routeAgentReplacements.mjs'
import {routeAgentWarehouse} from './server/routeAgentWarehouse.mjs'
import {routeApplicationTargets} from './server/routeApplicationTargets.mjs'
import {agentsWorkflows} from './server/workflows.mjs'

export const moduleServer=Object.freeze({
  id:'agents',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/agent-impact',handle:routeAgentImpact}),
    Object.freeze({match:path=>path==='/api/agent-replacements' || path.startsWith('/api/agent-replacements/'),handle:routeAgentReplacements}),
    Object.freeze({match:path=>path==='/api/application-targets' || path.startsWith('/api/application-targets/'),handle:routeApplicationTargets}),
    Object.freeze({match:path=>path==='/api/agent-monitor',handle:routeAgentMonitor}),
    Object.freeze({match:path=>path==='/api/agent-warehouse',handle:routeAgentWarehouse}),
  ]),
  workflows:agentsWorkflows,
})
