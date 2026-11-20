import {submitKB01} from './submitKB01.mjs'
import {submitKB05} from './submitKB05.mjs'
import {submitKB03} from './submitKB03.mjs'
import {submitKB02} from './submitKB02.mjs'
import {approveKB05} from './approveKB05.mjs'
import {approveKB02} from './approveKB02.mjs'
import {approveKB03} from './approveKB03.mjs'

export const knowledgeWorkflows = Object.freeze({
  submissions: Object.freeze({
    'KB-01': submitKB01,
    'KB-05': submitKB05,
    'KB-03': submitKB03,
    'KB-02': submitKB02,
  }),
  approvals: Object.freeze({
    'KB-05': approveKB05,
    'KB-02': approveKB02,
    'KB-03': approveKB03,
  }),
})
