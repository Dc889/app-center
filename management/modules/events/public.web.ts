export * from './web/EventDesk'
export * from './web/EventMonitor'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {EventMonitor} from './web/EventMonitor'

export const moduleWeb = defineWebModule({
  id: 'events',
  views: {
    security: ({role, onNavigate}) => createElement(EventMonitor, {key: role, role, onHandle: () => onNavigate('todo')}),
  },
})
