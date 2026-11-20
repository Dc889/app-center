export * from './web/AuditLog'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {AuditLog} from './web/AuditLog'

export const moduleWeb = defineWebModule({
  id: 'audit',
  views: {
    audit: ({role}) => createElement(AuditLog, {key: role, role}),
  },
})
