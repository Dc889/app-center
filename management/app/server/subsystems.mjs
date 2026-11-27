import {constants as cryptoConstants, createCipheriv, createDecipheriv, createHash, publicEncrypt, randomBytes} from 'node:crypto'
import pg from 'pg'
import YAML from 'yaml'
import {body, check, id, json, ledger} from '../../../runtime/http.mjs'

const ALLOWED_TYPES = ['dify', 'ragflow', 'model_gateway', 'custom']
const SECRET_FIELDS = ['consoleToken', 'consolePassword', 'pluginDaemonKey', 'dbPassword', 'apiKey', 'authToken']

function cipherKey() {
  const seed = process.env.SUBSYSTEM_SECRET_KEY || process.env.INTERNAL_TOKEN || 'app-center-subsystem-default-key'
  return createHash('sha256').update(seed).digest()
}

function encryptSecret(plain) {
  if (!plain) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cipherKey(), iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

function decryptSecret(stored) {
  if (!stored || typeof stored !== 'string') return ''
  if (!stored.startsWith('enc:')) return stored
  const parts = stored.split(':')
  if (parts.length !== 4) return ''
  try {
    const [, ivHex, tagHex, dataHex] = parts
    const decipher = createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

function maskSecret(plain) {
  if (!plain) return ''
  if (plain.length <= 8) return '****'
  return `${plain.slice(0, 4)}****${plain.slice(-4)}`
}

function normalizeUrl(raw) {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    check(false, 400, 'INVALID_URL', '接口地址格式不正确，需以 http:// 或 https:// 开头')
  }
  check(['http:', 'https:'].includes(parsed.protocol), 400, 'INVALID_URL', '仅支持 http:// 或 https:// 地址')
  return trimmed
}

function toPublicView(record) {
  const secrets = record.secrets ?? {}
  const secretMasks = {}
  const hasSecrets = {}
  for (const field of SECRET_FIELDS) {
    const plain = decryptSecret(secrets[field])
    hasSecrets[field] = Boolean(plain)
    secretMasks[field] = (field === 'consolePassword' || field === 'dbPassword') ? (plain ? '********' : '') : maskSecret(plain)
  }
  const {secrets: _hidden, ...rest} = record
  return {...rest, hasSecrets, secretMasks}
}

function applyDefaultToEnv(record) {
  if (!record?.enabled || !record?.isDefault) return
  const sec = key => decryptSecret(record.secrets?.[key])
  if (record.type === 'dify') {
    if (record.apiBase) process.env.DIFY_API_BASE = record.apiBase
    if (record.version) process.env.DIFY_ADAPTER_VERSION = record.version
    if (record.workspaceId) process.env.DIFY_WORKSPACE_ID = record.workspaceId
    if (record.consoleEmail) process.env.DIFY_CONSOLE_EMAIL = record.consoleEmail
    if (record.pluginDaemonBase) process.env.DIFY_PLUGIN_DAEMON_BASE = record.pluginDaemonBase
    const token = sec('consoleToken')
    const pwd = sec('consolePassword')
    const daemonKey = sec('pluginDaemonKey')
    if (token) process.env.DIFY_CONSOLE_TOKEN = token
    if (pwd) process.env.DIFY_CONSOLE_PASSWORD = pwd
    if (daemonKey) process.env.DIFY_PLUGIN_DAEMON_KEY = daemonKey
  } else if (record.type === 'ragflow') {
    if (record.apiBase) process.env.RAGFLOW_API_BASE = record.apiBase
    if (record.version) process.env.RAGFLOW_ADAPTER_VERSION = record.version
    if (record.tenantId) process.env.RAGFLOW_TENANT_ID = record.tenantId
    if (record.externalEndpoint) process.env.RAGFLOW_EXTERNAL_ENDPOINT = record.externalEndpoint
    const apiKey = sec('apiKey')
    if (apiKey) process.env.RAGFLOW_API_KEY = apiKey
  }
}

function formatNetworkError(err, targetLabel = '') {
  const cause = err?.cause ?? err
  const code = String(cause?.code || err?.code || '').toUpperCase()
  const rawMsg = String(cause?.message || err?.message || '')
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo/i.test(rawMsg)) {
    return `主机名/容器名无法解析${targetLabel ? `（${targetLabel}）` : ''}，请核对容器名或网络挂载`
  }
  if (code === 'ECONNREFUSED') {
    return `目标端口拒绝连接${targetLabel ? `（${targetLabel}）` : ''}，请确认服务已启动`
  }
  if (code === 'ETIMEDOUT' || err?.name === 'TimeoutError' || /timeout|aborted/i.test(rawMsg)) {
    return `连接超时${targetLabel ? `（${targetLabel}）` : ''}`
  }
  if (code === '28P01' || /password authentication failed/i.test(rawMsg)) {
    return '数据库账号或密码错误'
  }
  if (code === '3D000' || /does not exist/i.test(rawMsg)) {
    return '目标数据库不存在'
  }
  return rawMsg || '网络不可达或超时'
}

async function probeDifyDatabase(spec) {
  const host = String(spec.dbHost ?? '').trim()
  const port = Number(spec.dbPort || 5432)
  const database = String(spec.dbName || 'dify').trim()
  const user = String(spec.dbUser ?? '').trim()
  const password = String(spec.dbPassword ?? '').trim()
  if (!host || !user || !password) {
    return {checked: false, ok: false, latencyMs: 0, message: '未完整填写只读数据库主机/账号/密码'}
  }
  const started = Date.now()
  const client = new pg.Client({
    host,
    port: Number.isFinite(port) && port > 0 ? port : 5432,
    database,
    user,
    password,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  })
  try {
    await client.connect()
    const res = await client.query('SELECT COUNT(*)::int AS cnt FROM tenants')
    const cnt = Number(res.rows?.[0]?.cnt ?? 0)
    return {
      checked: true,
      ok: true,
      latencyMs: Date.now() - started,
      tenantsCount: cnt,
      message: `只读库连通正常（${host} · 共 ${cnt} 个租户）`,
    }
  } catch (err) {
    return {
      checked: true,
      ok: false,
      latencyMs: Date.now() - started,
      message: `只读库连接失败：${formatNetworkError(err, `${host}:${port}`)}`,
    }
  } finally {
    await client.end().catch(() => {})
  }
}

async function probeSubsystem(spec) {
  const started = Date.now()
  const base = normalizeUrl(spec.apiBase)
  if (!base) return {ok: false, status: 0, latencyMs: 0, message: '未填写 API 地址'}

  let httpHost = ''
  try { httpHost = new URL(base).host } catch {}

  let httpResult
  try {
    if (spec.type === 'dify') {
      let token = spec.consoleToken || ''
      if (!token && spec.consoleEmail && spec.consolePassword) {
        const loginRes = await fetch(`${base}/console/api/login`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({email: spec.consoleEmail, password: spec.consolePassword, remember_me: true}),
          signal: AbortSignal.timeout(8000),
        })
        const loginJson = await loginRes.json().catch(() => null)
        if (loginRes.ok && loginJson?.result === 'success' && loginJson?.data?.access_token) {
          token = loginJson.data.access_token
        } else {
          httpResult = {
            ok: false,
            status: loginRes.status,
            latencyMs: Date.now() - started,
            message: `Dify 登录鉴权失败 (HTTP ${loginRes.status})`,
          }
        }
      }
      if (!httpResult) {
        const probeUrl = token ? `${base}/console/api/workspaces/current` : `${base}/console/api/setup`
        const res = await fetch(probeUrl, {
          headers: token ? {authorization: `Bearer ${token}`} : {},
          signal: AbortSignal.timeout(8000),
        })
        const latencyMs = Date.now() - started
        if (res.ok) {
          const payload = await res.json().catch(() => null)
          const wsName = payload?.name ? `（工作区：${payload.name}）` : ''
          httpResult = {
            ok: true,
            status: res.status,
            latencyMs,
            message: token ? `Dify API 鉴权连通正常${wsName}` : 'Dify API 端点可达（未配置鉴权凭据）',
          }
        } else {
          httpResult = {ok: false, status: res.status, latencyMs, message: `Dify API 响应异常 (HTTP ${res.status})`}
        }
      }
    } else if (spec.type === 'ragflow') {
      const headers = spec.apiKey ? {authorization: `Bearer ${spec.apiKey}`} : {}
      const res = await fetch(`${base}/api/v1/datasets?page=1&page_size=1`, {
        headers,
        signal: AbortSignal.timeout(8000),
      })
      const latencyMs = Date.now() - started
      const payload = await res.json().catch(() => null)
      if (res.ok && payload && payload.code === 0) {
        return {ok: true, status: res.status, latencyMs, message: 'RAGFlow API 鉴权连通正常'}
      }
      const msg = payload?.message ? `：${payload.message}` : ''
      return {ok: false, status: res.status, latencyMs, message: `RAGFlow 探活失败 (HTTP ${res.status}${msg})`}
    } else {
      const headers = spec.authToken ? {authorization: `Bearer ${spec.authToken}`} : {}
      const res = await fetch(`${base}/healthz`, {headers, signal: AbortSignal.timeout(8000)}).catch(() =>
        fetch(base, {headers, signal: AbortSignal.timeout(8000)}),
      )
      const latencyMs = Date.now() - started
      return {
        ok: res.ok,
        status: res.status,
        latencyMs,
        message: res.ok ? `服务连通正常 (HTTP ${res.status})` : `服务返回 HTTP ${res.status}`,
      }
    }
  } catch (err) {
    httpResult = {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      message: `API 连接失败：${formatNetworkError(err, httpHost)}`,
    }
  }

  // For Dify, perform dual-channel verification (HTTP API + PostgreSQL read-only DB)
  if (spec.type === 'dify') {
    const dbResult = await probeDifyDatabase(spec)
    const totalLatency = Date.now() - started
    const combinedOk = httpResult.ok && (!dbResult.checked || dbResult.ok)
    const combinedMessage = dbResult.checked
      ? `${httpResult.message}；${dbResult.message}`
      : `${httpResult.message}（未检测只读库：${dbResult.message}）`
    return {
      ok: combinedOk,
      status: httpResult.status,
      latencyMs: totalLatency,
      message: combinedMessage,
      http: httpResult,
      db: dbResult,
    }
  }
  return httpResult
}

async function syncDifySubsystem(record, directory, inventoryStore) {
  const nowIso = new Date().toISOString()
  if (!directory) {
    return {at: nowIso, ok: false, totalOwners: 0, created: 0, updated: 0, appsCount: 0, datasetsCount: 0, mcpCount: 0, message: '身份目录未就绪'}
  }
  const host = String(record.dbHost ?? '').trim()
  const port = Number(record.dbPort || 5432)
  const database = String(record.dbName ?? 'dify').trim()
  const user = String(record.dbUser ?? '').trim()
  const password = decryptSecret(record.secrets?.dbPassword)
  if (!host || !database || !user || !password) {
    return {at: nowIso, ok: false, totalOwners: 0, created: 0, updated: 0, appsCount: 0, datasetsCount: 0, mcpCount: 0, message: '缺少 Dify 只读数据库连接信息'}
  }
  const client = new pg.Client({
    host,
    port: Number.isFinite(port) && port > 0 ? port : 5432,
    database,
    user,
    password,
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000,
  })
  try {
    await client.connect()
    // 1. Sync tenant owner accounts
    const ownersRes = await client.query(`
      SELECT DISTINCT ON (a.id)
        a.id::text AS dify_account_id,
        a.email,
        a.name AS dify_name,
        a.status AS dify_status,
        a.last_login_at,
        t.id::text AS workspace_id,
        t.name AS workspace_name
      FROM accounts a
      JOIN tenant_account_joins taj ON taj.account_id = a.id AND taj.role = 'owner'
      JOIN tenants t ON t.id = taj.tenant_id
      ORDER BY a.id, taj.current DESC, taj.created_at ASC
    `)
    let created = 0
    let updated = 0
    const tenantOwnerMap = new Map()
    for (const row of ownersRes.rows) {
      if (!row.email || !row.dify_account_id) continue
      const res = directory.upsertDifyOwner({
        difyAccountId: row.dify_account_id,
        email: row.email,
        name: row.dify_name,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        status: row.dify_status,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      })
      if (res.action === 'created') created++
      else updated++
      if (row.workspace_id && res.profile) {
        tenantOwnerMap.set(row.workspace_id, {
          account: res.profile.account,
          email: res.profile.email,
          name: res.profile.name,
          org: res.profile.org || '待归属',
          workspaceName: row.workspace_name || '',
        })
      }
    }

    // 2. Sync all Dify apps across all tenants
    const appsRes = await client.query(`
      SELECT
        ap.id::text AS app_id,
        ap.tenant_id::text AS workspace_id,
        ap.name,
        ap.mode,
        ap.description,
        ap.status,
        ap.created_at,
        ap.updated_at,
        t.name AS workspace_name
      FROM apps ap
      LEFT JOIN tenants t ON t.id = ap.tenant_id
      ORDER BY ap.created_at DESC
    `)
    const apps = appsRes.rows.map(r => {
      const owner = tenantOwnerMap.get(r.workspace_id)
      return {
        resourceId: r.app_id,
        name: r.name || r.app_id,
        workspaceId: r.workspace_id || '',
        workspaceName: r.workspace_name || owner?.workspaceName || '',
        mode: r.mode || 'chat',
        description: r.description || '',
        status: r.status || 'normal',
        ownerAccount: owner?.account || `workspace:${String(r.workspace_id || '').slice(0, 8)}`,
        ownerEmail: owner?.email || '',
        ownerName: owner?.name || r.workspace_name || 'Dify 工作区',
        org: owner?.org || '待归属',
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      }
    })

    // 3. Sync all Dify datasets (knowledge bases) with real usage, retrieval quality & content fingerprint
    const dsRes = await client.query(`
      SELECT
        d.id::text AS dataset_id,
        d.tenant_id::text AS workspace_id,
        d.name,
        d.description,
        d.indexing_technique,
        d.permission,
        d.created_at,
        t.name AS workspace_name,
        (SELECT count(*)::int FROM documents doc WHERE doc.dataset_id = d.id) AS doc_count,
        (SELECT count(*)::int FROM documents doc WHERE doc.dataset_id = d.id AND doc.indexing_status = 'completed') AS completed_doc_count,
        (SELECT MAX(doc.updated_at) FROM documents doc WHERE doc.dataset_id = d.id) AS last_doc_updated_at,
        (SELECT COALESCE(string_agg(doc.id::text || ':' || COALESCE(doc.word_count::text,'0') || ':' || COALESCE(EXTRACT(EPOCH FROM doc.updated_at)::bigint::text,'0'), '|' ORDER BY doc.id), '') FROM documents doc WHERE doc.dataset_id = d.id) AS doc_sig,
        (SELECT count(DISTINCT j.app_id)::int FROM app_dataset_joins j WHERE j.dataset_id = d.id) AS app_count,
        (SELECT count(*)::int FROM dataset_queries q WHERE q.dataset_id = d.id) AS total_queries,
        (SELECT count(*)::int FROM dataset_queries q WHERE q.dataset_id = d.id AND q.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days') AS queries_30d,
        (SELECT count(*)::int FROM document_segments s WHERE s.dataset_id = d.id) AS segment_count,
        (SELECT COALESCE(SUM(s.hit_count), 0)::int FROM document_segments s WHERE s.dataset_id = d.id) AS segment_hits,
        (SELECT ROUND(AVG(r.score)::numeric, 3) FROM dataset_retriever_resources r WHERE r.dataset_id = d.id AND r.score IS NOT NULL) AS avg_score
      FROM datasets d
      LEFT JOIN tenants t ON t.id = d.tenant_id
      ORDER BY d.created_at DESC
    `)
    const datasets = dsRes.rows.map(r => {
      const owner = tenantOwnerMap.get(r.workspace_id)
      const docCount = Number(r.doc_count || 0)
      const completedDocCount = Number(r.completed_doc_count || 0)
      const indexingHealthPct = docCount > 0 ? Math.round((completedDocCount / docCount) * 100) : 100
      const contentFingerprint = createHash('sha256').update(String(r.doc_sig || '')).digest('hex').slice(0, 16)
      return {
        resourceId: r.dataset_id,
        name: r.name || r.dataset_id,
        workspaceId: r.workspace_id || '',
        workspaceName: r.workspace_name || owner?.workspaceName || '',
        description: r.description || '',
        indexingTechnique: r.indexing_technique || '',
        permission: r.permission || 'only_me',
        documentCount: docCount,
        completedDocCount,
        indexingHealthPct,
        segmentCount: Number(r.segment_count || 0),
        appCount: Number(r.app_count || 0),
        totalQueries: Number(r.total_queries || 0),
        queryCount30d: Number(r.queries_30d || 0),
        hitCount: Number(r.segment_hits || 0),
        avgScore: r.avg_score !== null && r.avg_score !== undefined ? Number(r.avg_score) : null,
        lastDocUpdatedAt: r.last_doc_updated_at ? new Date(r.last_doc_updated_at).toISOString() : null,
        contentFingerprint,
        ownerAccount: owner?.account || `workspace:${String(r.workspace_id || '').slice(0, 8)}`,
        ownerName: owner?.name || r.workspace_name || 'Dify 工作区',
        org: owner?.org || '待归属',
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      }
    })

    // 4. Sync all Dify MCP providers across all tenants
    let mcpProviders = []
    try {
      const mcpRes = await client.query(`
        SELECT
          m.id::text AS provider_id,
          m.tenant_id::text AS workspace_id,
          m.name,
          m.server_identifier,
          m.server_url,
          m.authed,
          m.created_at,
          t.name AS workspace_name
        FROM tool_mcp_providers m
        LEFT JOIN tenants t ON t.id = m.tenant_id
        ORDER BY m.created_at DESC
      `)
      mcpProviders = mcpRes.rows.map(r => {
        const owner = tenantOwnerMap.get(r.workspace_id)
        return {
          providerId: r.provider_id,
          workspaceId: r.workspace_id || '',
          workspaceName: r.workspace_name || owner?.workspaceName || '',
          name: r.name || r.server_identifier || r.provider_id,
          serverIdentifier: r.server_identifier || '',
          serverUrl: r.server_url || '',
          authed: Boolean(r.authed),
          ownerAccount: owner?.account || `workspace:${String(r.workspace_id || '').slice(0, 8)}`,
          ownerName: owner?.name || r.workspace_name || 'Dify 工作区',
          org: owner?.org || '待归属',
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        }
      })
    } catch {
      mcpProviders = []
    }

    // 4b. Sync all Dify app API keys (masked) across all tenants for compliance reconciliation
    let apiKeys = []
    try {
      const keyRes = await client.query(`
        SELECT
          k.id::text AS key_id,
          k.app_id::text AS app_id,
          k.tenant_id::text AS workspace_id,
          k.type,
          LEFT(k.token, 10) || '...' || RIGHT(k.token, 4) AS token_preview,
          k.created_at,
          k.last_used_at,
          a.name AS app_name,
          t.name AS workspace_name
        FROM api_tokens k
        LEFT JOIN apps a ON a.id = k.app_id
        LEFT JOIN tenants t ON t.id = k.tenant_id
        WHERE k.type = 'app'
        ORDER BY k.created_at DESC
      `)
      apiKeys = keyRes.rows.map(r => {
        const owner = tenantOwnerMap.get(r.workspace_id)
        return {
          keyId: r.key_id,
          appId: r.app_id || '',
          appName: r.app_name || r.app_id || '未命名应用',
          workspaceId: r.workspace_id || '',
          workspaceName: r.workspace_name || owner?.workspaceName || '',
          tokenPreview: r.token_preview || '',
          ownerAccount: owner?.account || `workspace:${String(r.workspace_id || '').slice(0, 8)}`,
          ownerName: owner?.name || r.workspace_name || 'Dify 工作区',
          org: owner?.org || '待归属',
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
          lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
        }
      })
    } catch {
      apiKeys = []
    }

    // 4c. Sync per-workspace model configurations & real token/call usage (for P2 quota enforcement)
    let modelUsage = []
    try {
      const usageRes = await client.query(`
        WITH configured AS (
          SELECT tenant_id::text AS workspace_id, provider_name, model_name, model_type
          FROM provider_models
          WHERE is_valid = true
          UNION
          SELECT tenant_id::text AS workspace_id, provider_name, model_name, model_type
          FROM provider_model_settings
          UNION
          SELECT DISTINCT a.tenant_id::text AS workspace_id, m.model_provider AS provider_name, m.model_id AS model_name, 'text-generation' AS model_type
          FROM messages m
          JOIN apps a ON a.id = m.app_id
          WHERE COALESCE(m.model_provider, '') <> '' AND COALESCE(m.model_id, '') <> ''
        ),
        msg_stats AS (
          SELECT
            a.tenant_id::text AS workspace_id,
            m.model_provider AS provider_name,
            m.model_id AS model_name,
            COUNT(*)::int AS total_calls,
            COALESCE(SUM(COALESCE(m.message_tokens, 0) + COALESCE(m.answer_tokens, 0)), 0)::bigint AS total_tokens,
            COUNT(*) FILTER (WHERE m.created_at >= date_trunc('month', CURRENT_TIMESTAMP))::int AS monthly_calls,
            COALESCE(SUM(COALESCE(m.message_tokens, 0) + COALESCE(m.answer_tokens, 0)) FILTER (WHERE m.created_at >= date_trunc('month', CURRENT_TIMESTAMP)), 0)::bigint AS monthly_tokens
          FROM messages m
          JOIN apps a ON a.id = m.app_id
          WHERE COALESCE(m.model_provider, '') <> '' AND COALESCE(m.model_id, '') <> ''
          GROUP BY a.tenant_id, m.model_provider, m.model_id
        )
        SELECT
          c.workspace_id,
          c.provider_name,
          c.model_name,
          c.model_type,
          COALESCE(s.enabled, true) AS enabled,
          COALESCE(u.monthly_calls, 0)::int AS monthly_calls,
          COALESCE(u.monthly_tokens, 0)::bigint AS monthly_tokens,
          COALESCE(u.total_calls, 0)::int AS total_calls,
          COALESCE(u.total_tokens, 0)::bigint AS total_tokens,
          t.name AS workspace_name
        FROM configured c
        LEFT JOIN provider_model_settings s
          ON s.tenant_id::text = c.workspace_id
          AND s.provider_name = c.provider_name
          AND s.model_name = c.model_name
          AND s.model_type = c.model_type
        LEFT JOIN msg_stats u
          ON u.workspace_id = c.workspace_id
          AND u.provider_name = c.provider_name
          AND u.model_name = c.model_name
        LEFT JOIN tenants t ON t.id::text = c.workspace_id
        ORDER BY COALESCE(u.monthly_tokens, 0) DESC, c.workspace_id, c.model_name
      `)
      modelUsage = usageRes.rows.map(r => {
        const owner = tenantOwnerMap.get(r.workspace_id)
        return {
          workspaceId: r.workspace_id || '',
          workspaceName: r.workspace_name || owner?.workspaceName || '',
          ownerAccount: owner?.account || `workspace:${String(r.workspace_id || '').slice(0, 8)}`,
          ownerName: owner?.name || r.workspace_name || 'Dify 工作区',
          org: owner?.org || '待归属',
          providerName: r.provider_name || '',
          modelName: r.model_name || '',
          modelType: r.model_type || 'text-generation',
          enabled: r.enabled !== false,
          monthlyCalls: Number(r.monthly_calls || 0),
          monthlyTokens: Number(r.monthly_tokens || 0),
          totalCalls: Number(r.total_calls || 0),
          totalTokens: Number(r.total_tokens || 0),
        }
      })
    } catch {
      modelUsage = []
    }

    // 5. Sync installed plugins across all tenants from dify_plugin DB (best-effort)
    let plugins = []
    const pluginDbName = String(record.pluginDbName ?? 'dify_plugin').trim() || 'dify_plugin'
    const pluginClient = new pg.Client({
      host,
      port: Number.isFinite(port) && port > 0 ? port : 5432,
      database: pluginDbName,
      user,
      password,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    })
    try {
      await pluginClient.connect()
      const plgRes = await pluginClient.query(`
        SELECT
          id::text AS installation_id,
          tenant_id::text AS workspace_id,
          plugin_id,
          plugin_unique_identifier,
          source,
          created_at,
          updated_at
        FROM plugin_installations
        ORDER BY created_at DESC
      `)
      plugins = plgRes.rows.map(r => {
        const owner = tenantOwnerMap.get(r.workspace_id)
        const uid = String(r.plugin_unique_identifier || r.plugin_id || '')
        const verMatch = /:([0-9]+\.[0-9]+\.[0-9]+[^@]*)/.exec(uid)
        return {
          installationId: r.installation_id,
          workspaceId: r.workspace_id || '',
          workspaceName: owner?.workspaceName || '',
          pluginId: r.plugin_id || uid,
          pluginUniqueIdentifier: uid,
          pluginName: r.plugin_id || uid,
          version: verMatch ? verMatch[1] : '1.0.0',
          source: r.source || 'package',
          ownerAccount: owner?.account || `workspace:${String(r.workspace_id || '').slice(0, 8)}`,
          ownerName: owner?.name || owner?.workspaceName || 'Dify 工作区',
          org: owner?.org || '待归属',
          installedAt: r.created_at ? new Date(r.created_at).toISOString() : nowIso,
        }
      })
    } catch {
      plugins = []
    } finally {
      await pluginClient.end().catch(() => {})
    }

    if (inventoryStore) {
      inventoryStore.put(`dify:${record.id}`, {
        subsystemId: record.id,
        syncedAt: nowIso,
        apps,
        datasets,
        mcpProviders,
        plugins,
        apiKeys,
        modelUsage,
      })
    }

    const totalOwners = created + updated
    return {
      at: nowIso,
      ok: true,
      totalOwners,
      created,
      updated,
      appsCount: apps.length,
      datasetsCount: datasets.length,
      mcpCount: mcpProviders.length,
      pluginsCount: plugins.length,
      apiKeysCount: apiKeys.length,
      message: `同步成功：租户 ${totalOwners} 个、应用 ${apps.length} 个、知识库 ${datasets.length} 个、插件 ${plugins.length} 个、MCP ${mcpProviders.length} 个、密钥 ${apiKeys.length} 个`,
    }
  } catch (err) {
    return {
      at: nowIso,
      ok: false,
      totalOwners: 0,
      created: 0,
      updated: 0,
      appsCount: 0,
      datasetsCount: 0,
      mcpCount: 0,
      message: `同步失败：${err instanceof Error ? err.message : '无法连接 Dify 数据库'}`,
    }
  } finally {
    await client.end().catch(() => {})
  }
}

export function subsystemRegistry(dir, actorSnapshot, {directory} = {}) {
  const store = ledger(dir, 'managed-subsystems', actorSnapshot)
  const inventoryStore = ledger(dir, 'subsystem-inventory', actorSnapshot)

  function bootstrapFromEnv() {
    if (store.all().length > 0) {
      // Sync existing defaults to runtime env on startup
      for (const row of store.all()) applyDefaultToEnv(row)
      return
    }
    const nowIso = new Date().toISOString()
    if (process.env.DIFY_API_BASE) {
      store.put('dify-primary', {
        id: 'dify-primary',
        name: '默认 Dify 实例',
        type: 'dify',
        version: process.env.DIFY_ADAPTER_VERSION || '1.7.1',
        apiBase: process.env.DIFY_API_BASE.replace(/\/+$/, ''),
        workspaceId: process.env.DIFY_WORKSPACE_ID || '',
        consoleEmail: process.env.DIFY_CONSOLE_EMAIL || '',
        pluginDaemonBase: process.env.DIFY_PLUGIN_DAEMON_BASE || '',
        dbHost: process.env.DIFY_DB_HOST || '',
        dbPort: Number(process.env.DIFY_DB_PORT || 5432),
        dbName: process.env.DIFY_DB_NAME || 'dify',
        dbUser: process.env.DIFY_DB_USER || '',
        tenantId: '',
        externalEndpoint: '',
        enabled: true,
        isDefault: true,
        notes: '由启动环境变量自动导入',
        secrets: {
          consoleToken: encryptSecret(process.env.DIFY_CONSOLE_TOKEN || ''),
          consolePassword: encryptSecret(process.env.DIFY_CONSOLE_PASSWORD || ''),
          pluginDaemonKey: encryptSecret(process.env.DIFY_PLUGIN_DAEMON_KEY || ''),
          dbPassword: encryptSecret(process.env.DIFY_DB_PASSWORD || ''),
        },
        lastTest: null,
        lastSync: null,
        revision: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        history: [{at: nowIso, actor: 'system', action: '由环境变量初始化纳管子系统'}],
      })
    }
    if (process.env.RAGFLOW_API_BASE) {
      store.put('ragflow-primary', {
        id: 'ragflow-primary',
        name: '默认 RAGFlow 实例',
        type: 'ragflow',
        version: process.env.RAGFLOW_ADAPTER_VERSION || '0.22.1',
        apiBase: process.env.RAGFLOW_API_BASE.replace(/\/+$/, ''),
        workspaceId: '',
        consoleEmail: '',
        pluginDaemonBase: '',
        tenantId: process.env.RAGFLOW_TENANT_ID || '',
        externalEndpoint: process.env.RAGFLOW_EXTERNAL_ENDPOINT || '',
        enabled: true,
        isDefault: true,
        notes: '由启动环境变量自动导入',
        secrets: {
          apiKey: encryptSecret(process.env.RAGFLOW_API_KEY || ''),
        },
        lastTest: null,
        revision: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        history: [{at: nowIso, actor: 'system', action: '由环境变量初始化纳管子系统'}],
      })
    }
  }

  bootstrapFromEnv()

  function clearOtherDefaults(type, keepId) {
    for (const row of store.all()) {
      if (row.type === type && row.id !== keepId && row.isDefault) {
        store.put(row.id, {...row, isDefault: false, revision: (row.revision ?? 1) + 1})
      }
    }
  }

  async function handle(req, res, path, actor) {
    if (path === '/api/subsystems' && req.method === 'GET') {
      const items = store.all().sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name)).map(toPublicView)
      return json(res, {items})
    }

    if (path === '/api/subsystems/test' && req.method === 'POST') {
      const input = await body(req)
      check(ALLOWED_TYPES.includes(input?.type), 400, 'INVALID_SUBSYSTEM_TYPE', '不支持的子系统类型')
      const existing = input.id ? store.get(input.id) : null
      const resolveSec = field => {
        const provided = typeof input[field] === 'string' ? input[field].trim() : ''
        if (provided) return provided
        return existing ? decryptSecret(existing.secrets?.[field]) : ''
      }
      const result = await probeSubsystem({
        type: input.type,
        apiBase: input.apiBase,
        consoleEmail: input.consoleEmail,
        consoleToken: resolveSec('consoleToken'),
        consolePassword: resolveSec('consolePassword'),
        apiKey: resolveSec('apiKey'),
        authToken: resolveSec('authToken'),
        dbHost: input.dbHost ?? existing?.dbHost ?? '',
        dbPort: input.dbPort ?? existing?.dbPort ?? 5432,
        dbName: input.dbName ?? existing?.dbName ?? 'dify',
        dbUser: input.dbUser ?? existing?.dbUser ?? '',
        dbPassword: resolveSec('dbPassword'),
      })
      return json(res, result)
    }

    if (path === '/api/subsystems' && req.method === 'POST') {
      const input = await body(req)
      check(ALLOWED_TYPES.includes(input?.type), 400, 'INVALID_SUBSYSTEM_TYPE', '不支持的子系统类型')
      check(typeof input.name === 'string' && input.name.trim() && input.name.length <= 120, 400, 'INVALID_NAME', '请填写子系统名称')
      const apiBase = normalizeUrl(input.apiBase)
      check(apiBase, 400, 'INVALID_URL', '请填写有效的 API 地址')
      const dbHost = String(input.dbHost ?? '').trim().slice(0, 128)
      const dbPort = Number(input.dbPort || 5432)
      const dbName = String(input.dbName ?? 'dify').trim().slice(0, 128)
      const dbUser = String(input.dbUser ?? '').trim().slice(0, 128)
      if (input.type === 'dify') {
        check(dbHost && dbName && dbUser && typeof input.dbPassword === 'string' && input.dbPassword.trim(),
          400, 'DIFY_DB_REQUIRED', '配置 Dify 子系统时必须填写只读数据库主机、库名、账号与密码')
      }
      const recordId = typeof input.id === 'string' && /^[a-zA-Z0-9_-]{2,64}$/.test(input.id.trim())
        ? input.id.trim()
        : `${input.type}-${id().slice(0, 8)}`
      check(!store.get(recordId), 409, 'SUBSYSTEM_EXISTS', '该子系统 ID 已存在')

      const sameTypeCount = store.all().filter(r => r.type === input.type).length
      const isDefault = input.isDefault === true || sameTypeCount === 0
      const nowIso = new Date().toISOString()
      const secrets = {}
      for (const field of SECRET_FIELDS) {
        if (typeof input[field] === 'string' && input[field].trim()) {
          secrets[field] = encryptSecret(input[field].trim())
        }
      }
      const record = {
        id: recordId,
        name: input.name.trim(),
        type: input.type,
        version: String(input.version ?? '').trim().slice(0, 64),
        apiBase,
        workspaceId: String(input.workspaceId ?? '').trim().slice(0, 128),
        consoleEmail: String(input.consoleEmail ?? '').trim().slice(0, 128),
        pluginDaemonBase: input.pluginDaemonBase ? normalizeUrl(input.pluginDaemonBase) : '',
        dbHost,
        dbPort: Number.isFinite(dbPort) && dbPort > 0 ? dbPort : 5432,
        dbName,
        dbUser,
        tenantId: String(input.tenantId ?? '').trim().slice(0, 128),
        externalEndpoint: input.externalEndpoint ? normalizeUrl(input.externalEndpoint) : '',
        enabled: input.enabled !== false,
        isDefault,
        notes: String(input.notes ?? '').trim().slice(0, 500),
        secrets,
        lastTest: null,
        lastSync: null,
        revision: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        history: [{at: nowIso, actor, action: `新增纳管子系统 ${input.name.trim()}`}],
      }
      if (isDefault) clearOtherDefaults(record.type, record.id)
      let saved = store.put(record.id, record)
      applyDefaultToEnv(saved)
      let syncResult = null
      if (saved.type === 'dify' && directory) {
        syncResult = await syncDifySubsystem(saved, directory, inventoryStore)
        saved = store.put(saved.id, {
          ...saved,
          lastSync: syncResult,
          updatedAt: syncResult.at,
          history: [...(saved.history ?? []), {at: syncResult.at, actor, action: `自动同步 Dify 子系统全量数据：${syncResult.message}`}],
        })
      }
      return json(res, {...toPublicView(saved), syncResult}, 201)
    }

    const itemMatch = /^\/api\/subsystems\/([a-zA-Z0-9_-]+)(?:\/(test|default|sync|sync-accounts))?$/.exec(path)
    check(itemMatch, 404, 'NOT_FOUND')
    const [, targetId, action] = itemMatch
    const existing = store.get(targetId)
    check(existing, 404, 'NOT_FOUND', '子系统实例不存在')

    if ((action === 'sync' || action === 'sync-accounts') && req.method === 'POST') {
      check(existing.type === 'dify', 400, 'UNSUPPORTED_SYNC', '仅 Dify 子系统支持全量数据同步')
      const sync = await syncDifySubsystem(existing, directory, inventoryStore)
      const updated = store.put(existing.id, {
        ...existing,
        lastSync: sync,
        updatedAt: sync.at,
        history: [...(existing.history ?? []), {at: sync.at, actor, action: `手动同步 Dify 子系统全量数据：${sync.message}`}],
      })
      return json(res, {sync, item: toPublicView(updated)})
    }

    if (action === 'test' && req.method === 'POST') {
      const result = await probeSubsystem({
        type: existing.type,
        apiBase: existing.apiBase,
        consoleEmail: existing.consoleEmail,
        consoleToken: decryptSecret(existing.secrets?.consoleToken),
        consolePassword: decryptSecret(existing.secrets?.consolePassword),
        apiKey: decryptSecret(existing.secrets?.apiKey),
        authToken: decryptSecret(existing.secrets?.authToken),
        dbHost: existing.dbHost,
        dbPort: existing.dbPort,
        dbName: existing.dbName,
        dbUser: existing.dbUser,
        dbPassword: decryptSecret(existing.secrets?.dbPassword),
      })
      const nowIso = new Date().toISOString()
      const updated = store.put(existing.id, {
        ...existing,
        lastTest: {at: nowIso, ...result},
        updatedAt: nowIso,
      })
      return json(res, {test: result, item: toPublicView(updated)})
    }

    if (action === 'default' && req.method === 'POST') {
      const nowIso = new Date().toISOString()
      clearOtherDefaults(existing.type, existing.id)
      const updated = store.put(existing.id, {
        ...existing,
        isDefault: true,
        enabled: true,
        revision: (existing.revision ?? 1) + 1,
        updatedAt: nowIso,
        history: [...(existing.history ?? []), {at: nowIso, actor, action: '设为主用实例'}],
      })
      applyDefaultToEnv(updated)
      return json(res, toPublicView(updated))
    }

    if (!action && req.method === 'PUT') {
      const input = await body(req)
      check(typeof input.name === 'string' && input.name.trim() && input.name.length <= 120, 400, 'INVALID_NAME', '请填写子系统名称')
      const apiBase = normalizeUrl(input.apiBase)
      check(apiBase, 400, 'INVALID_URL', '请填写有效的 API 地址')
      const nowIso = new Date().toISOString()
      const mergedSecrets = {...(existing.secrets ?? {})}
      for (const field of SECRET_FIELDS) {
        if (typeof input[field] === 'string' && input[field].trim()) {
          mergedSecrets[field] = encryptSecret(input[field].trim())
        }
      }
      const nextDbHost = input.dbHost !== undefined ? String(input.dbHost).trim().slice(0, 128) : (existing.dbHost ?? '')
      const nextDbPort = input.dbPort !== undefined ? Number(input.dbPort || 5432) : (existing.dbPort ?? 5432)
      const nextDbName = input.dbName !== undefined ? String(input.dbName).trim().slice(0, 128) : (existing.dbName ?? 'dify')
      const nextDbUser = input.dbUser !== undefined ? String(input.dbUser).trim().slice(0, 128) : (existing.dbUser ?? '')
      if (existing.type === 'dify') {
        check(nextDbHost && nextDbName && nextDbUser && Boolean(decryptSecret(mergedSecrets.dbPassword)),
          400, 'DIFY_DB_REQUIRED', '配置 Dify 子系统时必须填写只读数据库主机、库名、账号与密码')
      }
      const nextDefault = typeof input.isDefault === 'boolean' ? input.isDefault : existing.isDefault
      if (nextDefault) clearOtherDefaults(existing.type, existing.id)
      let updated = store.put(existing.id, {
        ...existing,
        name: input.name.trim(),
        version: String(input.version ?? existing.version ?? '').trim().slice(0, 64),
        apiBase,
        workspaceId: String(input.workspaceId ?? existing.workspaceId ?? '').trim().slice(0, 128),
        consoleEmail: String(input.consoleEmail ?? existing.consoleEmail ?? '').trim().slice(0, 128),
        pluginDaemonBase: input.pluginDaemonBase !== undefined ? (input.pluginDaemonBase ? normalizeUrl(input.pluginDaemonBase) : '') : (existing.pluginDaemonBase ?? ''),
        dbHost: nextDbHost,
        dbPort: Number.isFinite(nextDbPort) && nextDbPort > 0 ? nextDbPort : 5432,
        dbName: nextDbName,
        dbUser: nextDbUser,
        tenantId: String(input.tenantId ?? existing.tenantId ?? '').trim().slice(0, 128),
        externalEndpoint: input.externalEndpoint !== undefined ? (input.externalEndpoint ? normalizeUrl(input.externalEndpoint) : '') : (existing.externalEndpoint ?? ''),
        enabled: typeof input.enabled === 'boolean' ? input.enabled : existing.enabled,
        isDefault: nextDefault,
        notes: input.notes !== undefined ? String(input.notes).trim().slice(0, 500) : (existing.notes ?? ''),
        secrets: mergedSecrets,
        revision: (existing.revision ?? 1) + 1,
        updatedAt: nowIso,
        history: [...(existing.history ?? []), {at: nowIso, actor, action: '更新子系统配置'}],
      })
      applyDefaultToEnv(updated)
      let syncResult = null
      if (updated.type === 'dify' && directory) {
        syncResult = await syncDifySubsystem(updated, directory, inventoryStore)
        updated = store.put(updated.id, {
          ...updated,
          lastSync: syncResult,
          updatedAt: syncResult.at,
          history: [...(updated.history ?? []), {at: syncResult.at, actor, action: `保存后自动同步 Dify 子系统全量数据：${syncResult.message}`}],
        })
      }
      return json(res, {...toPublicView(updated), syncResult})
    }

    if (!action && req.method === 'DELETE') {
      const nowIso = new Date().toISOString()
      store.put(existing.id, {
        ...existing,
        enabled: false,
        isDefault: false,
        deleted: true,
        revision: (existing.revision ?? 1) + 1,
        updatedAt: nowIso,
        history: [...(existing.history ?? []), {at: nowIso, actor, action: '移除纳管子系统'}],
      })
      return json(res, {ok: true, id: existing.id})
    }

    check(false, 405, 'METHOD_NOT_ALLOWED')
  }

  function collectDifyInventory() {
    const activeIds = new Set(store.all().filter(r => !r.deleted && r.type === 'dify' && r.enabled).map(r => `dify:${r.id}`))
    const appsMap = new Map()
    const datasetsMap = new Map()
    const mcpMap = new Map()
    const pluginsMap = new Map()
    const keysMap = new Map()
    const modelUsageMap = new Map()
    let syncedAt = null
    for (const snap of inventoryStore.all()) {
      if (!snap || !activeIds.has(`dify:${snap.subsystemId}`)) continue
      if (snap.syncedAt && (!syncedAt || snap.syncedAt > syncedAt)) syncedAt = snap.syncedAt
      for (const item of snap.apps ?? []) {
        const k = item?.resourceId || `${item?.workspaceId}:${item?.name}`
        if (k && !appsMap.has(k)) appsMap.set(k, item)
      }
      for (const item of snap.datasets ?? []) {
        const k = item?.resourceId || `${item?.workspaceId}:${item?.name}`
        if (k && !datasetsMap.has(k)) datasetsMap.set(k, item)
      }
      for (const item of snap.mcpProviders ?? []) {
        const k = item?.providerId || `${item?.workspaceId}:${item?.serverIdentifier || item?.name}`
        if (k && !mcpMap.has(k)) mcpMap.set(k, item)
      }
      for (const item of snap.plugins ?? []) {
        const k = item?.installationId || `${item?.workspaceId}:${item?.pluginId}`
        if (k && !pluginsMap.has(k)) pluginsMap.set(k, item)
      }
      for (const item of snap.apiKeys ?? []) {
        const k = item?.keyId || `${item?.workspaceId}:${item?.appId}:${item?.tokenPreview}`
        if (k && !keysMap.has(k)) keysMap.set(k, item)
      }
      for (const item of snap.modelUsage ?? []) {
        const k = `${item?.workspaceId}::${item?.providerName}::${item?.modelName}`
        if (k && !modelUsageMap.has(k)) modelUsageMap.set(k, item)
      }
    }
    return {
      syncedAt,
      apps: [...appsMap.values()],
      datasets: [...datasetsMap.values()],
      mcpProviders: [...mcpMap.values()],
      plugins: [...pluginsMap.values()],
      apiKeys: [...keysMap.values()],
      modelUsage: [...modelUsageMap.values()],
    }
  }

  async function setDifyModelEnabled({workspaceId, providerName, modelName, modelType = 'text-generation', enabled}) {
    const all = store.all().filter(r => !r.deleted && r.type === 'dify' && r.enabled && r.dbHost && r.dbUser && r.secrets?.dbPassword)
    const rec = all.find(r => r.isDefault) ?? all[0] ?? null
    if (!rec) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED'}
    const password = decryptSecret(rec.secrets?.dbPassword)
    const client = new pg.Client({
      host: String(rec.dbHost).trim(),
      port: Number(rec.dbPort) || 5432,
      database: String(rec.dbName || 'dify').trim(),
      user: String(rec.dbUser).trim(),
      password,
      connectionTimeoutMillis: 5000,
      statement_timeout: 8000,
    })
    try {
      await client.connect()
      const existing = await client.query(
        `SELECT id FROM provider_model_settings WHERE tenant_id = $1::uuid AND provider_name = $2 AND model_name = $3 AND model_type = $4 LIMIT 1`,
        [workspaceId, providerName, modelName, modelType],
      )
      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE provider_model_settings SET enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [Boolean(enabled), existing.rows[0].id],
        )
      } else {
        await client.query(
          `INSERT INTO provider_model_settings (id, tenant_id, provider_name, model_name, model_type, enabled, load_balancing_enabled, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [workspaceId, providerName, modelName, modelType, Boolean(enabled)],
        )
      }
      // Update cached inventory snapshot immediately so UI reflects new switch state
      for (const snap of inventoryStore.all()) {
        if (!snap || !Array.isArray(snap.modelUsage)) continue
        let changed = false
        const updatedUsage = snap.modelUsage.map(u => {
          if (u.workspaceId === workspaceId && u.providerName === providerName && u.modelName === modelName) {
            changed = true
            return {...u, enabled: Boolean(enabled)}
          }
          return u
        })
        if (changed) inventoryStore.put(`dify:${snap.subsystemId}`, {...snap, modelUsage: updatedUsage})
      }
      return {ok: true, enabled: Boolean(enabled)}
    } catch (err) {
      return {ok: false, error: err?.message || String(err)}
    } finally {
      await client.end().catch(() => {})
    }
  }

function aes128EcbBlock(key, block) {
  const c = createCipheriv('aes-128-ecb', key, null)
  c.setAutoPadding(false)
  return Buffer.concat([c.update(block), c.final()])
}

function xorBuf(a, b) {
  const out = Buffer.alloc(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]
  return out
}

function cmacSubkeys(key) {
  const zero = Buffer.alloc(16, 0)
  const L = aes128EcbBlock(key, zero)
  const dbl = (buf) => {
    const out = Buffer.alloc(16)
    let carry = 0
    for (let i = 15; i >= 0; i--) {
      const v = (buf[i] << 1) | carry
      out[i] = v & 0xff
      carry = (buf[i] & 0x80) ? 1 : 0
    }
    if (buf[0] & 0x80) out[15] ^= 0x87
    return out
  }
  const K1 = dbl(L)
  const K2 = dbl(K1)
  return {K1, K2}
}

function omac1(key, tagByte, data) {
  const {K1, K2} = cmacSubkeys(key)
  const prefix = Buffer.alloc(16, 0)
  prefix[15] = tagByte
  const msg = Buffer.concat([prefix, data])
  const n = Math.ceil(msg.length / 16)
  const complete = msg.length > 0 && msg.length % 16 === 0
  let state = Buffer.alloc(16, 0)
  for (let i = 0; i < n - 1; i++) {
    state = aes128EcbBlock(key, xorBuf(state, msg.subarray(i * 16, (i + 1) * 16)))
  }
  const lastSlice = msg.subarray((n - 1) * 16)
  let lastBlock
  if (complete) {
    lastBlock = xorBuf(lastSlice, K1)
  } else {
    const padded = Buffer.alloc(16, 0)
    lastSlice.copy(padded, 0)
    padded[lastSlice.length] = 0x80
    lastBlock = xorBuf(padded, K2)
  }
  return aes128EcbBlock(key, xorBuf(state, lastBlock))
}

// Dify 1.7.1 compatible HYBRID: RSA-OAEP(SHA-1) + AES-128-EAX encryption
function encryptDifyHybrid(text, publicKeyPem) {
  const aesKey = randomBytes(16)
  const nonce = randomBytes(16)
  const plain = Buffer.from(String(text ?? ''), 'utf8')
  const N = omac1(aesKey, 0, nonce)
  const H = omac1(aesKey, 1, Buffer.alloc(0))
  const ctr = createCipheriv('aes-128-ctr', aesKey, N)
  const ciphertext = Buffer.concat([ctr.update(plain), ctr.final()])
  const C = omac1(aesKey, 2, ciphertext)
  const tag = xorBuf(xorBuf(N, H), C)
  const encAesKey = publicEncrypt(
    {key: String(publicKeyPem), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1'},
    aesKey,
  )
  return Buffer.concat([Buffer.from('HYBRID:', 'ascii'), encAesKey, nonce, tag, ciphertext]).toString('base64')
}

function connectDefaultDifyDb(store) {
  const all = store.all().filter(r => !r.deleted && r.type === 'dify' && r.enabled && r.dbHost && r.dbUser && r.secrets?.dbPassword)
  const rec = all.find(r => r.isDefault) ?? all[0] ?? null
  if (!rec) return null
  const password = decryptSecret(rec.secrets?.dbPassword)
  return new pg.Client({
    host: String(rec.dbHost).trim(),
    port: Number(rec.dbPort) || 5432,
    database: String(rec.dbName || 'dify').trim(),
    user: String(rec.dbUser).trim(),
    password,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  })
}

  async function batchUpsertDifyModel({
    workspaceIds = null,
    providerName = 'langgenius/openai_api_compatible/openai_api_compatible',
    modelName,
    modelType = 'text-generation',
    displayName = '',
    endpointUrl = '',
    apiKey = '',
    contextSize = '4096',
    maxTokens = '4096',
    mode = 'chat',
  }) {
    const client = connectDefaultDifyDb(store)
    if (!client) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED'}
    try {
      await client.connect()
      const tenantsRes = workspaceIds && workspaceIds.length > 0
        ? await client.query(`SELECT id::text AS id, name, encrypt_public_key FROM tenants WHERE id::text = ANY($1::text[])`, [workspaceIds])
        : await client.query(`SELECT id::text AS id, name, encrypt_public_key FROM tenants ORDER BY created_at ASC`)
      let succeeded = 0
      let failed = 0
      const errors = []
      for (const t of tenantsRes.rows) {
        try {
          const cfg = {
            mode: mode || 'chat',
            api_type: 'chat_completions',
            context_size: String(contextSize || '4096'),
            display_name: displayName || modelName,
            endpoint_url: endpointUrl,
            max_tokens_to_sample: String(maxTokens || '4096'),
            stream_include_usage: 'enabled',
            compatibility_mode: 'strict',
            token_param_name: 'auto',
            stream_mode_auth: 'not_use',
            stream_mode_delimiter: '\\n\\n',
            user_identity_support: 'support',
            enable_request_metadata: 'disabled',
            vision_support: 'no_support',
            audio_support: 'no_support',
            video_support: 'no_support',
            document_support: 'no_support',
            agent_thought_support: 'not_supported',
            function_calling_type: 'no_call',
            stream_function_calling: 'not_supported',
            structured_output_support: 'not_supported',
            web_search_support: 'not_supported',
          }
          if (apiKey && t.encrypt_public_key) {
            cfg.api_key = encryptDifyHybrid(apiKey, t.encrypt_public_key)
          }
          await client.query(
            `INSERT INTO provider_models (id, tenant_id, provider_name, model_name, model_type, encrypted_config, is_valid, created_at, updated_at)
             VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, true, CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0))
             ON CONFLICT (tenant_id, provider_name, model_name, model_type)
             DO UPDATE SET encrypted_config = EXCLUDED.encrypted_config, is_valid = true, updated_at = CURRENT_TIMESTAMP(0)`,
            [t.id, providerName, modelName, modelType, JSON.stringify(cfg)],
          )
          const existSet = await client.query(
            `SELECT id FROM provider_model_settings WHERE tenant_id = $1::uuid AND provider_name = $2 AND model_name = $3 AND model_type = $4 LIMIT 1`,
            [t.id, providerName, modelName, modelType],
          )
          if (existSet.rows.length > 0) {
            await client.query(`UPDATE provider_model_settings SET enabled = true, updated_at = CURRENT_TIMESTAMP(0) WHERE id = $1`, [existSet.rows[0].id])
          } else {
            await client.query(
              `INSERT INTO provider_model_settings (id, tenant_id, provider_name, model_name, model_type, enabled, load_balancing_enabled, created_at, updated_at)
               VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, true, false, CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0))`,
              [t.id, providerName, modelName, modelType],
            )
          }
          succeeded += 1
        } catch (err) {
          failed += 1
          errors.push(`${t.name || t.id}: ${err?.message || err}`)
        }
      }
      return {ok: failed === 0 && succeeded > 0, totalTenants: tenantsRes.rows.length, succeeded, failed, errors: errors.slice(0, 10)}
    } catch (err) {
      return {ok: false, error: err?.message || String(err)}
    } finally {
      await client.end().catch(() => {})
    }
  }

  async function batchDeleteDifyModel({workspaceIds = null, providerName, modelName, modelType = null}) {
    const client = connectDefaultDifyDb(store)
    if (!client) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED'}
    try {
      await client.connect()
      const params = [providerName, modelName]
      let where = `provider_name = $1 AND model_name = $2`
      if (modelType) { params.push(modelType); where += ` AND model_type = $${params.length}` }
      if (workspaceIds && workspaceIds.length > 0) { params.push(workspaceIds); where += ` AND tenant_id::text = ANY($${params.length}::text[])` }
      const delModels = await client.query(`DELETE FROM provider_models WHERE ${where}`, params)
      const delSettings = await client.query(`DELETE FROM provider_model_settings WHERE ${where}`, params)
      try {
        await client.query(`DELETE FROM tenant_default_models WHERE ${where}`, params)
      } catch {}
      return {ok: true, deletedModels: delModels.rowCount ?? 0, deletedSettings: delSettings.rowCount ?? 0}
    } catch (err) {
      return {ok: false, error: err?.message || String(err)}
    } finally {
      await client.end().catch(() => {})
    }
  }

  async function batchToggleDifyModel({workspaceIds = null, providerName, modelName, modelType = 'text-generation', enabled}) {
    const client = connectDefaultDifyDb(store)
    if (!client) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED'}
    try {
      await client.connect()
      const tenantsRes = workspaceIds && workspaceIds.length > 0
        ? await client.query(`SELECT id::text AS id FROM tenants WHERE id::text = ANY($1::text[])`, [workspaceIds])
        : await client.query(`SELECT DISTINCT tenant_id::text AS id FROM provider_models WHERE provider_name = $1 AND model_name = $2 UNION SELECT DISTINCT tenant_id::text AS id FROM provider_model_settings WHERE provider_name = $1 AND model_name = $2`, [providerName, modelName])
      let affected = 0
      for (const row of tenantsRes.rows) {
        const ex = await client.query(
          `SELECT id FROM provider_model_settings WHERE tenant_id = $1::uuid AND provider_name = $2 AND model_name = $3 AND model_type = $4 LIMIT 1`,
          [row.id, providerName, modelName, modelType],
        )
        if (ex.rows.length > 0) {
          await client.query(`UPDATE provider_model_settings SET enabled = $1, updated_at = CURRENT_TIMESTAMP(0) WHERE id = $2`, [Boolean(enabled), ex.rows[0].id])
        } else {
          await client.query(
            `INSERT INTO provider_model_settings (id, tenant_id, provider_name, model_name, model_type, enabled, load_balancing_enabled, created_at, updated_at)
             VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, false, CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0))`,
            [row.id, providerName, modelName, modelType, Boolean(enabled)],
          )
        }
        affected += 1
      }
      return {ok: true, affected, enabled: Boolean(enabled)}
    } catch (err) {
      return {ok: false, error: err?.message || String(err)}
    } finally {
      await client.end().catch(() => {})
    }
  }

  async function getDifyDatasetManifest(datasetId) {
    const client = connectDefaultDifyDb(store)
    if (!client) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED'}
    try {
      await client.connect()
      const dsRes = await client.query(
        `SELECT id::text AS id, tenant_id::text AS workspace_id, name, description, indexing_technique
         FROM datasets WHERE id::text = $1 LIMIT 1`,
        [datasetId],
      )
      if (dsRes.rows.length === 0) return {ok: false, error: 'DATASET_NOT_FOUND'}
      const ds = dsRes.rows[0]
      const docsRes = await client.query(
        `SELECT id::text AS id, name, word_count, indexing_status, enabled, archived, updated_at, created_at
         FROM documents
         WHERE dataset_id::text = $1 AND COALESCE(archived, false) = false
         ORDER BY position ASC, created_at ASC`,
        [datasetId],
      )
      return {
        ok: true,
        id: ds.id,
        name: ds.name,
        workspaceId: ds.workspace_id,
        documents: docsRes.rows.map(r => ({
          id: r.id,
          name: r.name,
          word_count: Number(r.word_count || 0),
          indexing_status: r.indexing_status || 'completed',
          enabled: r.enabled !== false,
          updated_at: r.updated_at ? Math.floor(new Date(r.updated_at).getTime() / 1000) : 0,
        })),
      }
    } catch (err) {
      return {ok: false, error: err?.message || String(err)}
    } finally {
      await client.end().catch(() => {})
    }
  }

  async function copyDifyDatasetToWorkspace({sourceDatasetId, targetWorkspaceId, name}) {
    const client = connectDefaultDifyDb(store)
    if (!client) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED'}
    try {
      await client.connect()
      const srcRes = await client.query(`SELECT * FROM datasets WHERE id::text = $1 LIMIT 1`, [sourceDatasetId])
      if (srcRes.rows.length === 0) return {ok: false, error: 'SOURCE_DATASET_NOT_FOUND'}
      const src = srcRes.rows[0]

      // Resolve owner account_id of target workspace
      const ownerRes = await client.query(
        `SELECT account_id::text AS account_id FROM tenant_account_joins WHERE tenant_id::text = $1 ORDER BY (CASE WHEN role = 'owner' THEN 0 ELSE 1 END), created_at ASC LIMIT 1`,
        [targetWorkspaceId],
      )
      const targetOwnerId = ownerRes.rows?.[0]?.account_id || src.created_by

      const cloneName = String(name || src.name || '共享知识库').slice(0, 200)
      await client.query('BEGIN')
      const newDsRes = await client.query(
        `INSERT INTO datasets (
           id, tenant_id, name, description, provider, permission, data_source_type,
           indexing_technique, index_struct, created_by, created_at, updated_by, updated_at,
           embedding_model, embedding_model_provider, retrieval_model, built_in_field_enabled
         ) VALUES (
           gen_random_uuid(), $1::uuid, $2, $3, $4, 'all_team_members', $5,
           'economy', $6, $7::uuid, CURRENT_TIMESTAMP(0), $7::uuid, CURRENT_TIMESTAMP(0),
           $8, $9, $10, $11
         ) RETURNING id::text AS id`,
        [
          targetWorkspaceId,
          cloneName,
          src.description || `由应用中心受控复制自共享知识库（${src.name}）`,
          src.provider || 'vendor',
          src.data_source_type || 'upload_file',
          src.index_struct || null,
          targetOwnerId,
          src.embedding_model || null,
          src.embedding_model_provider || null,
          src.retrieval_model || null,
          Boolean(src.built_in_field_enabled),
        ],
      )
      const replicaDatasetId = newDsRes.rows[0].id

      const srcDocs = await client.query(
        `SELECT * FROM documents WHERE dataset_id::text = $1 AND COALESCE(archived, false) = false ORDER BY position ASC, created_at ASC`,
        [sourceDatasetId],
      )
      let copiedDocuments = 0
      let copiedSegments = 0
      for (const doc of srcDocs.rows) {
        const newDocRes = await client.query(
          `INSERT INTO documents (
             id, tenant_id, dataset_id, position, data_source_type, data_source_info,
             batch, name, created_from, created_by, created_at, indexing_status,
             enabled, archived, updated_at, doc_form, word_count, tokens,
             completed_at, indexing_latency, doc_language
           ) VALUES (
             gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5,
             $6, $7, $8, $9::uuid, CURRENT_TIMESTAMP(0), 'completed',
             true, false, CURRENT_TIMESTAMP(0), $10, $11, $12,
             CURRENT_TIMESTAMP(0), $13, $14
           ) RETURNING id::text AS id`,
          [
            targetWorkspaceId,
            replicaDatasetId,
            doc.position ?? copiedDocuments + 1,
            doc.data_source_type || 'upload_file',
            doc.data_source_info || null,
            doc.batch || `clone-${Date.now()}`,
            doc.name,
            doc.created_from || 'web',
            targetOwnerId,
            doc.doc_form || 'text_model',
            doc.word_count ?? 0,
            doc.tokens ?? 0,
            doc.indexing_latency ?? 0,
            doc.doc_language || 'Chinese',
          ],
        )
        const newDocId = newDocRes.rows[0].id
        copiedDocuments += 1

        const srcSegs = await client.query(
          `SELECT * FROM document_segments WHERE document_id::text = $1 ORDER BY position ASC`,
          [doc.id],
        )
        for (const seg of srcSegs.rows) {
          await client.query(
            `INSERT INTO document_segments (
               id, tenant_id, dataset_id, document_id, position, content, answer,
               word_count, tokens, keywords, index_node_id, index_node_hash,
               hit_count, enabled, status, created_by, created_at, updated_at, completed_at
             ) VALUES (
               gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
               $7, $8, $9, $10, $11,
               0, true, 'completed', $12::uuid, CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0), CURRENT_TIMESTAMP(0)
             )`,
            [
              targetWorkspaceId,
              replicaDatasetId,
              newDocId,
              seg.position ?? 1,
              seg.content || '',
              seg.answer || null,
              seg.word_count ?? 0,
              seg.tokens ?? 0,
              seg.keywords || null,
              seg.index_node_id || null,
              seg.index_node_hash || null,
              targetOwnerId,
            ],
          )
          copiedSegments += 1
        }
      }

      // Clone economy keyword table if present so Dify keyword retrieval works immediately
      try {
        const kwRes = await client.query(`SELECT data_source_type, keyword_table FROM dataset_keyword_tables WHERE dataset_id::text = $1 LIMIT 1`, [sourceDatasetId])
        if (kwRes.rows.length > 0) {
          await client.query(
            `INSERT INTO dataset_keyword_tables (id, dataset_id, keyword_table, data_source_type) VALUES (gen_random_uuid(), $1::uuid, $2, $3)`,
            [replicaDatasetId, kwRes.rows[0].keyword_table, kwRes.rows[0].data_source_type || 'database'],
          )
        }
      } catch {}

      await client.query('COMMIT')
      return {ok: true, replicaDatasetId, copiedDocuments, copiedSegments}
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return {ok: false, error: err?.message || String(err)}
    } finally {
      await client.end().catch(() => {})
    }
  }

  function shortProviderName(raw) {
    const s = String(raw || '').trim()
    if (!s) return '其他'
    const parts = s.split('/').filter(Boolean)
    const last = parts[parts.length - 1] || s
    if (last === 'openai_api_compatible') return 'openai-compatible'
    return last
  }

  async function getDifyAppInsights({appId, days = 30}) {
    const client = connectDefaultDifyDb(store)
    if (!client) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED'}
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30))
    try {
      await client.connect()
      const appRes = await client.query(
        `SELECT a.id::text AS id, a.name, a.mode, a.description, a.tenant_id::text AS workspace_id,
                t.name AS workspace_name, ac.name AS owner_name, ac.email AS owner_email
         FROM apps a
         LEFT JOIN tenants t ON t.id = a.tenant_id
         LEFT JOIN accounts ac ON ac.id = a.created_by
         WHERE a.id::text = $1 LIMIT 1`,
        [appId],
      )
      if (appRes.rows.length === 0) return {ok: false, error: 'APP_NOT_FOUND'}
      const app = appRes.rows[0]

      // 1. Model usage from messages
      const msgRes = await client.query(
        `SELECT
           COALESCE(NULLIF(TRIM(model_id), ''), 'unknown') AS model_name,
           COALESCE(NULLIF(TRIM(model_provider), ''), '其他') AS provider_name,
           COUNT(*)::int AS calls,
           COALESCE(SUM(COALESCE(message_tokens, 0) + COALESCE(answer_tokens, 0)), 0)::bigint AS tokens,
           AVG(NULLIF(provider_response_latency, 0)) AS avg_latency,
           COUNT(*) FILTER (WHERE COALESCE(status, 'normal') <> 'normal' OR COALESCE(error, '') <> '')::int AS errors
         FROM messages
         WHERE app_id::text = $1 AND created_at >= CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 day')
         GROUP BY 1, 2`,
        [appId, safeDays],
      )

      const modelMap = new Map()
      for (const r of msgRes.rows) {
        const provider = shortProviderName(r.provider_name)
        const key = `${r.model_name}::${provider}`
        modelMap.set(key, {
          model: r.model_name,
          provider,
          calls: Number(r.calls || 0),
          tokens: Number(r.tokens || 0),
          latencySum: Number(r.avg_latency || 0) * Number(r.calls || 0),
          latencyCount: Number(r.avg_latency) > 0 ? Number(r.calls || 0) : 0,
          errors: Number(r.errors || 0),
        })
      }

      // 1b. Supplement workflow-only apps via workflow_node_executions (LLM nodes) when messages has 0 rows
      if (modelMap.size === 0) {
        try {
          const wfNodeRes = await client.query(
            `SELECT elapsed_time, status, error, execution_metadata
             FROM workflow_node_executions
             WHERE app_id::text = $1 AND node_type = 'llm'
               AND created_at >= CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 day')
             LIMIT 5000`,
            [appId, safeDays],
          )
          for (const r of wfNodeRes.rows) {
            let meta = {}
            try { meta = typeof r.execution_metadata === 'string' ? JSON.parse(r.execution_metadata) : (r.execution_metadata || {}) } catch {}
            const modelName = String(meta.model_name || meta.model || 'workflow-llm')
            const provider = shortProviderName(meta.provider_name || meta.provider || '其他')
            const key = `${modelName}::${provider}`
            const entry = modelMap.get(key) ?? {model: modelName, provider, calls: 0, tokens: 0, latencySum: 0, latencyCount: 0, errors: 0}
            entry.calls += 1
            entry.tokens += Number(meta.total_tokens || 0)
            if (Number(r.elapsed_time) > 0) {
              entry.latencySum += Number(r.elapsed_time)
              entry.latencyCount += 1
            }
            if (r.status === 'failed' || r.error) entry.errors += 1
            modelMap.set(key, entry)
          }
        } catch {}
      }

      const models = [...modelMap.values()]
        .map(m => ({
          model: m.model,
          provider: m.provider,
          calls: m.calls,
          tokens: m.tokens,
          avgLatencySec: m.latencyCount > 0 ? Math.round((m.latencySum / m.latencyCount) * 100) / 100 : 0,
          errorRatePct: m.calls > 0 ? Math.round((m.errors / m.calls) * 1000) / 10 : 0,
          errors: m.errors,
        }))
        .sort((a, b) => b.calls - a.calls || b.tokens - a.tokens)

      const totalCalls = models.reduce((s, m) => s + m.calls, 0)
      const totalTokens = models.reduce((s, m) => s + m.tokens, 0)
      const totalErrors = models.reduce((s, m) => s + m.errors, 0)
      const weightedLatency = models.reduce((s, m) => s + m.avgLatencySec * m.calls, 0)
      const avgLatencySec = totalCalls > 0 ? Math.round((weightedLatency / totalCalls) * 100) / 100 : 0
      const errorRatePct = totalCalls > 0 ? Math.round((totalErrors / totalCalls) * 1000) / 10 : 0

      // 2. Source channel breakdown from messages + workflow_runs
      const srcRes = await client.query(
        `SELECT COALESCE(from_source, 'console') AS source, COUNT(*)::int AS count
         FROM messages
         WHERE app_id::text = $1 AND created_at >= CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 day')
         GROUP BY 1 ORDER BY 2 DESC`,
        [appId, safeDays],
      )
      const wfRunRes = await client.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'failed' OR COALESCE(error, '') <> '')::int AS failed,
                COALESCE(SUM(total_tokens), 0)::bigint AS tokens,
                AVG(NULLIF(elapsed_time, 0)) AS avg_elapsed
         FROM workflow_runs
         WHERE app_id::text = $1 AND created_at >= CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 day')`,
        [appId, safeDays],
      )
      const wfRun = wfRunRes.rows?.[0] ?? {total: 0, failed: 0, tokens: 0, avg_elapsed: 0}

      // 3. Reconstruct DSL / YAML & static structure from workflows + app_model_configs
      const wfRes = await client.query(
        `SELECT version, type, graph, features, created_at, updated_at
         FROM workflows WHERE app_id::text = $1 ORDER BY updated_at DESC LIMIT 10`,
        [appId],
      )
      const cfgRes = await client.query(
        `SELECT provider, model_id, model, pre_prompt, dataset_configs, agent_mode, updated_at
         FROM app_model_configs WHERE app_id::text = $1 ORDER BY updated_at DESC LIMIT 1`,
        [appId],
      )

      const latestWf = wfRes.rows?.[0] ?? null
      const latestCfg = cfgRes.rows?.[0] ?? null
      let parsedGraph = null
      try { parsedGraph = latestWf?.graph ? (typeof latestWf.graph === 'string' ? JSON.parse(latestWf.graph) : latestWf.graph) : null } catch {}
      let parsedModelCfg = null
      try { parsedModelCfg = latestCfg?.model ? (typeof latestCfg.model === 'string' ? JSON.parse(latestCfg.model) : latestCfg.model) : null } catch {}
      let parsedDatasetCfg = null
      try { parsedDatasetCfg = latestCfg?.dataset_configs ? (typeof latestCfg.dataset_configs === 'string' ? JSON.parse(latestCfg.dataset_configs) : latestCfg.dataset_configs) : null } catch {}

      const nodes = Array.isArray(parsedGraph?.nodes) ? parsedGraph.nodes : []
      const nodeTypes = {}
      const dslModels = new Set()
      const dslDatasets = new Set()
      const dslTools = []
      const promptSnippets = []

      for (const n of nodes) {
        const d = n?.data ?? {}
        const ntype = String(d.type || n.type || 'unknown')
        nodeTypes[ntype] = (nodeTypes[ntype] || 0) + 1
        if (d.model?.name) dslModels.add(`${d.model.name} (${shortProviderName(d.model.provider)})`)
        if (Array.isArray(d.dataset_ids)) for (const idItem of d.dataset_ids) dslDatasets.add(String(idItem))
        if (ntype === 'http-request' && d.url) dslTools.push(`HTTP: ${d.method || 'GET'} ${d.url}`)
        if (ntype === 'tool' && (d.tool_name || d.provider_name)) dslTools.push(`Tool: ${d.provider_name || ''}/${d.tool_name || ''}`)
        if (Array.isArray(d.prompt_template)) {
          for (const p of d.prompt_template) {
            if (p?.text) promptSnippets.push(`[${d.title || ntype}] ${String(p.text).slice(0, 180)}`)
          }
        }
      }
      if (parsedModelCfg?.name) dslModels.add(`${parsedModelCfg.name} (${shortProviderName(parsedModelCfg.provider)})`)
      if (latestCfg?.pre_prompt) promptSnippets.push(`[System Prompt] ${String(latestCfg.pre_prompt).slice(0, 300)}`)
      if (Array.isArray(parsedDatasetCfg?.datasets?.datasets)) {
        for (const ds of parsedDatasetCfg.datasets.datasets) {
          if (ds?.dataset?.id) dslDatasets.add(String(ds.dataset.id))
        }
      }

      const dslObj = {
        version: '0.1.5',
        kind: 'app',
        app: {
          name: app.name,
          mode: app.mode,
          description: app.description || '',
        },
        ...(latestWf ? {
          workflow: {
            version: latestWf.version || 'draft',
            graph: parsedGraph || {},
          },
        } : {}),
        ...(latestCfg ? {
          model_config: {
            model: parsedModelCfg || {provider: latestCfg.provider, name: latestCfg.model_id},
            pre_prompt: latestCfg.pre_prompt || '',
            dataset_configs: parsedDatasetCfg || {},
          },
        } : {}),
      }
      const yamlText = YAML.stringify(dslObj)

      return {
        ok: true,
        days: safeDays,
        app: {
          appId: app.id,
          name: app.name,
          mode: app.mode || 'chat',
          description: app.description || '',
          source: 'Dify',
          workspaceId: app.workspace_id,
          workspaceName: app.workspace_name || '',
          ownerName: app.owner_name || app.owner_email || 'Dify 租户',
          ownerEmail: app.owner_email || '',
        },
        summary: {
          calls: totalCalls || Number(wfRun.total || 0),
          tokens: totalTokens || Number(wfRun.tokens || 0),
          avgLatencySec: totalCalls > 0 ? avgLatencySec : (Number(wfRun.avg_elapsed) > 0 ? Math.round(Number(wfRun.avg_elapsed) * 100) / 100 : 0),
          errorRatePct: totalCalls > 0 ? errorRatePct : (Number(wfRun.total) > 0 ? Math.round((Number(wfRun.failed || 0) / Number(wfRun.total)) * 1000) / 10 : 0),
          modelCount: models.length,
        },
        models,
        sourceChannels: srcRes.rows.map(r => ({source: r.source, count: Number(r.count || 0)})),
        versions: wfRes.rows.map(r => ({version: r.version || 'draft', at: r.updated_at ? new Date(r.updated_at).toISOString() : null})),
        dsl: {
          nodeCount: nodes.length,
          nodeTypes,
          models: [...dslModels],
          datasetCount: dslDatasets.size,
          externalTools: dslTools.slice(0, 20),
          promptPreviews: promptSnippets.slice(0, 4),
          yamlText,
        },
      }
    } catch (err) {
      return {ok: false, error: err?.message || String(err)}
    } finally {
      await client.end().catch(() => {})
    }
  }

  async function getDifyHighFreqApps({minRuns = 1, days = 30}) {
    const client = connectDefaultDifyDb(store)
    if (!client) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED', items: []}
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30))
    const safeMin = Math.max(0, Number(minRuns) || 0)
    try {
      await client.connect()
      const res = await client.query(
        `WITH msg_counts AS (
           SELECT app_id, COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(message_tokens,0)+COALESCE(answer_tokens,0)),0)::bigint AS tokens
           FROM messages WHERE created_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day') GROUP BY app_id
         ),
         wf_counts AS (
           SELECT app_id, COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(total_tokens,0)),0)::bigint AS tokens
           FROM workflow_runs WHERE created_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day') GROUP BY app_id
         )
         SELECT a.id::text AS app_id, a.name AS app_name, a.mode,
                GREATEST(COALESCE(m.cnt, 0), COALESCE(w.cnt, 0))::int AS run_count,
                GREATEST(COALESCE(m.tokens, 0), COALESCE(w.tokens, 0))::bigint AS total_tokens,
                ac.name AS owner_name, t.name AS workspace_name
         FROM apps a
         LEFT JOIN msg_counts m ON m.app_id = a.id
         LEFT JOIN wf_counts w ON w.app_id = a.id
         LEFT JOIN accounts ac ON ac.id = a.created_by
         LEFT JOIN tenants t ON t.id = a.tenant_id
         WHERE GREATEST(COALESCE(m.cnt, 0), COALESCE(w.cnt, 0)) >= $2
         ORDER BY run_count DESC, total_tokens DESC
         LIMIT 200`,
        [safeDays, safeMin],
      )
      return {
        ok: true,
        items: res.rows.map(r => ({
          appId: r.app_id,
          appName: r.app_name,
          mode: r.mode || 'chat',
          runCount: Number(r.run_count || 0),
          totalTokens: Number(r.total_tokens || 0),
          ownerName: r.owner_name || r.workspace_name || 'Dify 租户',
        })),
      }
    } catch (err) {
      return {ok: false, error: err?.message || String(err), items: []}
    } finally {
      await client.end().catch(() => {})
    }
  }

  async function getDifyAppExposure({appId}) {
    const client = connectDefaultDifyDb(store)
    if (!client) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED'}
    try {
      await client.connect()
      const appRes = await client.query(
        `SELECT a.id::text AS app_id, a.name AS app_name, a.mode, a.enable_site, a.enable_api,
                a.tenant_id::text AS workspace_id, t.name AS workspace_name,
                ac.name AS owner_name, ac.email AS owner_email,
                s.status AS site_status, s.code AS site_code, s.title AS site_title, s.updated_at AS site_updated_at
         FROM apps a
         LEFT JOIN tenants t ON t.id = a.tenant_id
         LEFT JOIN accounts ac ON ac.id = a.created_by
         LEFT JOIN sites s ON s.app_id = a.id
         WHERE a.id::text = $1 LIMIT 1`,
        [appId],
      )
      if (appRes.rows.length === 0) return {ok: false, error: 'APP_NOT_FOUND'}
      const row = appRes.rows[0]

      const keyRes = await client.query(
        `SELECT id::text AS key_id, token, created_at, last_used_at
         FROM api_tokens
         WHERE app_id::text = $1 AND type = 'app'
         ORDER BY created_at DESC LIMIT 50`,
        [appId],
      )
      const apiKeys = keyRes.rows.map(k => {
        const raw = String(k.token || '')
        const mask = raw.length > 10 ? `${raw.slice(0, 6)}****${raw.slice(-4)}` : (raw ? 'app-****' : '—')
        return {
          keyId: k.key_id,
          tokenMask: mask,
          createdAt: k.created_at ? new Date(k.created_at).toISOString() : null,
          lastUsedAt: k.last_used_at ? new Date(k.last_used_at).toISOString() : null,
        }
      })

      const chRes = await client.query(
        `SELECT COALESCE(NULLIF(from_source, ''), 'unknown') AS src, COUNT(*)::int AS cnt,
                COUNT(DISTINCT from_end_user_id)::int AS end_users
         FROM messages
         WHERE app_id::text = $1 AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
         GROUP BY 1`,
        [appId],
      ).catch(() => ({rows: []}))

      let apiCalls = 0, webCalls = 0, consoleCalls = 0, uniqueEndUsers = 0
      for (const c of chRes.rows) {
        const cnt = Number(c.cnt || 0)
        if (c.src === 'api') apiCalls += cnt
        else if (c.src === 'console') consoleCalls += cnt
        else { webCalls += cnt; uniqueEndUsers += Number(c.end_users || 0) }
      }

      return {
        ok: true,
        appId: row.app_id,
        appName: row.app_name,
        mode: row.mode || 'chat',
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name || '',
        ownerName: row.owner_name || row.owner_email || '',
        enableSite: Boolean(row.enable_site),
        enableApi: Boolean(row.enable_api),
        siteStatus: row.site_status || (row.enable_site ? 'normal' : 'pause'),
        siteCode: row.site_code || '',
        siteUpdatedAt: row.site_updated_at ? new Date(row.site_updated_at).toISOString() : null,
        apiKeys,
        channelStats30d: {apiCalls, webCalls, consoleCalls, uniqueEndUsers},
      }
    } catch (err) {
      return {ok: false, error: err?.message || String(err)}
    } finally {
      await client.end().catch(() => {})
    }
  }

  async function executeDifyAppCutoff({action, appId, keyId}) {
    const client = connectDefaultDifyDb(store)
    if (!client) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED'}
    try {
      await client.connect()
      if (action === 'pause_webapp') {
        const r1 = await client.query(`UPDATE apps SET enable_site = false, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1 RETURNING name`, [appId])
        if (r1.rows.length === 0) return {ok: false, error: 'APP_NOT_FOUND'}
        await client.query(`UPDATE sites SET status = 'pause', updated_at = CURRENT_TIMESTAMP WHERE app_id::text = $1`, [appId])
        return {ok: true, action, appId, appName: r1.rows[0].name, summary: '已暂停该应用的 WebApp / iframe 公开访问，工作台编辑不受影响'}
      }
      if (action === 'resume_webapp') {
        const r1 = await client.query(`UPDATE apps SET enable_site = true, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1 RETURNING name`, [appId])
        if (r1.rows.length === 0) return {ok: false, error: 'APP_NOT_FOUND'}
        await client.query(`UPDATE sites SET status = 'normal', updated_at = CURRENT_TIMESTAMP WHERE app_id::text = $1`, [appId])
        return {ok: true, action, appId, appName: r1.rows[0].name, summary: '已恢复该应用的 WebApp / iframe 公开访问'}
      }
      if (action === 'pause_api') {
        const r1 = await client.query(`UPDATE apps SET enable_api = false, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1 RETURNING name`, [appId])
        if (r1.rows.length === 0) return {ok: false, error: 'APP_NOT_FOUND'}
        return {ok: true, action, appId, appName: r1.rows[0].name, summary: '已暂停该应用的外部 API 通道访问'}
      }
      if (action === 'resume_api') {
        const r1 = await client.query(`UPDATE apps SET enable_api = true, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1 RETURNING name`, [appId])
        if (r1.rows.length === 0) return {ok: false, error: 'APP_NOT_FOUND'}
        return {ok: true, action, appId, appName: r1.rows[0].name, summary: '已恢复该应用的外部 API 通道访问'}
      }
      if (action === 'revoke_api_key') {
        if (!keyId) return {ok: false, error: 'KEY_ID_REQUIRED'}
        const r1 = await client.query(
          `DELETE FROM api_tokens WHERE id::text = $1 AND app_id::text = $2 AND type = 'app' RETURNING token`,
          [keyId, appId],
        )
        if (r1.rows.length === 0) return {ok: false, error: 'KEY_NOT_FOUND'}
        const raw = String(r1.rows[0].token || '')
        const mask = raw.length > 10 ? `${raw.slice(0, 6)}****${raw.slice(-4)}` : 'app-****'
        return {ok: true, action, appId, keyId, tokenMask: mask, summary: `已吊销外部 API 密钥 ${mask}，第三方调用将立即返回 401`}
      }
      return {ok: false, error: 'UNSUPPORTED_ACTION'}
    } catch (err) {
      return {ok: false, error: err?.message || String(err)}
    } finally {
      await client.end().catch(() => {})
    }
  }

  async function scanDifySensitiveAlerts({keywordRules = [], enableDatasetScan = true, enableChatScan = true, enableWebAppScan = true} = {}) {
    const client = connectDefaultDifyDb(store)
    if (!client) return {ok: false, error: 'NO_DIFY_DB_CONFIGURED', findings: []}
    const compiled = (keywordRules || [])
      .filter(r => r && r.enabled !== false && r.pattern)
      .map(r => {
        if (r.matchMode === '正则表达式') {
          try { return {...r, re: new RegExp(r.pattern, 'i')} } catch { return null }
        }
        return {...r, literal: String(r.pattern).toLowerCase()}
      })
      .filter(Boolean)

    const matchText = (text) => {
      if (!text || !compiled.length) return []
      const lower = String(text).toLowerCase()
      const hits = []
      for (const r of compiled) {
        if (r.re ? r.re.test(text) : lower.includes(r.literal)) {
          hits.push({ruleId: r.ruleId, category: r.category, pattern: r.pattern, severity: r.severity})
          if (hits.length >= 5) break
        }
      }
      return hits
    }

    const findings = []
    try {
      await client.connect()

      // A. Scan personal/shared Dify dataset segments for sensitive words (read-only)
      if (enableDatasetScan && compiled.length > 0) {
        const segRes = await client.query(
          `SELECT ds.id::text AS dataset_id, ds.name AS dataset_name, ds.tenant_id::text AS workspace_id,
                  t.name AS workspace_name, ac.name AS owner_name, d.name AS doc_name,
                  LEFT(s.content, 2000) AS snippet, s.updated_at
           FROM document_segments s
           JOIN documents d ON d.id = s.document_id
           JOIN datasets ds ON ds.id = s.dataset_id
           LEFT JOIN tenants t ON t.id = ds.tenant_id
           LEFT JOIN accounts ac ON ac.id = ds.created_by
           WHERE COALESCE(s.enabled, true) = true AND COALESCE(d.archived, false) = false
           ORDER BY s.updated_at DESC NULLS LAST
           LIMIT 400`,
        ).catch(() => ({rows: []}))

        const hitByDataset = new Map()
        for (const r of segRes.rows) {
          const hits = matchText(r.snippet)
          if (!hits.length) continue
          const cur = hitByDataset.get(r.dataset_id) ?? {
            datasetId: r.dataset_id,
            datasetName: r.dataset_name,
            workspaceId: r.workspace_id,
            workspaceName: r.workspace_name || '',
            ownerName: r.owner_name || '',
            docs: new Set(),
            patterns: new Set(),
            count: 0,
            updatedAt: r.updated_at,
          }
          cur.docs.add(r.doc_name || '未命名文档')
          for (const h of hits) cur.patterns.add(h.pattern)
          cur.count += 1
          hitByDataset.set(r.dataset_id, cur)
        }
        for (const item of hitByDataset.values()) {
          findings.push({
            ruleCode: 'PATROL_DATASET_SENSITIVE',
            objectType: '知识库',
            severity: '严重',
            resourceId: item.datasetId,
            resourceName: item.datasetName,
            workspaceId: item.workspaceId,
            workspaceName: item.workspaceName,
            ownerName: item.ownerName,
            facts: `旁路知识库巡检发现工作区「${item.workspaceName || '默认'}」知识库「${item.datasetName}」中有 ${item.count} 个分段命中敏感词规则（命中词：${[...item.patterns].slice(0, 5).join('、')}；涉及文档：${[...item.docs].slice(0, 3).join('、')}）。当前策略为仅告警，未修改原知识库。`,
            detectedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : new Date().toISOString(),
          })
        }
      }

      // B. Scan apps with public WebApp/iframe or external API enabled
      if (enableWebAppScan) {
        const expRes = await client.query(
          `SELECT a.id::text AS app_id, a.name AS app_name, a.mode, a.enable_site, a.enable_api,
                  a.tenant_id::text AS workspace_id, t.name AS workspace_name, ac.name AS owner_name,
                  s.status AS site_status, s.code AS site_code,
                  (SELECT COUNT(*)::int FROM api_tokens k WHERE k.app_id = a.id AND k.type = 'app') AS key_count,
                  (SELECT COUNT(*)::int FROM messages m WHERE m.app_id = a.id AND COALESCE(m.from_source, '') <> 'console' AND m.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days') AS ext_calls_7d
           FROM apps a
           LEFT JOIN tenants t ON t.id = a.tenant_id
           LEFT JOIN accounts ac ON ac.id = a.created_by
           LEFT JOIN sites s ON s.app_id = a.id
           WHERE (a.enable_site = true AND COALESCE(s.status, 'normal') = 'normal') OR a.enable_api = true
           ORDER BY ext_calls_7d DESC, a.updated_at DESC
           LIMIT 200`,
        ).catch(() => ({rows: []}))

        for (const r of expRes.rows) {
          if (Number(r.ext_calls_7d || 0) <= 0 && Number(r.key_count || 0) <= 0) continue
          findings.push({
            ruleCode: 'PATROL_EXTERNAL_EXPOSURE',
            objectType: '智能体',
            severity: Number(r.ext_calls_7d || 0) > 0 ? '严重' : '一般',
            resourceId: r.app_id,
            resourceName: r.app_name,
            workspaceId: r.workspace_id,
            workspaceName: r.workspace_name || '',
            ownerName: r.owner_name || '',
            enableSite: Boolean(r.enable_site && r.site_status !== 'pause'),
            enableApi: Boolean(r.enable_api),
            keyCount: Number(r.key_count || 0),
            extCalls7d: Number(r.ext_calls_7d || 0),
            facts: `检测到应用「${r.app_name}」（工作区：${r.workspace_name || '默认'}）对外开放访问（WebApp 公开：${r.enable_site && r.site_status !== 'pause' ? '已开启' : '未开启'}，API 密钥：${r.key_count} 把，近 7 日外部非控制台调用 ${r.ext_calls_7d} 次）。请核对是否已履行审批备案。`,
            detectedAt: new Date().toISOString(),
          })
        }
      }

      // C. Scan recent external messages (query + answer) for sensitive content leaks
      if (enableChatScan && compiled.length > 0) {
        const msgRes = await client.query(
          `SELECT m.app_id::text AS app_id, a.name AS app_name, a.tenant_id::text AS workspace_id,
                  t.name AS workspace_name, m.from_source, LEFT(COALESCE(m.query, ''), 1000) AS q,
                  LEFT(COALESCE(m.answer, ''), 1500) AS ans, m.created_at
           FROM messages m
           JOIN apps a ON a.id = m.app_id
           LEFT JOIN tenants t ON t.id = a.tenant_id
           WHERE m.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
             AND COALESCE(m.from_source, '') <> 'console'
           ORDER BY m.created_at DESC
           LIMIT 300`,
        ).catch(() => ({rows: []}))

        const hitByApp = new Map()
        for (const r of msgRes.rows) {
          const hits = matchText(`${r.q}\n${r.ans}`)
          if (!hits.length) continue
          const cur = hitByApp.get(r.app_id) ?? {
            appId: r.app_id, appName: r.app_name, workspaceId: r.workspace_id, workspaceName: r.workspace_name || '',
            patterns: new Set(), count: 0, at: r.created_at,
          }
          for (const h of hits) cur.patterns.add(h.pattern)
          cur.count += 1
          hitByApp.set(r.app_id, cur)
        }
        for (const item of hitByApp.values()) {
          findings.push({
            ruleCode: 'PATROL_CHAT_SENSITIVE',
            objectType: '智能体',
            severity: '紧急',
            resourceId: item.appId,
            resourceName: item.appName,
            workspaceId: item.workspaceId,
            workspaceName: item.workspaceName,
            ownerName: '',
            facts: `旁路对话审计发现应用「${item.appName}」近 7 日外部调用中有 ${item.count} 条问答命中敏感词规则（命中词：${[...item.patterns].slice(0, 5).join('、')}）。当前仅生成安全告警，请核查调用来源 IP 与外部系统。`,
            detectedAt: item.at ? new Date(item.at).toISOString() : new Date().toISOString(),
          })
        }
      }

      return {ok: true, scannedAt: new Date().toISOString(), findings}
    } catch (err) {
      return {ok: false, error: err?.message || String(err), findings: []}
    } finally {
      await client.end().catch(() => {})
    }
  }

  return {
    handle: async (req, res, path, actor) => {
      if (path === '/api/subsystems' && req.method === 'GET') {
        const items = store.all().filter(r => !r.deleted).sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name)).map(toPublicView)
        return json(res, {items})
      }
      return handle(req, res, path, actor)
    },
    list: () => store.all().filter(r => !r.deleted).map(toPublicView),
    defaultDify: () => {
      const all = store.all().filter(r => !r.deleted && r.type === 'dify' && r.enabled)
      return all.find(r => r.isDefault) ?? all[0] ?? null
    },
    getDifyInventory: collectDifyInventory,
    setDifyModelEnabled,
    batchUpsertDifyModel,
    batchDeleteDifyModel,
    batchToggleDifyModel,
    getDifyDatasetManifest,
    copyDifyDatasetToWorkspace,
    getDifyAppInsights,
    getDifyHighFreqApps,
    getDifyAppExposure,
    executeDifyAppCutoff,
    scanDifySensitiveAlerts,
    refreshDifyInventory: async () => {
      const enabled = store.all().filter(r => !r.deleted && r.type === 'dify' && r.enabled && r.dbHost && r.dbUser && r.secrets?.dbPassword)
      for (const rec of enabled) {
        try {
          const syncResult = await syncDifySubsystem(rec, directory, inventoryStore)
          store.put(rec.id, {...rec, lastSync: syncResult})
        } catch {}
      }
      return collectDifyInventory()
    },
    close: () => {
      store.close()
      inventoryStore.close()
    },
  }
}
