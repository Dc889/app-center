export * from './web/DatasetDisposition'
export * from './web/DatasetPublicationContext'
export * from './web/KnowledgeAccessForm'
export * from './web/KnowledgeBindingPicker'
export * from './web/KnowledgeDeskReview'
export * from './web/KnowledgeMonitor'
export * from './web/KnowledgeSync'

import {createElement} from 'react'
import {defineWebModule} from '../../shared-ui/module-contracts'
import {DatasetDisposition} from './web/DatasetDisposition'
import {DatasetPublicationContext} from './web/DatasetPublicationContext'
import {KnowledgeAccessForm} from './web/KnowledgeAccessForm'
import {KnowledgeMonitor} from './web/KnowledgeMonitor'
import {KnowledgeSync} from './web/KnowledgeSync'

export const moduleWeb = defineWebModule({
  id: 'knowledge',
  views: {
    knowledge: ({role, onWorkOrder}) => createElement(KnowledgeMonitor, {key: role, role, onWorkOrder}),
  },
  ticketForms: {
    'KB-01': () => createElement(KnowledgeSync),
    'KB-02': () => createElement(DatasetPublicationContext),
    'KB-03': () => createElement(KnowledgeAccessForm, {key: 'KB-03'}),
    'KB-05': () => createElement(DatasetDisposition),
  },
})
