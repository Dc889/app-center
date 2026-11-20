import {check} from '../../../runtime/http.mjs'
import {execute as sync_app} from './handlers/sync_app.mjs'
import {execute as publish} from './handlers/publish.mjs'
import {execute as withdraw_app} from './handlers/withdraw_app.mjs'
import {listCatalog, catalogItem} from './queries/legacy-catalog.mjs'
import {resources as dify_app} from './queries/resources-dify_app.mjs'

function validatePublishPayload(payload) {
  check(
    ['snapshotId', 'workspaceId', 'publicationVersionId', 'scope'].every(
      k => typeof payload[k] === 'string' && payload[k],
    ) &&
      Number.isInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 0 &&
      ['targetOrgs', 'targetAccounts', 'boundaryOrgs', 'usages'].every(k => Array.isArray(payload[k])),
    400,
    'INVALID_REQUEST',
  )
}

export const capabilityModule = Object.freeze({
  id: 'agents',
  actions: [
    {ticketType: 'AG-01', ticketTypeVersion: '1', action: 'sync_app', variants: [null], ready: false, execute: sync_app},
    {
      ticketType: 'AG-02',
      ticketTypeVersion: '1',
      action: 'publish',
      variants: [null],
      ready: false,
      execute: publish,
      validatePayload: validatePublishPayload,
    },
    {ticketType: 'AG-03', ticketTypeVersion: '1', action: 'grant_app_access', variants: [null]},
    {ticketType: 'AG-04', ticketTypeVersion: '1', action: 'republish', variants: [null]},
    {ticketType: 'AG-05', ticketTypeVersion: '1', action: 'withdraw_app', variants: [null], ready: false, execute: withdraw_app},
  ],
  resources: {dify_app},
  catalogs: {agent: {list: listCatalog, detail: catalogItem}},
  routes: [],
})

// Legacy adapter exports; execution still goes through the registered handler.
export {syncDifyApp} from './adapters/syncDifyApp.mjs'
export {publishDifyApp} from './adapters/publishDifyApp.mjs'
export {withdrawDifyApp} from './adapters/withdrawDifyApp.mjs'
