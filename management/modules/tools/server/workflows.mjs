import {submitTOL01} from './submitTOL01.mjs'
import {approveTOL01} from './approveTOL01.mjs'

export const toolsWorkflows=Object.freeze({
  submissions:Object.freeze({'TOL-01':submitTOL01}),
  approvals:Object.freeze({'TOL-01':approveTOL01})
})
