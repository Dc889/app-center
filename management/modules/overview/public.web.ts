export * from './web/Overview'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {Overview} from './web/Overview'

export const moduleWeb = defineWebModule({
  id: 'overview',
  views: {
    overview: ({role, onNavigate}) => createElement(Overview, {key: role, role, onNavigate}),
  },
})
