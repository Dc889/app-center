export * from './web/ServiceMonitor'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {ServiceMonitor} from './web/ServiceMonitor'

export const moduleWeb = defineWebModule({
  id: 'services',
  views: {
    serviceMonitor: () => createElement(ServiceMonitor),
  },
})
