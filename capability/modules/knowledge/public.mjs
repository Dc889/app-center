import {resources as dify_dataset} from './queries/resources-dify_dataset.mjs'
import {resources as ragflow_dataset} from './queries/resources-ragflow_dataset.mjs'
import {knowledgeCatalog as knowledge} from './queries/catalog-knowledge.mjs'
import {
  kb02Context,
  kb03Candidates,
  kb03Context,
  kb04Context,
  kb05Candidates,
  kb05Context,
} from './queries/execution-contexts.mjs'
import {execute as sync_dataset} from './handlers/sync_dataset.mjs'
import {execute as publish_dataset} from './handlers/publish_dataset.mjs'
import {execute as bind_dataset, reconcile as reconcileBindDataset} from './handlers/bind_dataset.mjs'
import {execute as review_dataset_changes} from './handlers/review_dataset_changes.mjs'
import {execute as pause_share} from './handlers/pause_share.mjs'
import {execute as dispose_dataset} from './handlers/dispose_dataset.mjs'

export const capabilityModule = Object.freeze({
  id: 'knowledge',
  actions: [
    {ticketType: 'KB-01', ticketTypeVersion: '1', action: 'sync_dataset', variants: [null], execute: sync_dataset},
    {ticketType: 'KB-02', ticketTypeVersion: '1', action: 'publish_dataset', variants: [null], execute: publish_dataset},
    {
      ticketType: 'KB-03',
      ticketTypeVersion: '1',
      action: 'bind_dataset',
      variants: ['RAGFlow外部知识库', 'Dify同workspace授权', 'Dify跨workspace复制'],
      execute: bind_dataset,
      reconcile: reconcileBindDataset,
    },
    {ticketType: 'KB-04', ticketTypeVersion: '1', action: 'review_dataset_changes', variants: [null], execute: review_dataset_changes},
    {ticketType: 'KB-05', ticketTypeVersion: '1', action: 'pause_share', variants: [null], execute: pause_share},
    {ticketType: 'KB-05', ticketTypeVersion: '1', action: 'dispose_dataset', variants: [null], execute: dispose_dataset},
  ],
  resources: {dify_dataset, ragflow_dataset},
  catalogs: {knowledge},
  routes: [
    {method: 'GET', path: '/internal/v1/execution-contexts/KB-02', handle: kb02Context},
    {method: 'GET', path: '/internal/v1/execution-contexts/KB-03/candidates', handle: kb03Candidates},
    {method: 'GET', path: '/internal/v1/execution-contexts/KB-03', handle: kb03Context},
    {method: 'GET', path: '/internal/v1/execution-contexts/KB-04', handle: kb04Context},
    {method: 'GET', path: '/internal/v1/execution-contexts/KB-05/candidates', handle: kb05Candidates},
    {method: 'GET', path: '/internal/v1/execution-contexts/KB-05', handle: kb05Context},
  ],
})
