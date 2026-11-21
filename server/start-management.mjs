import {resolve} from 'node:path'
import {startManagement} from '../management/app/server/service.mjs'
import {storageBackend} from '../runtime/http.mjs'
import {attachGracefulShutdown, requireEnv} from './lifecycle.mjs'

const token = requireEnv('INTERNAL_TOKEN')
const port = Number(process.env.PORT || 4300)
const dir = process.env.APP_DATA_DIR || resolve('/data/management')
const executor = process.env.CAPABILITY_URL || 'http://executor:4310'

const instance = await startManagement({dir, token, executor, port})
console.log(`[management] listening on ${process.env.HOST || '127.0.0.1'}:${port} (storage=${storageBackend()}, executor=${executor})`)
attachGracefulShutdown('management', instance)
