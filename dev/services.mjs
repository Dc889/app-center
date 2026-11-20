import {resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'

const services = {
  skill: async options => (await import('../capability/repositories/skill/public.mjs')).startSkill(options),
  plugin: async options => (await import('../capability/repositories/plugin/public.mjs')).startPlugin(options),
  mcp: async options => (await import('../capability/repositories/mcp/public.mjs')).startMcp(options),
  agent: async options => (await import('../capability/repositories/agent/public.mjs')).startAgent(options),
  executor: async options => (await import('../capability/app/service.mjs')).startExecutor(options),
  management: async options => (await import('../management/app/server/service.mjs')).startManagement(options),
}

export async function localStack(
  dir = process.env.APP_DATA_DIR ?? resolve('.local-data'),
  token = randomUUID(),
  includeManagement = true,
  extra = {},
) {
  const started = []
  let managementRef = extra.management ?? null
  const resolveManagement = () => (typeof managementRef === 'function' ? managementRef() : managementRef)
  const options = {dir, token, ...extra, management: resolveManagement}
  try {
    for (const [name, start] of Object.entries(services)) {
      if (name === 'management' && !includeManagement) continue
      const instance = await start(options)
      if (name === 'management') {
        managementRef = instance.url
      }
      options[name] = instance.url
      started.push(instance)
    }
    return {
      ...options,
      management: resolveManagement(),
      close: async () => {
        for (const s of started.reverse()) await s.close()
      },
    }
  } catch (err) {
    for (const s of started.reverse()) await s.close()
    throw err
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const name = process.argv[2]
  if (!Object.hasOwn(services, name) || !process.env.INTERNAL_TOKEN) throw Error('指定服务名并设置 INTERNAL_TOKEN')
  const port = {skill: 4311, plugin: 4312, mcp: 4313, agent: 4314, executor: 4310, management: 4300}
  const instance = await services[name]({
    dir: process.env.APP_DATA_DIR ?? resolve('.local-data'),
    token: process.env.INTERNAL_TOKEN,
    port: Number(process.env.PORT ?? port[name]),
    skill: process.env.SKILL_URL ?? 'http://127.0.0.1:4311',
    plugin: process.env.PLUGIN_URL ?? 'http://127.0.0.1:4312',
    mcp: process.env.MCP_URL ?? 'http://127.0.0.1:4313',
    agent: process.env.AGENT_URL ?? 'http://127.0.0.1:4314',
    management: process.env.MANAGEMENT_URL ?? 'http://127.0.0.1:4300',
    executor: process.env.CAPABILITY_URL ?? 'http://127.0.0.1:4310',
  })
  console.log(name, instance.url)
}
