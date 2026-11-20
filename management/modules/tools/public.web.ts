export * from './web/ToolApproval'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {ToolApproval} from './web/ToolApproval'

export const moduleWeb = defineWebModule({
  id: 'tools',
  ticketForms: {
    'TOL-01': () => createElement(ToolApproval),
  },
})
