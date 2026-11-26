export * from './web/AgentAccessForm'
export * from './web/AgentDeskControls'
export * from './web/AgentImpactPanel'
export * from './web/AgentMonitor'
export * from './web/AgentReplacementPicker'
export * from './web/AgentWarehouse'
export * from './web/AgentWithdrawForm'
export * from './web/ApplicationTargetPicker'
export * from './web/PublicationApplicationPicker'
export * from './web/PublishResource'
export * from './web/AgentAnalysisConfigForm'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {AgentAccessForm} from './web/AgentAccessForm'
import {AgentAnalysisConfigForm} from './web/AgentAnalysisConfigForm'
import {AgentMonitor} from './web/AgentMonitor'
import {AgentWarehouse} from './web/AgentWarehouse'
import {AgentWithdrawForm} from './web/AgentWithdrawForm'
import {PublishResource} from './web/PublishResource'

export const moduleWeb = defineWebModule({
  id: 'agents',
  views: {
    agents: ({role, onWorkOrder}) => createElement(AgentWarehouse, {key: role, role, onWorkOrder}),
    agentMonitor: ({role, onWorkOrder, onNavigate}) => createElement(AgentMonitor, {key: role, role, onWorkOrder, onNavigate}),
  },
  ticketForms: {
    'AG-01': ({onMeta}) => createElement(PublishResource, {key: 'AG-01', ticketType: 'AG-01', onMeta}),
    'AG-02': ({onMeta}) => createElement(PublishResource, {key: 'AG-02', ticketType: 'AG-02', onMeta}),
    'AG-03': () => createElement(AgentAccessForm, {key: 'AG-03'}),
    'AG-04': () => createElement(AgentWithdrawForm, {key: 'AG-04', ticketType: 'AG-04'}),
    'AG-05': () => createElement(AgentWithdrawForm, {key: 'AG-05', ticketType: 'AG-05'}),
    'CFG-04': () => createElement(AgentAnalysisConfigForm, {key: 'CFG-04'}),
  },
})
