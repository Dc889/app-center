import {submitKEY01} from './submitKEY01.mjs'
import {submitKEY02} from './submitKEY02.mjs'
import {approveKEY02} from './approveKEY02.mjs'
import {approveKEY01} from './approveKEY01.mjs'

export const keysWorkflows=Object.freeze({
  submissions:Object.freeze({'KEY-01':submitKEY01,'KEY-02':submitKEY02}),
  approvals:Object.freeze({'KEY-02':approveKEY02,'KEY-01':approveKEY01})
})
