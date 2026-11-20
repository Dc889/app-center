import {check, json} from '../../../../runtime/http.mjs'
import {collectResourceInventory} from '../adapters/inventory-collector.mjs'
import {collectServiceHealth} from '../adapters/health-prober.mjs'
import {requireOperatorOrAdmin} from './observations.mjs'

const RANGE_MS = {'1h': 3600000, '24h': 86400000, '7d': 604800000}
const CALL_KEYS = ['agent', 'retrieval', 'mcp']
const EXCEPTION_KEYS = ['agent', 'dataset_build', 'plugin', 'mcp']

function isUtc(value) {
  return typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value))
}

function buildTimeSeriesGroup({group, kind, keys, fromMs, toMs, bucketMs, openLedger, nowMs}) {
  const collector = openLedger('collectors').get(group)
  if (!collector || !keys.every(k => collector.streams?.includes(k)) || !isUtc(collector.capturedAt)) {
    return {state: 'unavailable', source: null, capturedAt: null, data: null, reasonCode: 'SOURCE_NOT_COLLECTED'}
  }
  const capturedMs = Date.parse(collector.capturedAt)
  if (capturedMs > nowMs + 5000) {
    return {state: 'unavailable', source: null, capturedAt: null, data: null, reasonCode: 'INVALID_COLLECTOR_TIMESTAMP'}
  }

  const bucketCount = (toMs - fromMs) / bucketMs
  const buckets = Array.from({length: bucketCount}, (_, idx) => ({
    at: new Date(fromMs + idx * bucketMs).toISOString(),
    ...Object.fromEntries(keys.map(k => [k, 0])),
  }))

  const events = openLedger('events').all()
  const seenExecutions = new Set()
  for (const ev of events) {
    if (ev.kind !== kind || !keys.includes(ev.category)) continue
    if (ev.executionId) {
      const execKey = `${kind}:${ev.category}:${ev.executionId}`
      if (seenExecutions.has(execKey)) continue
      seenExecutions.add(execKey)
    }
    const ms = Date.parse(ev.at)
    if (!Number.isFinite(ms) || ms < fromMs || ms >= toMs) continue
    const idx = Math.floor((ms - fromMs) / bucketMs)
    if (idx >= 0 && idx < bucketCount) {
      buckets[idx][ev.category] += 1
    }
  }

  const isStale = nowMs - capturedMs > 300000
  return {
    state: isStale ? 'stale' : 'collected',
    source: collector.source,
    capturedAt: collector.capturedAt,
    data: buckets,
  }
}

export async function getOverviewSummary(ctx) {
  const {query, identity, res, clients, openLedger} = ctx
  requireOperatorOrAdmin(identity)

  const view = query.get('view') ?? 'monitor'
  check(view === 'monitor', 400, 'INVALID_VIEW')
  const scope = query.get('scope') ?? 'user_network'
  check(scope === 'user_network', 400, 'INVALID_SCOPE')
  const range = query.get('range') ?? '24h'
  check(Object.hasOwn(RANGE_MS, range), 400, 'INVALID_RANGE')

  const expectedBucketMs = range === '7d' ? 3600000 : 300000
  const bucketMs = Number(query.get('bucketMs') ?? expectedBucketMs)
  check(bucketMs === expectedBucketMs, 400, 'INVALID_BUCKET_MS')

  const from = query.get('from')
  const to = query.get('to')
  check(isUtc(from) && isUtc(to), 400, 'INVALID_WINDOW')
  const fromMs = Date.parse(from)
  const toMs = Date.parse(to)
  check(toMs - fromMs === RANGE_MS[range] && (toMs - fromMs) % bucketMs === 0, 400, 'INVALID_WINDOW')

  const nowMs = Date.now()
  const [resources, health] = await Promise.all([
    collectResourceInventory({clients, openLedger, now: () => nowMs}),
    collectServiceHealth({openLedger, now: () => nowMs}),
  ])

  const calls = buildTimeSeriesGroup({
    group: 'calls',
    kind: 'call',
    keys: CALL_KEYS,
    fromMs,
    toMs,
    bucketMs,
    openLedger,
    nowMs,
  })
  const exceptions = buildTimeSeriesGroup({
    group: 'exceptions',
    kind: 'exception',
    keys: EXCEPTION_KEYS,
    fromMs,
    toMs,
    bucketMs,
    openLedger,
    nowMs,
  })

  return json(res, {
    scope,
    range,
    from,
    to,
    bucketMs,
    resources,
    health,
    calls,
    exceptions,
  })
}
