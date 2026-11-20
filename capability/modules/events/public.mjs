import {getEventEvidenceSnapshot} from './queries/evidence.mjs'

export const capabilityModule = Object.freeze({
  id: 'events',
  actions: [],
  resources: {},
  catalogs: {},
  routes: [{method: 'GET', path: '/internal/v1/event-evidence/:executionId', handle: getEventEvidenceSnapshot}],
})
