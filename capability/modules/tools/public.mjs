import {execute as set_tool_approval} from './handlers/set_tool_approval.mjs'
import {tol01Candidates, tol01Context} from './queries/execution-contexts.mjs'

export const capabilityModule = Object.freeze({
  id: 'tools',
  actions: [{ticketType: 'TOL-01', ticketTypeVersion: '1', action: 'set_tool_approval', variants: [null], execute: set_tool_approval}],
  resources: {},
  catalogs: {},
  routes: [
    {method: 'GET', path: '/internal/v1/execution-contexts/TOL-01/candidates', handle: tol01Candidates},
    {method: 'GET', path: '/internal/v1/execution-contexts/TOL-01', handle: tol01Context},
  ],
})
