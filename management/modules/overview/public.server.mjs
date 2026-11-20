export * from './server/overview.mjs'
export * from './server/routeOverview.mjs'

import {routeOverview} from './server/routeOverview.mjs'

export const moduleServer=Object.freeze({
  id:'overview',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/overview',handle:routeOverview}),
  ]),
})
