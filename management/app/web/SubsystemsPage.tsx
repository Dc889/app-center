import {useEffect, useState} from 'react'
import {CheckCircle2, Cpu, Database, Globe, Pencil, Plus, RefreshCw, Search, ServerCog, ShieldCheck, Star, Trash2, Users, Wifi, X, XCircle} from 'lucide-react'
import {PageHeader} from '../../shared-ui/UiContext'

type SubsystemType = 'dify' | 'ragflow' | 'model_gateway' | 'custom'

type TestResult = {
  at?: string
  ok: boolean
  status: number
  latencyMs: number
  message: string
}

type SyncResult = {
  at?: string
  ok: boolean
  totalOwners: number
  created: number
  updated: number
  message: string
}

type SubsystemRecord = {
  id: string
  name: string
  type: SubsystemType
  version: string
  apiBase: string
  workspaceId: string
  consoleEmail: string
  pluginDaemonBase: string
  dbHost?: string
  dbPort?: number
  dbName?: string
  dbUser?: string
  tenantId: string
  externalEndpoint: string
  enabled: boolean
  isDefault: boolean
  notes: string
  hasSecrets: Record<string, boolean>
  secretMasks: Record<string, string>
  lastTest: TestResult | null
  lastSync?: SyncResult | null
  revision: number
  updatedAt: string
}

type FormState = {
  id: string
  name: string
  type: SubsystemType
  version: string
  apiBase: string
  workspaceId: string
  consoleEmail: string
  consoleToken: string
  consolePassword: string
  pluginDaemonBase: string
  pluginDaemonKey: string
  dbHost: string
  dbPort: string
  dbName: string
  dbUser: string
  dbPassword: string
  tenantId: string
  externalEndpoint: string
  apiKey: string
  authToken: string
  enabled: boolean
  isDefault: boolean
  notes: string
}

const TYPE_LABELS: Record<SubsystemType, string> = {
  dify: 'Dify 应用平台',
  ragflow: 'RAGFlow 知识库引擎',
  model_gateway: '模型推理网关',
  custom: '自定义子系统',
}

function TypeIcon({type}: {type: SubsystemType}) {
  if (type === 'dify') return <Cpu size={18} />
  if (type === 'ragflow') return <Database size={18} />
  if (type === 'model_gateway') return <Globe size={18} />
  return <ServerCog size={18} />
}

function emptyForm(type: SubsystemType = 'dify'): FormState {
  return {
    id: '',
    name: '',
    type,
    version: type === 'dify' ? '1.7.1' : type === 'ragflow' ? '0.22.1' : '1.0.0',
    apiBase: '',
    workspaceId: '',
    consoleEmail: '',
    consoleToken: '',
    consolePassword: '',
    pluginDaemonBase: '',
    pluginDaemonKey: '',
    dbHost: type === 'dify' ? 'dify171-db_postgres-1' : '',
    dbPort: '5432',
    dbName: 'dify',
    dbUser: 'postgres',
    dbPassword: '',
    tenantId: '',
    externalEndpoint: '',
    apiKey: '',
    authToken: '',
    enabled: true,
    isDefault: false,
    notes: '',
  }
}

function fromRecord(item: SubsystemRecord): FormState {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    version: item.version || '',
    apiBase: item.apiBase || '',
    workspaceId: item.workspaceId || '',
    consoleEmail: item.consoleEmail || '',
    consoleToken: '',
    consolePassword: '',
    pluginDaemonBase: item.pluginDaemonBase || '',
    pluginDaemonKey: '',
    dbHost: item.dbHost || '',
    dbPort: String(item.dbPort || 5432),
    dbName: item.dbName || 'dify',
    dbUser: item.dbUser || '',
    dbPassword: '',
    tenantId: item.tenantId || '',
    externalEndpoint: item.externalEndpoint || '',
    apiKey: '',
    authToken: '',
    enabled: item.enabled,
    isDefault: item.isDefault,
    notes: item.notes || '',
  }
}

export function SubsystemsPage() {
  const [items, setItems] = useState<SubsystemRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filterType, setFilterType] = useState<'all' | SubsystemType>('all')
  const [keyword, setKeyword] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(() => emptyForm('dify'))
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [draftTest, setDraftTest] = useState<TestResult | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    fetch('/api/subsystems', {signal: controller.signal})
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw Error(data.error?.message ?? '纳管子系统列表读取失败')
        if (!active) return
        setItems(Array.isArray(data.items) ? data.items : [])
        setError('')
      })
      .catch(err => {
        if (active && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : '纳管子系统列表读取失败')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [reloadTick])

  const q = keyword.trim().toLowerCase()
  const filtered = items.filter(i => {
    if (filterType !== 'all' && i.type !== filterType) return false
    if (!q) return true
    return [i.name, i.apiBase, i.version, TYPE_LABELS[i.type]].some(v => (v || '').toLowerCase().includes(q))
  })
  const editingRecord = editingId ? items.find(i => i.id === editingId) ?? null : null
  const editorOpen = creating || Boolean(editingId)

  function startCreate() {
    setCreating(true)
    setEditingId(null)
    setForm(emptyForm(filterType === 'all' ? 'dify' : filterType))
    setDraftTest(null)
    setNotice('')
  }

  function startEdit(item: SubsystemRecord) {
    setCreating(false)
    setEditingId(item.id)
    setForm(fromRecord(item))
    setDraftTest(item.lastTest)
    setNotice('')
  }

  function closeEditor() {
    setCreating(false)
    setEditingId(null)
    setDraftTest(null)
  }

  async function saveForm() {
    if (!form.name.trim() || !form.apiBase.trim()) {
      setNotice('请填写子系统名称与 API 地址')
      return
    }
    if (form.type === 'dify') {
      const hasSavedDbPwd = Boolean(editingRecord?.hasSecrets?.dbPassword)
      if (!form.dbHost.trim() || !form.dbName.trim() || !form.dbUser.trim() || (!form.dbPassword.trim() && !hasSavedDbPwd)) {
        setNotice('配置 Dify 子系统时必须填写数据库主机、库名、只读账号与密码')
        return
      }
    }
    setSaving(true)
    setNotice('')
    try {
      const isNew = creating || !editingId
      const url = isNew ? '/api/subsystems' : `/api/subsystems/${encodeURIComponent(editingId)}`
      const method = isNew ? 'POST' : 'PUT'
      const res = await fetch(url, {
        method,
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw Error(data.error?.message ?? '保存失败')
      const baseMsg = isNew ? `已新增纳管子系统：${data.name}` : `已保存并应用配置：${data.name}`
      const syncMsg = data.syncResult?.message ? `；${data.syncResult.message}` : ''
      setNotice(`${baseMsg}${syncMsg}`)
      setCreating(false)
      setEditingId(data.id)
      setForm(fromRecord(data))
      setReloadTick(t => t + 1)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function syncExisting(item: SubsystemRecord) {
    setSyncingId(item.id)
    setNotice('')
    try {
      const res = await fetch(`/api/subsystems/${encodeURIComponent(item.id)}/sync-accounts`, {method: 'POST'})
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw Error(data.error?.message ?? '同步账号失败')
      setNotice(`${item.name} · ${data.sync?.message ?? '账号更新完成'}`)
      setReloadTick(t => t + 1)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '同步账号失败')
    } finally {
      setSyncingId(null)
    }
  }

  async function testDraft() {
    setTestingId('draft')
    setDraftTest(null)
    try {
      const res = await fetch('/api/subsystems/test', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({...form, id: editingId || undefined}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw Error(data.error?.message ?? '连通性测试失败')
      setDraftTest(data as TestResult)
    } catch (err) {
      setDraftTest({ok: false, status: 0, latencyMs: 0, message: err instanceof Error ? err.message : '测试失败'})
    } finally {
      setTestingId(null)
    }
  }

  async function testExisting(item: SubsystemRecord) {
    setTestingId(item.id)
    setNotice('')
    try {
      const res = await fetch(`/api/subsystems/${encodeURIComponent(item.id)}/test`, {method: 'POST'})
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw Error(data.error?.message ?? '连通性测试失败')
      setNotice(`${item.name} · ${data.test?.message ?? '测试完成'} · ${data.test?.latencyMs ?? 0}ms`)
      setReloadTick(t => t + 1)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '连通性测试失败')
    } finally {
      setTestingId(null)
    }
  }

  async function setAsDefault(item: SubsystemRecord) {
    setNotice('')
    const res = await fetch(`/api/subsystems/${encodeURIComponent(item.id)}/default`, {method: 'POST'})
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(data.error?.message ?? '设置主用失败')
      return
    }
    setNotice(`已将「${item.name}」设为 ${TYPE_LABELS[item.type]} 主用实例并热生效`)
    setReloadTick(t => t + 1)
  }

  async function removeItem(item: SubsystemRecord) {
    setNotice('')
    const res = await fetch(`/api/subsystems/${encodeURIComponent(item.id)}`, {method: 'DELETE'})
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(data.error?.message ?? '移除失败')
      return
    }
    if (editingId === item.id) closeEditor()
    setNotice(`已移除纳管子系统：${item.name}`)
    setReloadTick(t => t + 1)
  }

  return (
    <div className="org-page-stack" data-testid="subsystems-page">
      <div className="org-header-row">
        <PageHeader view="subsystems" />
        <div className="org-row-actions">
          <button type="button" className="app-icon-btn" disabled={loading} onClick={() => setReloadTick(t => t + 1)}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>刷新</span>
          </button>
          <button type="button" className="primary-button" data-testid="add-subsystem-btn" onClick={startCreate}>
            <Plus size={15} /> 新增子系统
          </button>
        </div>
      </div>

      {/* 4 等宽对齐 KPI 指标卡 */}
      <div className="org-kpi-grid" data-testid="subsystems-kpis">
        <div className="org-kpi-card">
          <div className="org-kpi-icon blue"><ServerCog size={18} /></div>
          <div className="org-kpi-meta"><span>已纳管实例</span><strong>{items.length}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon green"><ShieldCheck size={18} /></div>
          <div className="org-kpi-meta"><span>已启用实例</span><strong>{items.filter(i => i.enabled).length}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon amber"><Cpu size={18} /></div>
          <div className="org-kpi-meta"><span>Dify 平台</span><strong>{items.filter(i => i.type === 'dify').length}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon slate"><Database size={18} /></div>
          <div className="org-kpi-meta"><span>RAGFlow 引擎</span><strong>{items.filter(i => i.type === 'ragflow').length}</strong></div>
        </div>
      </div>

      {error && <div className="app-banner danger" role="alert">{error}</div>}
      {notice && <div className="app-banner info" role="status" data-testid="subsystems-notice">{notice}</div>}

      {/* 统一全宽主卡片 */}
      <section className="org-card">
        <div className="org-card-head">
          <div className="org-level-tabs">
            {([
              ['all', '全部', items.length],
              ['dify', 'Dify', items.filter(i => i.type === 'dify').length],
              ['ragflow', 'RAGFlow', items.filter(i => i.type === 'ragflow').length],
              ['model_gateway', '模型网关', items.filter(i => i.type === 'model_gateway').length],
              ['custom', '自定义', items.filter(i => i.type === 'custom').length],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={filterType === key ? 'is-active' : ''}
                onClick={() => setFilterType(key)}
              >
                <span>{label}</span>
                <em>{count}</em>
              </button>
            ))}
          </div>
          <div className="app-list-search org-table-search">
            <Search size={14} />
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜索实例名称、地址或版本" />
          </div>
        </div>

        <div className={`sub-workspace ${editorOpen ? 'has-editor' : ''}`}>
          <div className={`sub-card-grid ${editorOpen ? 'is-compact' : ''}`}>
            {filtered.map(item => (
              <article
                key={item.id}
                className={`sub-card ${editingId === item.id ? 'is-active' : ''}`}
                data-testid={`subsystem-card-${item.id}`}
              >
                <div className="sub-card-head">
                  <div className={`sub-type-icon type-${item.type}`}>
                    <TypeIcon type={item.type} />
                  </div>
                  <div className="sub-card-title">
                    <h4>{item.name}</h4>
                    <div className="sub-card-sub">
                      <span>{TYPE_LABELS[item.type]}</span>
                      <span className="dot">·</span>
                      <span>v{item.version || '1.0'}</span>
                    </div>
                  </div>
                  <span className={`app-status-pill tone-${item.isDefault ? 'progress' : item.enabled ? 'success' : 'muted'}`}>
                    {item.isDefault ? '主用' : item.enabled ? '已启用' : '已停用'}
                  </span>
                </div>

                <dl className="sub-card-kv">
                  <div>
                    <dt>API 地址</dt>
                    <dd><code>{item.apiBase}</code></dd>
                  </div>
                  {item.type === 'dify' && item.workspaceId && (
                    <div>
                      <dt>工作区 ID</dt>
                      <dd><code>{item.workspaceId}</code></dd>
                    </div>
                  )}
                  {item.type === 'ragflow' && item.tenantId && (
                    <div>
                      <dt>租户 ID</dt>
                      <dd><code>{item.tenantId}</code></dd>
                    </div>
                  )}
                  <div>
                    <dt>连通状态</dt>
                    <dd>
                      {item.lastTest ? (
                        <span className={`sub-health ${item.lastTest.ok ? 'ok' : 'bad'}`}>
                          {item.lastTest.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                          <span>{item.lastTest.ok ? '连通正常' : '探活异常'} · {item.lastTest.latencyMs}ms</span>
                        </span>
                      ) : (
                        <span className="org-muted-text">尚未测试</span>
                      )}
                    </dd>
                  </div>
                  {item.type === 'dify' && (
                    <div>
                      <dt>账号同步</dt>
                      <dd>
                        {item.lastSync ? (
                          <span className={`sub-health ${item.lastSync.ok ? 'ok' : 'bad'}`}>
                            {item.lastSync.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            <span>{item.lastSync.ok ? `已同步 ${item.lastSync.totalOwners} 个租户` : '同步失败'}</span>
                          </span>
                        ) : (
                          <span className="org-muted-text">尚未同步</span>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="sub-card-footer">
                  <button type="button" className="app-icon-btn" disabled={testingId === item.id} onClick={() => void testExisting(item)}>
                    <Wifi size={13} />
                    <span>{testingId === item.id ? '测试中' : '测试连接'}</span>
                  </button>
                  {item.type === 'dify' && (
                    <button type="button" className="app-icon-btn" disabled={syncingId === item.id} data-testid={`sync-accounts-${item.id}`} onClick={() => void syncExisting(item)}>
                      <Users size={13} />
                      <span>{syncingId === item.id ? '同步中' : '更新账号'}</span>
                    </button>
                  )}
                  <button type="button" className="app-icon-btn" onClick={() => startEdit(item)}>
                    <Pencil size={13} />
                    <span>编辑</span>
                  </button>
                  {!item.isDefault && (
                    <button type="button" className="app-icon-btn" onClick={() => void setAsDefault(item)}>
                      <Star size={13} />
                      <span>设为主用</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="app-icon-btn sub-del-btn"
                    aria-label={`移除 ${item.name}`}
                    onClick={() => void removeItem(item)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </article>
            ))}

            {filtered.length === 0 && !loading && (
              <div className="app-detail-empty" style={{gridColumn: '1 / -1'}}>
                <ServerCog size={32} strokeWidth={1.5} />
                <h4>暂无匹配的子系统实例</h4>
                <p>点击右上角「新增子系统」接入新的应用平台、知识库引擎或模型网关。</p>
              </div>
            )}
          </div>

          {editorOpen && (
            <aside className="sub-editor-panel" data-testid="subsystem-editor">
              <div className="org-editor-head">
                <div>
                  <h4>{creating ? '新增纳管子系统' : editingRecord?.name ?? editingId}</h4>
                  <span className="org-muted-text" style={{fontSize: 12}}>{TYPE_LABELS[form.type]}</span>
                </div>
                <button type="button" className="app-icon-btn" onClick={closeEditor}><X size={14} /></button>
              </div>

              <div className="sub-editor-form">
                <div className="sub-form-2col">
                  <label className="org-field">
                    <span>子系统类型</span>
                    <select
                      aria-label="子系统类型"
                      value={form.type}
                      disabled={!creating}
                      onChange={e => setForm(f => ({...f, type: e.target.value as SubsystemType}))}
                    >
                      <option value="dify">Dify 应用平台</option>
                      <option value="ragflow">RAGFlow 知识库引擎</option>
                      <option value="model_gateway">模型推理网关</option>
                      <option value="custom">自定义子系统</option>
                    </select>
                  </label>
                  <label className="org-field">
                    <span>适配版本</span>
                    <input
                      aria-label="适配版本"
                      value={form.version}
                      placeholder="1.7.1"
                      onChange={e => setForm(f => ({...f, version: e.target.value}))}
                    />
                  </label>
                </div>

                <label className="org-field">
                  <span>实例名称</span>
                  <input
                    aria-label="实例名称"
                    value={form.name}
                    placeholder="如：生产 Dify 1.14.0 集群"
                    onChange={e => setForm(f => ({...f, name: e.target.value}))}
                  />
                </label>

                <label className="org-field">
                  <span>API 地址</span>
                  <input
                    aria-label="API 地址"
                    value={form.apiBase}
                    placeholder="http://127.0.0.1:8080"
                    onChange={e => setForm(f => ({...f, apiBase: e.target.value}))}
                  />
                </label>

                {form.type === 'dify' && (
                  <>
                    <label className="org-field">
                      <span>默认工作区 ID</span>
                      <input
                        aria-label="默认工作区 ID"
                        value={form.workspaceId}
                        placeholder="Workspace UUID"
                        onChange={e => setForm(f => ({...f, workspaceId: e.target.value}))}
                      />
                    </label>
                    <div className="sub-form-2col">
                      <label className="org-field">
                        <span>管理账号邮箱</span>
                        <input
                          aria-label="Dify 管理账号邮箱"
                          value={form.consoleEmail}
                          placeholder="li.qiang@kpw.com"
                          onChange={e => setForm(f => ({...f, consoleEmail: e.target.value}))}
                        />
                      </label>
                      <label className="org-field">
                        <span>管理密码 {editingRecord?.hasSecrets?.consolePassword && <em className="sub-secret-tag">已加密</em>}</span>
                        <input
                          aria-label="Dify 管理密码"
                          type="password"
                          value={form.consolePassword}
                          placeholder={editingRecord?.hasSecrets?.consolePassword ? '留空保持不变' : '输入密码'}
                          onChange={e => setForm(f => ({...f, consolePassword: e.target.value}))}
                        />
                      </label>
                    </div>
                    <label className="org-field">
                      <span>Console Token {editingRecord?.hasSecrets?.consoleToken && <em className="sub-secret-tag">{editingRecord.secretMasks.consoleToken}</em>}</span>
                      <input
                        aria-label="Dify Console Token"
                        type="password"
                        value={form.consoleToken}
                        placeholder={editingRecord?.hasSecrets?.consoleToken ? '留空保持不变' : '留空时自动用邮箱密码换取'}
                        onChange={e => setForm(f => ({...f, consoleToken: e.target.value}))}
                      />
                    </label>
                    <div className="sub-form-2col">
                      <label className="org-field">
                        <span>Plugin Daemon 地址</span>
                        <input
                          aria-label="Plugin Daemon 地址"
                          value={form.pluginDaemonBase}
                          placeholder="http://127.0.0.1:5002"
                          onChange={e => setForm(f => ({...f, pluginDaemonBase: e.target.value}))}
                        />
                      </label>
                      <label className="org-field">
                        <span>Plugin Daemon Key</span>
                        <input
                          aria-label="Plugin Daemon Key"
                          type="password"
                          value={form.pluginDaemonKey}
                          placeholder={editingRecord?.hasSecrets?.pluginDaemonKey ? '留空保持不变' : '选填'}
                          onChange={e => setForm(f => ({...f, pluginDaemonKey: e.target.value}))}
                        />
                      </label>
                    </div>
                    <div style={{marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border-subtle, #e2e8f0)'}}>
                      <div style={{fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 8}}>
                        Dify 数据库只读连接（必填，保存后自动同步租户账号）
                      </div>
                      <div className="sub-form-2col">
                        <label className="org-field">
                          <span>数据库主机 *</span>
                          <input
                            aria-label="Dify 数据库主机"
                            value={form.dbHost}
                            placeholder="dify171-db_postgres-1"
                            onChange={e => setForm(f => ({...f, dbHost: e.target.value}))}
                          />
                        </label>
                        <label className="org-field">
                          <span>端口 *</span>
                          <input
                            aria-label="Dify 数据库端口"
                            value={form.dbPort}
                            placeholder="5432"
                            onChange={e => setForm(f => ({...f, dbPort: e.target.value}))}
                          />
                        </label>
                      </div>
                      <label className="org-field" style={{marginTop: 8}}>
                        <span>数据库名称 *</span>
                        <input
                          aria-label="Dify 数据库名称"
                          value={form.dbName}
                          placeholder="dify"
                          onChange={e => setForm(f => ({...f, dbName: e.target.value}))}
                        />
                      </label>
                      <div className="sub-form-2col" style={{marginTop: 8}}>
                        <label className="org-field">
                          <span>数据库账号 *</span>
                          <input
                            aria-label="Dify 数据库账号"
                            value={form.dbUser}
                            placeholder="postgres"
                            onChange={e => setForm(f => ({...f, dbUser: e.target.value}))}
                          />
                        </label>
                        <label className="org-field">
                          <span>数据库密码 * {editingRecord?.hasSecrets?.dbPassword && <em className="sub-secret-tag">已加密</em>}</span>
                          <input
                            aria-label="Dify 数据库密码"
                            type="password"
                            value={form.dbPassword}
                            placeholder={editingRecord?.hasSecrets?.dbPassword ? '留空保持不变' : '输入只读数据库密码'}
                            onChange={e => setForm(f => ({...f, dbPassword: e.target.value}))}
                          />
                        </label>
                      </div>
                    </div>
                  </>
                )}

                {form.type === 'ragflow' && (
                  <>
                    <div className="sub-form-2col">
                      <label className="org-field">
                        <span>默认租户 ID</span>
                        <input
                          aria-label="默认租户 ID"
                          value={form.tenantId}
                          placeholder="Tenant ID"
                          onChange={e => setForm(f => ({...f, tenantId: e.target.value}))}
                        />
                      </label>
                      <label className="org-field">
                        <span>API Key {editingRecord?.hasSecrets?.apiKey && <em className="sub-secret-tag">{editingRecord.secretMasks.apiKey}</em>}</span>
                        <input
                          aria-label="RAGFlow API Key"
                          type="password"
                          value={form.apiKey}
                          placeholder={editingRecord?.hasSecrets?.apiKey ? '留空保持不变' : 'ragflow-xxx'}
                          onChange={e => setForm(f => ({...f, apiKey: e.target.value}))}
                        />
                      </label>
                    </div>
                    <label className="org-field">
                      <span>外部知识库接入地址</span>
                      <input
                        aria-label="外部知识库接入地址"
                        value={form.externalEndpoint}
                        placeholder="http://127.0.0.1:9380/api/v1/dify"
                        onChange={e => setForm(f => ({...f, externalEndpoint: e.target.value}))}
                      />
                    </label>
                  </>
                )}

                {(form.type === 'model_gateway' || form.type === 'custom') && (
                  <label className="org-field">
                    <span>访问令牌</span>
                    <input
                      aria-label="访问令牌"
                      type="password"
                      value={form.authToken}
                      placeholder={editingRecord?.hasSecrets?.authToken ? '留空保持不变' : '选填'}
                      onChange={e => setForm(f => ({...f, authToken: e.target.value}))}
                    />
                  </label>
                )}

                <label className="org-field">
                  <span>备注说明</span>
                  <textarea
                    aria-label="备注说明"
                    rows={2}
                    className="sub-textarea"
                    value={form.notes}
                    placeholder="环境用途、网络分区或负责人说明"
                    onChange={e => setForm(f => ({...f, notes: e.target.value}))}
                  />
                </label>

                <div className="sub-check-row">
                  <label className="sub-check-item">
                    <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({...f, enabled: e.target.checked}))} />
                    <span>启用该实例</span>
                  </label>
                  <label className="sub-check-item">
                    <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({...f, isDefault: e.target.checked}))} />
                    <span>设为同类型主用实例</span>
                  </label>
                </div>

                {draftTest && (
                  <div role="status" data-testid="subsystem-test-result" className={`app-banner ${draftTest.ok ? 'info' : 'danger'}`}>
                    {draftTest.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                    <span>{draftTest.message} · {draftTest.latencyMs}ms</span>
                  </div>
                )}

                <div className="sub-editor-footer">
                  <button type="button" className="secondary-button" disabled={testingId === 'draft'} onClick={() => void testDraft()}>
                    <Wifi size={14} /> {testingId === 'draft' ? '测试中...' : '测试连接'}
                  </button>
                  <button type="button" className="primary-button" disabled={saving} onClick={() => void saveForm()}>
                    {saving ? '保存中...' : '保存并生效'}
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
      </section>
    </div>
  )
}
