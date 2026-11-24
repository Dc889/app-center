import type {ReactNode} from 'react'
import type {View} from '../../shared-ui/UiContextData'
import type {ModuleViewProps,TicketFormProps,WebModuleManifest} from '../../shared-ui/module-contracts'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {moduleWeb as accountsModule} from '../../modules/accounts/public.web'
import {moduleWeb as agentsModule} from '../../modules/agents/public.web'
import {moduleWeb as auditModule} from '../../modules/audit/public.web'
import {moduleWeb as eventsModule} from '../../modules/events/public.web'
import {moduleWeb as keysModule} from '../../modules/keys/public.web'
import {moduleWeb as knowledgeModule} from '../../modules/knowledge/public.web'
import {moduleWeb as mcpModule} from '../../modules/mcp/public.web'
import {moduleWeb as overviewModule} from '../../modules/overview/public.web'
import {moduleWeb as servicesModule} from '../../modules/services/public.web'
import {moduleWeb as pluginsModule} from '../../modules/plugins/public.web'
import {moduleWeb as skillsModule} from '../../modules/skills/public.web'
import {moduleWeb as toolsModule} from '../../modules/tools/public.web'
import {AccessApplication} from './AccessApplication'
import {PackageRevision} from './PackageRevision'
import {WithdrawApplication} from './WithdrawApplication'

// Cross-module legacy forms still pending split into dev-b owning modules.
const sharedFormsModule: WebModuleManifest = defineWebModule({
  id: 'app-shared-forms',
  ticketForms: {
    'MCP-02': () => <AccessApplication key="MCP-02" ticketType="MCP-02" />,
    'SKL-04': () => <WithdrawApplication key="SKL-04" ticketType="SKL-04" />,
    'SKL-02': () => <PackageRevision key="SKL-02" kind="skill" />,
    'PLG-02': () => <PackageRevision key="PLG-02" kind="plugin" />,
  },
})

export const webModules: readonly WebModuleManifest[] = Object.freeze([
  accountsModule,
  agentsModule,
  auditModule,
  eventsModule,
  keysModule,
  knowledgeModule,
  mcpModule,
  overviewModule,
  servicesModule,
  pluginsModule,
  skillsModule,
  toolsModule,
  sharedFormsModule,
])

const viewRegistry: Partial<Record<View, (props: ModuleViewProps) => ReactNode>> = {}
const ticketFormRegistry: Record<string, (props: TicketFormProps) => ReactNode> = {}
const seenIds = new Set<string>()

for (const mod of webModules) {
  if (!mod.id || seenIds.has(mod.id)) throw Error('Duplicate or missing web module id: ' + mod.id)
  seenIds.add(mod.id)
  if (mod.views) {
    for (const [viewId, render] of Object.entries(mod.views) as [View, (props: ModuleViewProps) => ReactNode][]) {
      if (viewRegistry[viewId]) throw Error('Duplicate web view ' + viewId)
      viewRegistry[viewId] = render
    }
  }
  if (mod.ticketForms) {
    for (const [code, render] of Object.entries(mod.ticketForms)) {
      if (ticketFormRegistry[code]) throw Error('Duplicate web ticket form ' + code)
      ticketFormRegistry[code] = render
    }
  }
}

export function renderModuleView(view: View, props: ModuleViewProps): ReactNode | null {
  const render = viewRegistry[view]
  return render ? render(props) : null
}

export function hasRegisteredTicketForm(code: string): boolean {
  return Object.hasOwn(ticketFormRegistry, code)
}

export function renderTicketForm(code: string, props: TicketFormProps): ReactNode | null {
  const render = ticketFormRegistry[code]
  return render ? render(props) : null
}
