import {submitMCP01} from './submitMCP01.mjs'
import {submitMCP03} from './submitMCP03.mjs'
import {submitMCP02} from './submitMCP02.mjs'
import {approveMCP02} from './approveMCP02.mjs'
import {approveMCP03} from './approveMCP03.mjs'
import {approveMCP01} from './approveMCP01.mjs'

export const mcpWorkflows=Object.freeze({
  submissions:Object.freeze({'MCP-01':submitMCP01,'MCP-03':submitMCP03,'MCP-02':submitMCP02}),
  approvals:Object.freeze({'MCP-02':approveMCP02,'MCP-03':approveMCP03,'MCP-01':approveMCP01})
})
