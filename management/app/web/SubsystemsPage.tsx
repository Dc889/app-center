import {useEffect, useState} from 'react'
import {CheckCircle2, Plus, RefreshCw, ServerCog, ShieldCheck, Star, Trash2, Wifi, XCircle} from 'lucide-react'
import {PageHeader} from '../../shared-ui/UiContext'

type SubsystemType = 'dify' | 'ragflow' | 'model_gateway' | 'custom'

type TestResult = {
  at?: string
  ok: boolean
  status: number
  latencyMs: number
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
  tenantId: string
  externalEndpoint: string
  enabled: boolean
  isDefault: boolean
  notes: string
  hasSecrets: Record<string, boolean>
  secretMasks: Record<string, string>
  lastTest: TestResult | null
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(() => emptyForm('dify'))
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
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

  const filtered = filterType === 'all' ? items : items.filter(i => i.type === filterType)
  const editingRecord = editingId ? items.find(i => i.id === editingId) ?? null : null

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
      setNotice(isNew ? `已新增纳管子系统：${data.name}` : `已保存并应用配置：${data.name}`)
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
      setNotice(`${item.name}：${data.test?.message ?? '测试完成'} (${data.test?.latencyMs ?? 0}ms)`)
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
    <div data-testid="subsystems-page">
      <PageHeader view="subsystems" />

      <div className="warehouse-top-bar">
        <div className="warehouse-kpi-strip" data-testid="subsystems-kpis">
          <div className="warehouse-kpi-pill">
            <ServerCog size={15} />
            <span>已纳管实例</span>
            <strong>{items.length}</strong>
          </div>
          <div className="warehouse-kpi-pill">
            <ShieldCheck size={15} />
            <span>已启用</span>
            <strong>{items.filter(i => i.enabled).length}</strong>
          </div>
          <div className="warehouse-kpi-pill">
            <span>Dify</span>
            <strong>{items.filter(i => i.type === 'dify').length}</strong>
          </div>
          <div className="warehouse-kpi-pill">
            <span>RAGFlow</span>
            <strong>{items.filter(i => i.type === 'ragflow').length}</strong>
          </div>
        </div>
        <div className="warehouse-actions">
          <div className="usable-switch">
            {([
              ['all', '全部'],
              ['dify', 'Dify'],
              ['ragflow', 'RAGFlow'],
              ['model_gateway', '模型网关'],
              ['custom', '自定义'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filterType === key ? 'active' : ''}
                onClick={() => setFilterType(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="secondary-button" disabled={loading} onClick={() => setReloadTick(t => t + 1)}>
            <RefreshCw size={14} /> 刷新
          </button>
          <button type="button" className="primary-button" data-testid="add-subsystem-btn" onClick={startCreate}>
            <Plus size={15} /> 新增子系统
          </button>
        </div>
      </div>

      {error && <p role="alert" className="login-error">{error}</p>}
      {notice && <p role="status" data-testid="subsystems-notice">{notice}</p>}

      <div className="warehouse-layout">
        <div className="agent-grid">
          {filtered.map(item => (
            <article
              key={item.id}
              className={'agent-card' + (editingId === item.id ? ' active' : '')}
              data-testid={`subsystem-card-${item.id}`}
            >
              <div className="agent-card-top">
                <ServerCog size={16} />
                <div>
                  <strong>{item.name}</strong>
                  <small>{TYPE_LABELS[item.type]} · {item.version || '未标版本'}</small>
                </div>
                <em>{item.isDefault ? '主用' : item.enabled ? '已启用' : '已停用'}</em>
              </div>
              <p className="version-meta">{item.apiBase}</p>
              {item.type === 'dify' && item.workspaceId && <p className="version-meta">工作区：{item.workspaceId}</p>}
              {item.type === 'ragflow' && item.tenantId && <p className="version-meta">租户：{item.tenantId}</p>}
              {item.lastTest && (
                <p className="version-meta" style={{color: item.lastTest.ok ? '#067647' : '#b42318'}}>
                  {item.lastTest.ok ? '● 连通正常' : '● 探活异常'} · {item.lastTest.message} ({item.lastTest.latencyMs}ms)
                </p>
              )}
              <div className="draft-toolbar" style={{marginTop: 10}}>
                <button type="button" className="secondary-button" disabled={testingId === item.id} onClick={() => void testExisting(item)}>
                  <Wifi size={14} /> {testingId === item.id ? '测试中...' : '测试连接'}
                </button>
                <button type="button" className="secondary-button" onClick={() => startEdit(item)}>
                  编辑
                </button>
                {!item.isDefault && (
                  <button type="button" className="secondary-button" onClick={() => void setAsDefault(item)}>
                    <Star size={14} /> 设为主用
                  </button>
                )}
                <button type="button" className="secondary-button" aria-label={`移除 ${item.name}`} onClick={() => void removeItem(item)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
          {filtered.length === 0 && !loading && (
            <div className="agent-empty">暂无该类型的纳管子系统，点击右上角「新增子系统」接入。</div>
          )}
        </div>

        {(creating || editingId) && (
          <aside className="panel" data-testid="subsystem-editor">
            <div className="panel-header" style={{marginBottom: 12}}>
              <h3>{creating ? '新增纳管子系统' : `编辑：${editingRecord?.name ?? editingId}`}</h3>
              <button type="button" className="secondary-button" onClick={closeEditor}>关闭</button>
            </div>

            <div className="form-section" style={{display: 'grid', gap: 12}}>
              <label>
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

              <label>
                <span>实例名称</span>
                <input
                  aria-label="实例名称"
                  value={form.name}
                  placeholder="例如：生产 Dify 1.14.0 集群"
                  onChange={e => setForm(f => ({...f, name: e.target.value}))}
                />
              </label>

              <div className="form-row">
                <label>
                  <span>适配版本</span>
                  <input
                    aria-label="适配版本"
                    value={form.version}
                    placeholder="如 1.7.1 / 0.22.1"
                    onChange={e => setForm(f => ({...f, version: e.target.value}))}
                  />
                </label>
                <label>
                  <span>API 地址</span>
                  <input
                    aria-label="API 地址"
                    value={form.apiBase}
                    placeholder="http://127.0.0.1:8080"
                    onChange={e => setForm(f => ({...f, apiBase: e.target.value}))}
                  />
                </label>
              </div>

              {form.type === 'dify' && (
                <>
                  <label>
                    <span>默认工作区 ID（Workspace ID）</span>
                    <input
                      aria-label="默认工作区 ID"
                      value={form.workspaceId}
                      placeholder="UUID"
                      onChange={e => setForm(f => ({...f, workspaceId: e.target.value}))}
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      <span>管理账号邮箱</span>
                      <input
                        aria-label="Dify 管理账号邮箱"
                        value={form.consoleEmail}
                        placeholder="li.qiang@kpw.com"
                        onChange={e => setForm(f => ({...f, consoleEmail: e.target.value}))}
                      />
                    </label>
                    <label>
                      <span>管理密码 {editingRecord?.hasSecrets?.consolePassword ? '（已加密保存，留空不变）' : ''}</span>
                      <input
                        aria-label="Dify 管理密码"
                        type="password"
                        value={form.consolePassword}
                        placeholder={editingRecord?.hasSecrets?.consolePassword ? '已配置，留空保持不变' : '输入密码'}
                        onChange={e => setForm(f => ({...f, consolePassword: e.target.value}))}
                      />
                    </label>
                  </div>
                  <label>
                    <span>Console Token {editingRecord?.hasSecrets?.consoleToken ? `（${editingRecord.secretMasks.consoleToken}）` : ''}</span>
                    <input
                      aria-label="Dify Console Token"
                      type="password"
                      value={form.consoleToken}
                      placeholder={editingRecord?.hasSecrets?.consoleToken ? '留空保持原 Token 不变' : '可选，留空时自动用邮箱密码换取'}
                      onChange={e => setForm(f => ({...f, consoleToken: e.target.value}))}
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      <span>Plugin Daemon 地址</span>
                      <input
                        aria-label="Plugin Daemon 地址"
                        value={form.pluginDaemonBase}
                        placeholder="http://127.0.0.1:5002"
                        onChange={e => setForm(f => ({...f, pluginDaemonBase: e.target.value}))}
                      />
                    </label>
                    <label>
                      <span>Plugin Daemon Key</span>
                      <input
                        aria-label="Plugin Daemon Key"
                        type="password"
                        value={form.pluginDaemonKey}
                        placeholder={editingRecord?.hasSecrets?.pluginDaemonKey ? '留空保持不变' : '可选'}
                        onChange={e => setForm(f => ({...f, pluginDaemonKey: e.target.value}))}
                      />
                    </label>
                  </div>
                </>
              )}

              {form.type === 'ragflow' && (
                <>
                  <div className="form-row">
                    <label>
                      <span>默认租户 ID（Tenant ID）</span>
                      <input
                        aria-label="默认租户 ID"
                        value={form.tenantId}
                        placeholder="RAGFlow Tenant ID"
                        onChange={e => setForm(f => ({...f, tenantId: e.target.value}))}
                      />
                    </label>
                    <label>
                      <span>API Key {editingRecord?.hasSecrets?.apiKey ? `（${editingRecord.secretMasks.apiKey}）` : ''}</span>
                      <input
                        aria-label="RAGFlow API Key"
                        type="password"
                        value={form.apiKey}
                        placeholder={editingRecord?.hasSecrets?.apiKey ? '留空保持原 Key 不变' : 'ragflow-xxx'}
                        onChange={e => setForm(f => ({...f, apiKey: e.target.value}))}
                      />
                    </label>
                  </div>
                  <label>
                    <span>外部知识库接入地址（供 Dify 回调）</span>
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
                <label>
                  <span>访问令牌（Bearer Token）</span>
                  <input
                    aria-label="访问令牌"
                    type="password"
                    value={form.authToken}
                    placeholder={editingRecord?.hasSecrets?.authToken ? '留空保持不变' : '可选'}
                    onChange={e => setForm(f => ({...f, authToken: e.target.value}))}
                  />
                </label>
              )}

              <label>
                <span>备注说明</span>
                <textarea
                  aria-label="备注说明"
                  rows={2}
                  value={form.notes}
                  placeholder="环境用途、网络分区或负责人说明"
                  onChange={e => setForm(f => ({...f, notes: e.target.value}))}
                />
              </label>

              <div className="draft-toolbar">
                <label style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
                  <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({...f, enabled: e.target.checked}))} />
                  <span>启用该实例</span>
                </label>
                <label style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
                  <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({...f, isDefault: e.target.checked}))} />
                  <span>设为同类型主用实例（保存后立即热生效）</span>
                </label>
              </div>

              {draftTest && (
                <div
                  role="status"
                  data-testid="subsystem-test-result"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    background: draftTest.ok ? '#ecfdf3' : '#fef3f2',
                    color: draftTest.ok ? '#067647' : '#b42318',
                  }}
                >
                  {draftTest.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  <span>{draftTest.message} ({draftTest.latencyMs}ms)</span>
                </div>
              )}

              <div className="draft-toolbar">
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
    </div>
  )
}
