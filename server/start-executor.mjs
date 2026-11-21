import {resolve} from 'node:path'
import {startExecutor} from '../capability/app/service.mjs'
import {storageBackend} from '../runtime/http.mjs'
import {attachGracefulShutdown, requireEnv} from './lifecycle.mjs'

const token = requireEnv('INTERNAL_TOKEN')
const port = Number(process.env.PORT || 4310)
const dir = process.env.APP_DATA_DIR || resolve('/data/executor')

const instance = await startExecutor({
  dir,
  token,
  port,
  skill: process.env.SKILL_URL || 'http://repo-skill:4311',
  plugin: process.env.PLUGIN_URL || 'http://repo-plugin:4312',
  mcp: process.env.MCP_URL || 'http://repo-mcp:4313',
  agent: process.env.AGENT_URL || 'http://repo-agent:4314',
  management: process.env.MANAGEMENT_URL || 'http://management:4300',
})
console.log(
  `[executor] listening on ${process.env.HOST || '127.0.0.1'}:${port} ` +
  `(storage=${storageBackend()}, difyConnector=${process.env.DIFY_CONNECTOR_URL || 'direct'}, ragflowConnector=${process.env.RAGFLOW_CONNECTOR_URL || 'direct'})`,
)
attachGracefulShutdown('executor', instance)
