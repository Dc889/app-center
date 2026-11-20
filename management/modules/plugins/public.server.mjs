export * from './server/approvePLG01.mjs'
export * from './server/approvePLG03.mjs'
export * from './server/plugin-monitor.mjs'
export * from './server/plugin-operation.mjs'
export * from './server/plugin-safety.mjs'
export * from './server/routePluginMonitor.mjs'
export * from './server/routePluginOperationContext.mjs'
export * from './server/submitPLG01.mjs'
export * from './server/submitPLG03.mjs'
export * from './server/workflows.mjs'

import {routePluginMonitor} from './server/routePluginMonitor.mjs'
import {routePluginOperationContext} from './server/routePluginOperationContext.mjs'
import {pluginsWorkflows} from './server/workflows.mjs'

export const moduleServer=Object.freeze({
  id:'plugins',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/plugin-operation-context',handle:routePluginOperationContext}),
    Object.freeze({match:path=>path==='/api/plugin-monitor',handle:routePluginMonitor}),
  ]),
  workflows:pluginsWorkflows,
})
