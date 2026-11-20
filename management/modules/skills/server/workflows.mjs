import {submitSKL01} from './submitSKL01.mjs'
import {submitSKL04} from './submitSKL04.mjs'
import {approveSKL04} from './approveSKL04.mjs'
import {approveSKL01} from './approveSKL01.mjs'

export const skillsWorkflows=Object.freeze({
  submissions:Object.freeze({'SKL-01':submitSKL01,'SKL-04':submitSKL04}),
  approvals:Object.freeze({'SKL-04':approveSKL04,'SKL-01':approveSKL01})
})
