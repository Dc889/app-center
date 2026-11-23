import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto'
import {body, check, id, json, ledger} from '../../../runtime/http.mjs'

const ALLOWED_TYPES = ['dify', 'ragflow', 'model_gateway', 'custom']
const SECRET_FIELDS = ['consoleToken', 'consolePassword', 'pluginDaemonKey', 'apiKey', 'authToken']

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
    secretMasks[field] = field === 'consolePassword' ? (plain ? '********' : '') : maskSecret(plain)
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

export function subsystemRegistry(dir, actorSnapshot) {
  const store = ledger(dir, 'managed-subsystems', actorSnapshot)

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
        tenantId: '',
        externalEndpoint: '',
        enabled: true,
        isDefault: true,
        notes: '由启动环境变量自动导入',
        secrets: {
          consoleToken: encryptSecret(process.env.DIFY_CONSOLE_TOKEN || ''),
          consolePassword: encryptSecret(process.env.DIFY_CONSOLE_PASSWORD || ''),
          pluginDaemonKey: encryptSecret(process.env.DIFY_PLUGIN_DAEMON_KEY || ''),
        },
        lastTest: null,
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
        tenantId: String(input.tenantId ?? '').trim().slice(0, 128),
        externalEndpoint: input.externalEndpoint ? normalizeUrl(input.externalEndpoint) : '',
        enabled: input.enabled !== false,
        isDefault,
        notes: String(input.notes ?? '').trim().slice(0, 500),
        secrets,
        lastTest: null,
        revision: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        history: [{at: nowIso, actor, action: `新增纳管子系统 ${input.name.trim()}`}],
      }
      if (isDefault) clearOtherDefaults(record.type, record.id)
      const saved = store.put(record.id, record)
      applyDefaultToEnv(saved)
      return json(res, toPublicView(saved), 201)
    }

    const itemMatch = /^\/api\/subsystems\/([a-zA-Z0-9_-]+)(?:\/(test|default))?$/.exec(path)
    check(itemMatch, 404, 'NOT_FOUND')
    const [, targetId, action] = itemMatch
    const existing = store.get(targetId)
    check(existing, 404, 'NOT_FOUND', '子系统实例不存在')

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
      const nextDefault = typeof input.isDefault === 'boolean' ? input.isDefault : existing.isDefault
      if (nextDefault) clearOtherDefaults(existing.type, existing.id)
      const updated = store.put(existing.id, {
        ...existing,
        name: input.name.trim(),
        version: String(input.version ?? existing.version ?? '').trim().slice(0, 64),
        apiBase,
        workspaceId: String(input.workspaceId ?? existing.workspaceId ?? '').trim().slice(0, 128),
        consoleEmail: String(input.consoleEmail ?? existing.consoleEmail ?? '').trim().slice(0, 128),
        pluginDaemonBase: input.pluginDaemonBase !== undefined ? (input.pluginDaemonBase ? normalizeUrl(input.pluginDaemonBase) : '') : (existing.pluginDaemonBase ?? ''),
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
      return json(res, toPublicView(updated))
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

  return {
    handle: async (req, res, path, actor) => {
      if (path === '/api/subsystems' && req.method === 'GET') {
        const items = store.all().filter(r => !r.deleted).sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name)).map(toPublicView)
        return json(res, {items})
      }
      return handle(req, res, path, actor)
    },
    list: () => store.all().filter(r => !r.deleted).map(toPublicView),
    close: store.close,
  }
}
