import {createHash} from 'node:crypto'
import {storageBackend} from '../../../../runtime/http.mjs'
import {getDifyConfig, getDifyPluginDaemonConfig} from '../../../platform/dify/public.mjs'
import {getRagflowConfig} from '../../../platform/ragflow/public.mjs'

export const SERVICE_KEYS = ['management', 'ragflow', 'dify', 'plugin_daemon', 'object_store', 'database']

function unavailableService(key) {
  return {
    key,
    instance: null,
    version: null,
    status: 'unavailable',
    checkedAt: null,
    latencyMs: null,
    consecutiveFailures: null,
    evidenceRef: null,
  }
}

function safeEvidenceRef(key, checkedAt, status) {
  const digest = createHash('sha256').update(`${key}:${checkedAt}:${status}`).digest('hex').slice(0, 12)
  return `probe-${key}-${digest}`
}

async function probeHttpService({key, urls, token, instance, defaultVersion, historyLedger, now}) {
  const started = Date.now()
  const checkedAt = new Date(now()).toISOString()
  const prev = historyLedger.get(key) ?? {consecutiveFailures: 0}
  try {
    let res = null
    let data = null
    for (const url of urls) {
      res = await fetch(url, {
        method: 'GET',
        headers: token ? {authorization: `Bearer ${token}`} : {},
        signal: AbortSignal.timeout(3000),
      })
      data = null
      try {
        data = await res.json()
      } catch {
        data = null
      }
      const ragNotFound = typeof data?.code === 'number' && data.code !== 0
      if (res.ok && !ragNotFound) break
      if (res.status !== 404 && !ragNotFound) break
    }
    const latencyMs = Math.max(0, Date.now() - started)
    let version = defaultVersion
    if (typeof data?.version === 'string' && data.version.trim()) version = data.version.slice(0, 64)
    else if (typeof data?.data?.version === 'string' && data.data.version.trim()) version = data.data.version.slice(0, 64)
    const ragFailed = typeof data?.code === 'number' && data.code !== 0
    const ok = Boolean(res?.ok) && !ragFailed
    const status = ok ? (latencyMs > 2000 ? 'degraded' : 'healthy') : 'failed'
    const consecutiveFailures = ok ? 0 : (prev.consecutiveFailures ?? 0) + 1
    historyLedger.put(key, {consecutiveFailures, lastCheckedAt: checkedAt, lastStatus: status})
    return {
      key,
      instance,
      version,
      status,
      checkedAt,
      latencyMs,
      consecutiveFailures,
      evidenceRef: safeEvidenceRef(key, checkedAt, status),
    }
  } catch {
    const latencyMs = Math.max(0, Date.now() - started)
    const consecutiveFailures = (prev.consecutiveFailures ?? 0) + 1
    historyLedger.put(key, {consecutiveFailures, lastCheckedAt: checkedAt, lastStatus: 'failed'})
    return {
      key,
      instance,
      version: defaultVersion,
      status: 'failed',
      checkedAt,
      latencyMs,
      consecutiveFailures,
      evidenceRef: safeEvidenceRef(key, checkedAt, 'failed'),
    }
  }
}

export async function collectServiceHealth({openLedger, now = Date.now}) {
  const historyLedger = openLedger('health_history')
  const dify = getDifyConfig()
  const difyDaemon = getDifyPluginDaemonConfig()
  const ragflow = getRagflowConfig()
  const results = []
  let probedCount = 0

  for (const key of SERVICE_KEYS) {
    if (key === 'dify' && dify.isReal) {
      probedCount += 1
      results.push(
        await probeHttpService({
          key,
          urls: dify.mode === 'connector'
            ? [`${dify.connectorUrl}/connector/v1/health`]
            : [`${dify.base}/console/api/setup`, `${dify.base}/health`],
          token: dify.token,
          instance: dify.mode === 'connector' ? 'connector-dify' : 'dify-api',
          defaultVersion: process.env.DIFY_VERSION ?? `dify-${dify.adapterVersion ?? '1.7.1'}`,
          historyLedger,
          now,
        }),
      )
    } else if (key === 'ragflow' && ragflow.isReal) {
      probedCount += 1
      results.push(
        await probeHttpService({
          key,
          urls: ragflow.mode === 'connector'
            ? [`${ragflow.connectorUrl}/connector/v1/health`]
            : [`${ragflow.base}/v1/system/healthz`, `${ragflow.base}/api/v1/system/health`],
          token: ragflow.token,
          instance: ragflow.mode === 'connector' ? 'connector-ragflow' : 'ragflow-api',
          defaultVersion: process.env.RAGFLOW_VERSION ?? `ragflow-${ragflow.adapterVersion ?? '0.22.1'}`,
          historyLedger,
          now,
        }),
      )
    } else if (key === 'plugin_daemon' && (difyDaemon.mode === 'connector' || process.env.DIFY_PLUGIN_DAEMON_URL)) {
      probedCount += 1
      results.push(
        await probeHttpService({
          key,
          urls: difyDaemon.mode === 'connector'
            ? [`${difyDaemon.connectorUrl}/connector/v1/plugin-daemon/health`]
            : [`${process.env.DIFY_PLUGIN_DAEMON_URL}/health/check`],
          token: difyDaemon.mode === 'connector' ? difyDaemon.token : (process.env.DIFY_PLUGIN_DAEMON_KEY ?? ''),
          instance: 'plugin-daemon',
          defaultVersion: process.env.DIFY_PLUGIN_DAEMON_VERSION ?? 'daemon',
          historyLedger,
          now,
        }),
      )
    } else if (key === 'object_store' && process.env.OBJECT_STORE_HEALTH_URL) {
      probedCount += 1
      results.push(
        await probeHttpService({
          key,
          urls: [process.env.OBJECT_STORE_HEALTH_URL],
          token: '',
          instance: 'object-store',
          defaultVersion: 's3-compatible',
          historyLedger,
          now,
        }),
      )
    } else if (key === 'management' && process.env.MANAGEMENT_HEALTH_URL) {
      probedCount += 1
      results.push(
        await probeHttpService({
          key,
          urls: [process.env.MANAGEMENT_HEALTH_URL],
          token: '',
          instance: 'management-service',
          defaultVersion: 'app-center-1.0',
          historyLedger,
          now,
        }),
      )
    } else if (key === 'database') {
      const started = Date.now()
      const checkedAt = new Date(now()).toISOString()
      const backend = storageBackend()
      const dbInstance = backend === 'mysql' ? 'capability-mysql' : 'capability-sqlite'
      const dbVersion = backend === 'mysql' ? 'mysql-8.0' : 'node-sqlite'
      try {
        historyLedger.all()
        const latencyMs = Math.max(0, Date.now() - started)
        historyLedger.put('database', {consecutiveFailures: 0, lastCheckedAt: checkedAt, lastStatus: 'healthy'})
        probedCount += 1
        results.push({
          key: 'database',
          instance: dbInstance,
          version: dbVersion,
          status: 'healthy',
          checkedAt,
          latencyMs,
          consecutiveFailures: 0,
          evidenceRef: safeEvidenceRef('database', checkedAt, 'healthy'),
        })
      } catch {
        const prev = historyLedger.get('database') ?? {consecutiveFailures: 0}
        probedCount += 1
        results.push({
          key: 'database',
          instance: dbInstance,
          version: dbVersion,
          status: 'failed',
          checkedAt,
          latencyMs: Math.max(0, Date.now() - started),
          consecutiveFailures: (prev.consecutiveFailures ?? 0) + 1,
          evidenceRef: safeEvidenceRef('database', checkedAt, 'failed'),
        })
      }
    } else {
      results.push(unavailableService(key))
    }
  }

  if (probedCount === 0) {
    return {state: 'unavailable', source: null, capturedAt: null, data: null, reasonCode: 'SOURCE_NOT_COLLECTED'}
  }
  return {
    state: 'collected',
    source: 'capability_health_prober',
    capturedAt: new Date(now()).toISOString(),
    data: results,
  }
}
