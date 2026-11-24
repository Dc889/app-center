import {json} from '../../../../runtime/http.mjs'
import {getDifyConfig, difyConsoleFetch} from '../../../platform/dify/public.mjs'
import {listDifyApps} from '../adapters/agent-store.mjs'

function toIso(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value < 1e12 ? value * 1000 : value).toISOString()
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  return ''
}

function runItem(app, run) {
  const time = toIso(run.created_at)
  if (!time) return null
  const tokens = typeof run.total_tokens === 'number' && run.total_tokens >= 0 ? run.total_tokens : null
  return {
    appId: app.resourceId,
    appName: app.name,
    time,
    sourceIp: typeof run.source_ip === 'string' ? run.source_ip : '',
    model: typeof run.model_name === 'string' ? run.model_name : '',
    tokens,
    result: run.status === 'failed' || run.status === 'stopped' ? '失败' : '成功',
    ownerAccount: app.ownerAccount || '',
    version: typeof run.version === 'string' ? run.version : '',
  }
}

async function readRuns(app) {
  const paths = [
    `/console/api/apps/${encodeURIComponent(app.resourceId)}/workflow-runs?limit=20`,
    `/console/api/apps/${encodeURIComponent(app.resourceId)}/advanced-chat/workflow-runs?limit=20`,
  ]
  for (const path of paths) {
    try {
      const response = await difyConsoleFetch(path)
      if (!response.ok) continue
      const body = await response.json()
      const rows = Array.isArray(body?.data) ? body.data : []
      return rows.map(run => runItem(app, run)).filter(Boolean)
    } catch { /* 这个应用没有对应运行列表时继续尝试另一种接口 */ }
  }
  return []
}

export async function listAgentInvocations(ctx) {
  const {res} = ctx
  if (!getDifyConfig().isReal) return json(res, {availability: 'not_collected', items: [], profiles: []})
  let apps = []
  try {
    apps = await listDifyApps({})
  } catch {
    return json(res, {availability: 'not_collected', items: [], profiles: []})
  }
  const items = []
  const profiles = []
  for (const app of apps.slice(0, 30)) {
    const runs = await readRuns(app)
    items.push(...runs)
    const versions = []
    for (const run of runs) {
      if (!run.version || versions.some(row => row.version === run.version)) continue
      versions.push({version: run.version, publishedAt: run.time})
    }
    profiles.push({appId: app.resourceId, description: app.description ?? null, versions})
    if (items.length >= 200) break
  }
  return json(res, {availability: 'collected', items: items.slice(0, 200), profiles})
}
