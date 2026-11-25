import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto'
import pg from 'pg'
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

async function probeSubsystem(spec) {
  const started = Date.now()
  const base = normalizeUrl(spec.apiBase)
  if (!base) return {ok: false, status: 0, latencyMs: 0, message: '未填写 API 地址'}

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
          return {
            ok: false,
            status: loginRes.status,
            latencyMs: Date.now() - started,
            message: `Dify 登录鉴权失败 (HTTP ${loginRes.status})`,
          }
        }
      }
      const probeUrl = token ? `${base}/console/api/workspaces/current` : `${base}/console/api/setup`
      const res = await fetch(probeUrl, {
        headers: token ? {authorization: `Bearer ${token}`} : {},
        signal: AbortSignal.timeout(8000),
      })
      const latencyMs = Date.now() - started
      if (res.ok) {
        const payload = await res.json().catch(() => null)
        const wsName = payload?.name ? `（工作区：${payload.name}）` : ''
        return {
          ok: true,
          status: res.status,
          latencyMs,
          message: token ? `Dify 鉴权连通正常${wsName}` : 'Dify 端点可达（未配置鉴权凭据）',
        }
      }
      return {ok: false, status: res.status, latencyMs, message: `Dify 响应异常 (HTTP ${res.status})`}
    }

    if (spec.type === 'ragflow') {
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
    }

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
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      message: `连接失败：${err instanceof Error ? err.message : '网络不可达或超时'}`,
    }
  }
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
