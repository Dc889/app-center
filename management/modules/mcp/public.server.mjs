export * from './server/approveMCP01.mjs'
export * from './server/approveMCP02.mjs'
export * from './server/approveMCP03.mjs'
export * from './server/mcp-binding.mjs'
export * from './server/mcp-disposition.mjs'
export * from './server/mcp-monitor.mjs'
export * from './server/mcp-registration.mjs'
export * from './server/routeMcpBindingContext.mjs'
export * from './server/routeMcpMonitor.mjs'
export * from './server/submitMCP01.mjs'
export * from './server/submitMCP02.mjs'
export * from './server/submitMCP03.mjs'
export * from './server/workflows.mjs'

import {mcpDispositionActions,mcpDispositionContext} from './server/mcp-disposition.mjs'
import {routeMcpBindingContext} from './server/routeMcpBindingContext.mjs'
import {routeMcpMonitor} from './server/routeMcpMonitor.mjs'
import {mcpWorkflows} from './server/workflows.mjs'

export const moduleServer=Object.freeze({
  id:'mcp',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/mcp-binding-context',handle:routeMcpBindingContext}),
    Object.freeze({match:path=>path==='/api/mcp-monitor',handle:routeMcpMonitor}),
  ]),
  workflows:mcpWorkflows,
  executionContexts:Object.freeze({
    'MCP-03':async ({cap,headers,resourceId,ticketType,action})=>{
      const operation=Object.keys(mcpDispositionActions).find(key=>mcpDispositionActions[key]===action)
      const snapshot=await mcpDispositionContext(cap,headers,resourceId,'',{operation},{discovery:true})
      return {snapshotId:snapshot.snapshotId,ticketType,action,resourceId,capturedAt:snapshot.capturedAt,
        fields:{'绑定清单快照ID':snapshot.fields['绑定清单快照ID'],'绑定清单完整':snapshot.fields['绑定清单完整']===true,
          '绑定清单':[...new Map(snapshot.fields['绑定清单'].map(b=>[JSON.stringify([b.account,b.workspaceId]),{account:b.account,workspaceId:b.workspaceId}])).values()]},
        preconditions:snapshot.preconditions.filter(p=>p && p.kind==='mcp' && p.id===resourceId).map(({kind,id,revision})=>({kind,id,revision}))}
    },
  }),
})
