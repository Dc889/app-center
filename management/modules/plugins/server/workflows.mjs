import {submitPLG03} from './submitPLG03.mjs'
import {submitPLG01} from './submitPLG01.mjs'
import {approvePLG01} from './approvePLG01.mjs'
import {approvePLG03} from './approvePLG03.mjs'

export const pluginsWorkflows=Object.freeze({
  submissions:Object.freeze({'PLG-03':submitPLG03,'PLG-01':submitPLG01}),
  approvals:Object.freeze({'PLG-01':approvePLG01,'PLG-03':approvePLG03})
})
