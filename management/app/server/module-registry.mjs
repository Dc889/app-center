import {moduleServer as accountsModule} from '../../modules/accounts/public.server.mjs'
import {moduleServer as agentsModule} from '../../modules/agents/public.server.mjs'
import {moduleServer as auditModule} from '../../modules/audit/public.server.mjs'
import {moduleServer as eventsModule} from '../../modules/events/public.server.mjs'
import {moduleServer as keysModule} from '../../modules/keys/public.server.mjs'
import {moduleServer as knowledgeModule} from '../../modules/knowledge/public.server.mjs'
import {moduleServer as mcpModule} from '../../modules/mcp/public.server.mjs'
import {moduleServer as overviewModule} from '../../modules/overview/public.server.mjs'
import {moduleServer as pluginsModule} from '../../modules/plugins/public.server.mjs'
import {moduleServer as skillsModule} from '../../modules/skills/public.server.mjs'
import {moduleServer as toolsModule} from '../../modules/tools/public.server.mjs'

export const serverModules=Object.freeze([
  accountsModule,
  agentsModule,
  auditModule,
  eventsModule,
  keysModule,
  knowledgeModule,
  mcpModule,
  overviewModule,
  pluginsModule,
  skillsModule,
  toolsModule,
])

function assertUniqueIds(modules) {
  const seen=new Set()
  for(const mod of modules) {
    if(!mod?.id || seen.has(mod.id))throw Error('Duplicate or missing server module id: '+mod?.id)
    seen.add(mod.id)
  }
}

function collectMap(modules,select,label) {
  const result={}
  for(const mod of modules) {
    const entries=select(mod)
    if(!entries)continue
    for(const [key,handler] of Object.entries(entries)) {
      if(result[key])throw Error(`Duplicate ${label} ${key}`)
      result[key]=handler
    }
  }
  return Object.freeze(result)
}

assertUniqueIds(serverModules)

const moduleRoutes=Object.freeze(serverModules.flatMap(mod=>mod.routes ?? []))

export const submissionHandlers=collectMap(serverModules,mod=>mod.workflows?.submissions,'workflow')
export const approvalHandlers=collectMap(serverModules,mod=>mod.workflows?.approvals,'workflow')
export const executionContextHandlers=collectMap(serverModules,mod=>mod.executionContexts,'execution context')
export const executionCandidateHandlers=collectMap(serverModules,mod=>mod.executionCandidates,'execution candidate')

export async function dispatchModuleRoute(path,services) {
  for(const route of moduleRoutes) {
    if(route.match(path)) {
      await route.handle(services)
      return true
    }
  }
  return false
}
