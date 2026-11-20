export * from './web/PluginMonitor'
export * from './web/PluginOperation'
export * from './web/PluginOperationPicker'
export * from './web/PluginPublication'
export * from './web/PluginRestoreForm'
export * from './web/PluginWarehouse'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {PluginMonitor} from './web/PluginMonitor'
import {PluginOperation} from './web/PluginOperation'
import {PluginPublication} from './web/PluginPublication'
import {PluginWarehouse} from './web/PluginWarehouse'

export const moduleWeb = defineWebModule({
  id: 'plugins',
  views: {
    plugins: ({role, onWorkOrder}) => createElement(PluginMonitor, {key: role, role, onWorkOrder}),
    pluginWarehouse: ({role}) => createElement(PluginWarehouse, {key: role, role}),
  },
  ticketForms: {
    'PLG-01': () => createElement(PluginPublication),
    'PLG-03': () => createElement(PluginOperation),
  },
})
