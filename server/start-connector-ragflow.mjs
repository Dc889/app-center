import {startRagflowConnector, readRagflowUpstreamConfig} from '../connectors/ragflow/public.mjs'
import {attachGracefulShutdown, requireEnv} from './lifecycle.mjs'

const token = requireEnv('INTERNAL_TOKEN')
const port = Number(process.env.PORT || 4322)

const instance = await startRagflowConnector({token, port})
const cfg = readRagflowUpstreamConfig()
console.log(
  `[connector-ragflow] listening on ${process.env.HOST || '127.0.0.1'}:${port} ` +
  `(adapterVersion=${cfg.adapterVersion}, configured=${cfg.configured})`,
)
attachGracefulShutdown('connector-ragflow', instance)
