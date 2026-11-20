import {getOverviewSummary} from './queries/overview-summary.mjs'
import {listObservations, ingestObservation} from './queries/observations.mjs'

export const capabilityModule = Object.freeze({
  id: 'observability',
  actions: [],
  resources: {},
  catalogs: {},
  routes: [
    {method: 'GET', path: '/internal/v1/overview-summary', handle: getOverviewSummary},
    {method: 'GET', path: '/internal/v1/observations', handle: listObservations},
    {method: 'POST', path: '/internal/v1/observations', handle: ingestObservation},
  ],
})
