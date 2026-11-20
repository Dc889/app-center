import {check} from '../../../runtime/http.mjs'
import {execute as sync_app} from './handlers/sync_app.mjs'
import {execute as publish} from './handlers/publish.mjs'
import {execute as grant_app_access} from './handlers/grant_app_access.mjs'
import {execute as republish} from './handlers/republish.mjs'
import {execute as withdraw_app} from './handlers/withdraw_app.mjs'
import {catalogItem, catalogVersions, listCatalog} from './queries/catalog.mjs'
import {difyAppResource} from './queries/resources-dify_app.mjs'
import {applicationTargetDetail, listApplicationTargets} from './queries/application-targets.mjs'
import {agentReplacementDetail, listAgentReplacements} from './queries/agent-replacements.mjs'

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
    {ticketType: 'AG-01', ticketTypeVersion: '1', action: 'sync_app', variants: [null], execute: sync_app},
    {
      ticketType: 'AG-02',
      ticketTypeVersion: '1',
      action: 'publish',
      variants: [null],
      execute: publish,
      validatePayload: validatePublishPayload,
    },
    {ticketType: 'AG-03', ticketTypeVersion: '1', action: 'grant_app_access', variants: [null], execute: grant_app_access},
    {ticketType: 'AG-04', ticketTypeVersion: '1', action: 'republish', variants: [null], execute: republish},
    {ticketType: 'AG-05', ticketTypeVersion: '1', action: 'withdraw_app', variants: [null], execute: withdraw_app},
  ],
  resources: {dify_app: difyAppResource},
  catalogs: {agent: {list: listCatalog, detail: catalogItem, versions: catalogVersions}},
  routes: [
    {method: 'GET', path: '/internal/v1/application-targets', handle: listApplicationTargets},
    {method: 'GET', path: '/internal/v1/application-targets/:appId', handle: applicationTargetDetail},
    {method: 'GET', path: '/internal/v1/agent-replacements', handle: listAgentReplacements},
    {method: 'GET', path: '/internal/v1/agent-replacements/:resourceId', handle: agentReplacementDetail},
  ],
})

// Legacy adapter exports; execution still goes through the registered handler.
export {syncDifyApp} from './adapters/syncDifyApp.mjs'
export {publishDifyApp} from './adapters/publishDifyApp.mjs'
export {withdrawDifyApp} from './adapters/withdrawDifyApp.mjs'
