import {registry} from './modules.mjs'
import {startExecutionServer} from '../platform/execution/public.mjs'
import {hydrateDifyConnector} from '../platform/dify/public.mjs'
import {hydrateRagflowConnector} from '../platform/ragflow/public.mjs'

export async function startExecutor(options) {
  await Promise.all([
    hydrateDifyConnector(options?.token),
    hydrateRagflowConnector(options?.token),
  ])
  return startExecutionServer(options, registry)
}
