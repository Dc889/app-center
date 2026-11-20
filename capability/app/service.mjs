import {registry} from './modules.mjs'
import {startExecutionServer} from '../platform/execution/public.mjs'
export const startExecutor=options=>startExecutionServer(options,registry)
