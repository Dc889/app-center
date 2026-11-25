export * from './web/AccountApplication'
export * from './web/AccountDesk'
export * from './web/AccountMonitor'
export * from './web/TenantModelMonitor'
export * from './web/ProfilePage'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {AccountApplication} from './web/AccountApplication'
import {AccountMonitor} from './web/AccountMonitor'
import {TenantModelMonitor} from './web/TenantModelMonitor'
import {ProfilePage} from './web/ProfilePage'

export const moduleWeb = defineWebModule({
  id: 'accounts',
  views: {
    accounts: ({role, onWorkOrder}) => createElement(AccountMonitor, {key: role, role, onWorkOrder}),
    tenantModelMonitor: ({role}) => createElement(TenantModelMonitor, {key: role, role}),
    profile: ({role, onNavigate}) => createElement(ProfilePage, {key: role, role, onNavigate}),
  },
  ticketForms: {
    'ACC-01': () => createElement(AccountApplication, {key: 'ACC-01', type: 'ACC-01'}),
    'ACC-02': () => createElement(AccountApplication, {key: 'ACC-02', type: 'ACC-02'}),
  },
})
