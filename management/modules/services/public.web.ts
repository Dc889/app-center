export * from './web/ServiceMonitor'
export * from './web/ServiceRestartTicketForm'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {ServiceMonitor} from './web/ServiceMonitor'
import {ServiceRestartTicketForm} from './web/ServiceRestartTicketForm'

export const moduleWeb = defineWebModule({
  id: 'services',
  views: {
    serviceMonitor: ({role, onNavigate}) => createElement(ServiceMonitor, {key: role, role, onNavigate}),
  },
  ticketForms: {
    'SVC-01': () => createElement(ServiceRestartTicketForm, {key: 'SVC-01'}),
  },
})
