import {modelResource} from './queries/resources-model.mjs'
import {workspaces} from './queries/workspaces.mjs'

export const capabilityModule = Object.freeze({
  id: 'integrations',
  actions: [],
  resources: {model: modelResource},
  catalogs: {},
  routes: [{method: 'GET', path: '/internal/v1/workspaces', handle: workspaces}],
})
