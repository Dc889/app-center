export * from './web/AccountApplication'
export * from './web/AccountDesk'
export * from './web/AccountMonitor'
export * from './web/TenantModelMonitor'
export * from './web/ProfilePage'
export * from './web/SelfServiceAccountForms'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {AccountApplication} from './web/AccountApplication'
import {AccountMonitor} from './web/AccountMonitor'
import {TenantModelMonitor} from './web/TenantModelMonitor'
import {ProfilePage} from './web/ProfilePage'
import {HandoverTicketForm, ModelQuotaTicketForm, OrgRoleTicketForm} from './web/SelfServiceAccountForms'

export const moduleWeb = defineWebModule({
  id: 'accounts',
  views: {
    accounts: ({role, onWorkOrder}) => createElement(AccountMonitor, {key: role, role, onWorkOrder}),
    tenantModelMonitor: ({role, onNavigate}) => createElement(TenantModelMonitor, {key: role, role, onNavigate}),
    profile: ({role, onNavigate}) => createElement(ProfilePage, {key: role, role, onNavigate}),
  },
  ticketForms: {
    'ACC-01': () => createElement(AccountApplication, {key: 'ACC-01', type: 'ACC-01'}),
    'ACC-02': () => createElement(AccountApplication, {key: 'ACC-02', type: 'ACC-02'}),
    'ACC-03': () => createElement(HandoverTicketForm, {key: 'ACC-03'}),
    'ACC-04': () => createElement(OrgRoleTicketForm, {key: 'ACC-04'}),
    'MOD-01': () => createElement(ModelQuotaTicketForm, {key: 'MOD-01'}),
  },
})
