export * from './server/approveTOL01.mjs'
export * from './server/submitTOL01.mjs'
export * from './server/tool-approval.mjs'
export * from './server/workflows.mjs'

import {toolContext} from './server/tool-approval.mjs'
import {toolsWorkflows} from './server/workflows.mjs'

export const moduleServer=Object.freeze({
  id:'tools',
  routes:Object.freeze([]),
  workflows:toolsWorkflows,
  executionContexts:Object.freeze({
    'TOL-01':({cap,headers,resourceId,query})=>toolContext(cap,headers,resourceId,query.get('workspaceId') ?? '',query.get('operation')),
  }),
})
