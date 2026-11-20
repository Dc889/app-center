import {approveAG05} from './approveAG05.mjs'
import {approveAG04} from './approveAG04.mjs'
import {approveAG03} from './approveAG03.mjs'
import {approveAG02} from './approveAG02.mjs'
import {submitAG01} from './submitAG01.mjs'
import {submitAG02} from './submitAG02.mjs'
import {submitAG03} from './submitAG03.mjs'
import {submitAG04} from './submitAG04.mjs'
import {submitAG05} from './submitAG05.mjs'

export const agentsWorkflows = Object.freeze({
  submissions: Object.freeze({
    'AG-01': submitAG01,
    'AG-02': submitAG02,
    'AG-03': submitAG03,
    'AG-04': submitAG04,
    'AG-05': submitAG05,
  }),
  approvals: Object.freeze({
    'AG-05': approveAG05,
    'AG-04': approveAG04,
    'AG-03': approveAG03,
    'AG-02': approveAG02,
  }),
})
