import {startDifyConnector, readDifyUpstreamConfig} from '../connectors/dify/public.mjs'
import {attachGracefulShutdown, requireEnv} from './lifecycle.mjs'

const token = requireEnv('INTERNAL_TOKEN')
const port = Number(process.env.PORT || 4321)

const instance = await startDifyConnector({token, port})
const cfg = readDifyUpstreamConfig()
console.log(
  `[connector-dify] listening on ${process.env.HOST || '127.0.0.1'}:${port} ` +
  `(adapterVersion=${cfg.adapterVersion}, configured=${cfg.configured}, pluginDaemon=${cfg.pluginDaemonConfigured})`,
)
attachGracefulShutdown('connector-dify', instance)
