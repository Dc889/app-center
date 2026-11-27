export * from './web/EventDesk'
export * from './web/EventMonitor'
export * from './web/GovernancePolicyPage'
export * from './web/GovernancePolicyConfigForm'
export * from './web/ExternalCutoffTicketForm'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {EventMonitor} from './web/EventMonitor'
import {GovernancePolicyConfigForm} from './web/GovernancePolicyConfigForm'
import {ExternalCutoffTicketForm} from './web/ExternalCutoffTicketForm'

export const moduleWeb = defineWebModule({
  id: 'events',
  views: {
    security: ({role, onNavigate}) => createElement(EventMonitor, {key: role, role, onHandle: () => onNavigate('todo'), onNavigate}),
  },
  ticketForms: {
    'CFG-05': () => createElement(GovernancePolicyConfigForm, {key: 'CFG-05'}),
    'SEC-01': () => createElement(ExternalCutoffTicketForm, {key: 'SEC-01'}),
  },
})
