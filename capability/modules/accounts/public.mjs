import {execute as apply_account_change} from './handlers/apply_account_change.mjs'
import {execute as rename_account} from './handlers/rename_account.mjs'
import {acc01Context, acc02Context, accountCatalog} from './queries/execution-contexts.mjs'
import {getAccountConsistency} from './queries/account-consistency.mjs'
import {listRagflowAccounts} from './queries/ragflow-accounts.mjs'
import {reconcileAccountCommit} from './adapters/account-transaction.mjs'

export const capabilityModule = Object.freeze({
  id: 'accounts',
  actions: [
    {ticketType: 'ACC-01', ticketTypeVersion: '1', action: 'apply_account_change', variants: [null], execute: apply_account_change, reconcile: reconcileAccountCommit},
    {ticketType: 'ACC-02', ticketTypeVersion: '1', action: 'rename_account', variants: [null], execute: rename_account, reconcile: reconcileAccountCommit},
  ],
  resources: {ragflow_account: {list: listRagflowAccounts}},
  catalogs: {account: accountCatalog},
  routes: [
    {method: 'GET', path: '/internal/v1/execution-contexts/ACC-01', handle: acc01Context},
    {method: 'GET', path: '/internal/v1/execution-contexts/ACC-02', handle: acc02Context},
    {method: 'GET', path: '/internal/v1/executions/:executionId/account-consistency', handle: getAccountConsistency},
  ],
})
