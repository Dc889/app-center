import {getDifyConfig, difyConsoleFetch} from '../../../platform/dify/public.mjs'
import {getRagflowConfig} from '../../../platform/ragflow/public.mjs'

export const RESOURCE_KEYS = ['agents', 'datasets', 'tools', 'plugins', 'skills', 'mcp', 'keys']

function dayKeyUtc8(ms) {
  const shifted = new Date(ms + 8 * 3600 * 1000)
  return shifted.toISOString().slice(0, 10)
}

async function fetchRepoItems(client, path) {
  if (typeof client !== 'function') return null
  try {
    const res = await client(path)
    const data = await res.json()
    return Array.isArray(data?.items) ? data.items : null
  } catch {
    return null
  }
}

async function fetchJsonSafe(url, token) {
  try {
    const res = await fetch(url, {
      headers: {authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function collectResourceInventory({clients, openLedger, now = Date.now}) {
  const currentMs = now()
  const today = dayKeyUtc8(currentMs)
  const yesterday = dayKeyUtc8(currentMs - 86400000)
  const snapshotLedger = openLedger('inventory_snapshots')
  const yesterdaySnap = snapshotLedger.get(yesterday)?.counts ?? {}
  const dify = getDifyConfig()
  const ragflow = getRagflowConfig()

  const counts = {}

  // skills / plugins / mcp / agents via repository HTTP clients
  const [skills, plugins, mcps, agents] = await Promise.all([
    fetchRepoItems(clients?.skill, '/skills'),
    fetchRepoItems(clients?.plugin, '/plugins'),
    fetchRepoItems(clients?.mcp, '/mcps'),
    fetchRepoItems(clients?.agent, '/agents'),
  ])

  if (agents !== null) counts.agents = agents.filter(item => item.status !== '已下架').length
  if (plugins !== null) counts.plugins = plugins.filter(item => item.status !== '已下架' && item.status !== '已禁用').length
  if (skills !== null) counts.skills = skills.filter(item => item.status !== '已下架').length
  if (mcps !== null) counts.mcp = mcps.filter(item => item.status !== '已下架' && item.status !== '已隔离').length

  // Dify tools / datasets / keys & RAGFlow datasets if configured
  if (dify.isReal) {
    const fetchDifySafe = async path => {
      try {
        const res = await difyConsoleFetch(path, {timeoutMs: 8000})
        return res.ok ? await res.json() : null
      } catch {
        return null
      }
    }
    const [difyDs, difyTools, difyKeys] = await Promise.all([
      fetchDifySafe('/console/api/datasets?limit=100'),
      fetchDifySafe('/console/api/workspaces/current/tools/api'),
      fetchDifySafe('/console/api/apps/api-keys/summary'),
    ])
    let datasetCount = Array.isArray(difyDs?.data) ? difyDs.data.length : null
    if (ragflow.isReal) {
      const ragDs = await fetchJsonSafe(`${ragflow.base}/api/v1/datasets?page_size=100`, ragflow.token)
      if (Array.isArray(ragDs?.data)) {
        datasetCount = (datasetCount ?? 0) + ragDs.data.length
      }
    }
    if (datasetCount !== null) counts.datasets = datasetCount
    if (Array.isArray(difyTools)) {
      counts.tools = difyTools.reduce((sum, provider) => sum + (Array.isArray(provider.tools) ? provider.tools.length : 1), 0)
    }
    if (Number.isSafeInteger(difyKeys?.activeCount)) {
      counts.keys = difyKeys.activeCount
    }
  } else if (ragflow.isReal) {
    const ragDs = await fetchJsonSafe(`${ragflow.base}/api/v1/datasets?page_size=100`, ragflow.token)
    if (Array.isArray(ragDs?.data)) counts.datasets = ragDs.data.length
  }

  const collectedAny = Object.keys(counts).length > 0
  if (!collectedAny) {
    return {state: 'unavailable', source: null, capturedAt: null, data: null, reasonCode: 'SOURCE_NOT_COLLECTED'}
  }

  snapshotLedger.put(today, {day: today, counts, capturedAt: new Date(currentMs).toISOString()})

  const data = RESOURCE_KEYS.map(key => {
    if (!Object.hasOwn(counts, key)) {
      return {key, state: 'unavailable', count: null, yesterdayCount: null}
    }
    const prev = yesterdaySnap[key]
    return {
      key,
      state: 'collected',
      count: counts[key],
      yesterdayCount: Number.isSafeInteger(prev) && prev >= 0 ? prev : null,
    }
  })

  return {
    state: 'collected',
    source: 'capability_inventory_collector',
    capturedAt: new Date(currentMs).toISOString(),
    data,
  }
}
