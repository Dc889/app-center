export * from './web/PluginMonitor'
export * from './web/PluginOperation'
export * from './web/PluginOperationPicker'
export * from './web/PluginPublication'
export * from './web/PluginRestoreForm'
export * from './web/PluginWarehouse'
export * from './web/PluginBatchTicketForm'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {PluginMonitor} from './web/PluginMonitor'
import {PluginOperation} from './web/PluginOperation'
import {PluginPublication} from './web/PluginPublication'
import {PluginWarehouse} from './web/PluginWarehouse'
import {PluginBatchTicketForm} from './web/PluginBatchTicketForm'

export const moduleWeb = defineWebModule({
  id: 'plugins',
  views: {
    plugins: ({role, onNavigate, onWorkOrder}) => createElement(PluginMonitor, {key: role, role, onNavigate, onWorkOrder}),
    pluginWarehouse: ({role}) => createElement(PluginWarehouse, {key: role, role}),
  },
  ticketForms: {
    'PLG-01': () => createElement(PluginPublication),
    'PLG-03': () => createElement(PluginOperation),
    'PLG-05': () => createElement(PluginBatchTicketForm, {key: 'PLG-05'}),
  },
})
