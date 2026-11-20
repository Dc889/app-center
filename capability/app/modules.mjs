import {capabilityModule as agents} from '../modules/agents/public.mjs'
import {capabilityModule as keys} from '../modules/keys/public.mjs'
import {capabilityModule as plugins} from '../modules/plugins/public.mjs'
import {capabilityModule as skills} from '../modules/skills/public.mjs'
import {capabilityModule as knowledge} from '../modules/knowledge/public.mjs'
import {capabilityModule as mcp} from '../modules/mcp/public.mjs'
import {capabilityModule as accounts} from '../modules/accounts/public.mjs'
import {capabilityModule as tools} from '../modules/tools/public.mjs'
import {capabilityModule as events} from '../modules/events/public.mjs'
import {capabilityModule as integrations} from '../modules/integrations/public.mjs'
import {capabilityModule as observability} from '../modules/observability/public.mjs'
import {createRegistry} from '../platform/registry/public.mjs'
export const capabilityModules=Object.freeze([agents,keys,plugins,skills,knowledge,mcp,accounts,tools,events,integrations,observability])
export const registry=createRegistry(capabilityModules)
