import {resolve} from 'node:path'
import {storageBackend} from '../runtime/http.mjs'
import {attachGracefulShutdown, requireEnv} from './lifecycle.mjs'

const starters = {
  skill: async opts => (await import('../capability/repositories/skill/public.mjs')).startSkill(opts),
  plugin: async opts => (await import('../capability/repositories/plugin/public.mjs')).startPlugin(opts),
  mcp: async opts => (await import('../capability/repositories/mcp/public.mjs')).startMcp(opts),
  agent: async opts => (await import('../capability/repositories/agent/public.mjs')).startAgent(opts),
}
const defaultPorts = {skill: 4311, plugin: 4312, mcp: 4313, agent: 4314}

const repo = (process.env.REPO_SERVICE || process.argv[2] || '').trim()
if (!Object.hasOwn(starters, repo)) {
  console.error(`[fatal] REPO_SERVICE 必须是 ${Object.keys(starters).join(' | ')} 之一`)
  process.exit(1)
}

const token = requireEnv('INTERNAL_TOKEN')
const port = Number(process.env.PORT || defaultPorts[repo])
const dir = process.env.APP_DATA_DIR || resolve(`/data/${repo}`)

const instance = await starters[repo]({dir, token, port})
console.log(`[repo-${repo}] listening on ${process.env.HOST || '127.0.0.1'}:${port} (storage=${storageBackend()})`)
attachGracefulShutdown(`repo-${repo}`, instance)
