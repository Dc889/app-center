export * from './server/approveKB02.mjs'
export * from './server/approveKB03.mjs'
export * from './server/approveKB05.mjs'
export * from './server/dataset-binding.mjs'
export * from './server/dataset-changes.mjs'
export * from './server/dataset-disposition.mjs'
export * from './server/dataset-review.mjs'
export * from './server/knowledge-monitor.mjs'
export * from './server/routeKnowledgeMonitor.mjs'
export * from './server/routeKnowledgeWarehouse.mjs'
export * from './server/routeKnowledgeInsights.mjs'
export * from './server/knowledge-warehouse.mjs'
export * from './server/submitKB02.mjs'
export * from './server/submitKB03.mjs'
export * from './server/submitKB05.mjs'
export * from './server/workflows.mjs'

import {check} from '../../../runtime/http.mjs'
import {bindingCandidates,bindingContext} from './server/dataset-binding.mjs'
import {datasetDispositionCandidates,datasetDispositionContext} from './server/dataset-disposition.mjs'
import {routeKnowledgeMonitor} from './server/routeKnowledgeMonitor.mjs'
import {routeKnowledgeWarehouse} from './server/routeKnowledgeWarehouse.mjs'
import {routeKnowledgeInsights} from './server/routeKnowledgeInsights.mjs'
import {knowledgeWorkflows} from './server/workflows.mjs'

export const moduleServer=Object.freeze({
  id:'knowledge',
  routes:Object.freeze([
    Object.freeze({match:path=>path==='/api/knowledge-monitor',handle:routeKnowledgeMonitor}),
    Object.freeze({match:path=>path==='/api/knowledge-warehouse',handle:routeKnowledgeWarehouse}),
    Object.freeze({match:path=>path==='/api/knowledge-insights' || path==='/api/knowledge-insights/check-drift',handle:routeKnowledgeInsights}),
  ]),
  workflows:knowledgeWorkflows,
  executionContexts:Object.freeze({
    'KB-03':({cap,headers,resourceId,query})=>bindingContext(cap,headers,resourceId,query.get('workspaceId') ?? '',query.get('permission') ?? '检索使用',query.get('targetAppId') ?? ''),
    'KB-05':async ({cap,headers,resourceId,ticketType,action})=>{
      check(action==='dispose_dataset',400,'INVALID_DISPOSITION_PREVIEW')
      const snapshot=await datasetDispositionContext(cap,headers,resourceId,{documentIds:[]})
      const {['处置目标清单']:targets,...fields}=snapshot.fields
      return {...snapshot,ticketType,action,eligible:true,fields,availableActions:[...new Set(targets.map(target=>target.action))],disposableDocumentIds:[...new Set(targets.filter(target=>target.action==='停用文档').map(target=>target.documentId))]}
    },
  }),
  executionCandidates:Object.freeze({
    'KB-03':(cap,headers,input)=>bindingCandidates(cap,headers,input),
    'KB-05':(cap,headers,input)=>datasetDispositionCandidates(cap,headers,input),
  }),
})
