export * from './web/McpDisposition'
export * from './web/McpMonitor'
export * from './web/McpRegistration'
export * from './web/McpWarehouse'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {McpDisposition} from './web/McpDisposition'
import {McpMonitor} from './web/McpMonitor'
import {McpRegistration} from './web/McpRegistration'
import {McpWarehouse} from './web/McpWarehouse'

export const moduleWeb = defineWebModule({
  id: 'mcp',
  views: {
    mcp: ({role, onWorkOrder}) => createElement(McpMonitor, {key: role, role, onWorkOrder}),
    mcpWarehouse: ({role}) => createElement(McpWarehouse, {key: role, role}),
  },
  ticketForms: {
    'MCP-01': () => createElement(McpRegistration),
    'MCP-03': ({account}) => createElement(McpDisposition, {account}),
  },
})
