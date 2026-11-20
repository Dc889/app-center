export * from './server/approveKEY01.mjs'
export * from './server/approveKEY02.mjs'
export * from './server/key-creation.mjs'
export * from './server/key-lifecycle.mjs'
export * from './server/key-registrations.mjs'
export * from './server/routeKeyRegistrations.mjs'
export * from './server/submitKEY01.mjs'
export * from './server/submitKEY02.mjs'
export * from './server/workflows.mjs'

import {keyActions,keyContext} from './server/key-lifecycle.mjs'
import {routeKeyRegistrations} from './server/routeKeyRegistrations.mjs'
import {keysWorkflows} from './server/workflows.mjs'

export const moduleServer=Object.freeze({
  id:'keys',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/key-registrations',handle:routeKeyRegistrations}),
  ]),
  workflows:keysWorkflows,
  executionContexts:Object.freeze({
    'KEY-02':({cap,headers,resourceId,action})=>{
      const operation=Object.keys(keyActions).find(key=>keyActions[key]===action)
      return keyContext(cap,headers,resourceId,operation)
    },
  }),
})
