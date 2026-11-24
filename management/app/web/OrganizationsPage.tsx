import {useEffect, useState} from 'react'
import {Building2, Check, Layers, Pencil, Plus, RefreshCw, Search, Tag, X} from 'lucide-react'
import {PageHeader} from '../../shared-ui/UiContext'

type OrgItem = {
  orgId: string
  level: number
  code: string
  placeholderKey: string
  name: string
  parentId: string
  externalCode: string
  aliases: string[]
  enabled: boolean
  revision: number
}

type ConfigTicket = {
  ticketNo: string
  ticketType: string
  account: string
  reason: string
  payload: Record<string, unknown>
  status: string
  createdAt: string
}

const LEVEL_NAMES: Record<number, string> = {
  1: '一级机构',
  2: '二级机构',
  3: '三级机构',
  4: '四级机构',
  5: '五级机构',
  6: '六级机构',
}

export function OrganizationsPage() {
  const [items, setItems] = useState<OrgItem[]>([])
  const [tickets, setTickets] = useState<ConfigTicket[]>([])
  const [levelTab, setLevelTab] = useState<'all' | number>('all')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)

  // Create organization
  const [createMode, setCreateMode] = useState<'named' | 'placeholder'>('named')
  const [batchLevel, setBatchLevel] = useState(1)
  const [batchCount, setBatchCount] = useState(5)
  const [batchParentId, setBatchParentId] = useState('')
  const [newNames, setNewNames] = useState('')
  const [newExtCode, setNewExtCode] = useState('')
  const [batchReason, setBatchReason] = useState('')

  // Single edit panel
  const [editing, setEditing] = useState<OrgItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editParentId, setEditParentId] = useState('')
  const [editExtCode, setEditExtCode] = useState('')
  const [editReason, setEditReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([
      fetch('/api/organizations').then(r => r.json()),
      fetch('/api/config-tickets?ticketType=CFG-01').then(r => r.json()),
    ])
      .then(([orgData, tData]) => {
        if (!active) return
        setItems(Array.isArray(orgData.items) ? orgData.items : [])
        setTickets(Array.isArray(tData.items) ? tData.items : [])
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])

  const q = keyword.trim().toLowerCase()
  const filtered = items.filter(i => {
    if (levelTab !== 'all' && i.level !== levelTab) return false
    if (!q) return true
    return [i.code, i.placeholderKey, i.name, i.externalCode].some(v => (v || '').toLowerCase().includes(q))
  })

  const orgNameOf = (id: string) => {
    const found = items.find(i => i.orgId === id)
    return found ? `${found.code} · ${found.name || found.placeholderKey}` : '—'
  }

  async function submitCreate() {
    const parsedNames = newNames.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    if (createMode === 'named' && parsedNames.length === 0) {
      setNotice('请输入组织机构名称')
      return
    }
    const reason = batchReason.trim() || (createMode === 'named' ? `新增${LEVEL_NAMES[batchLevel]}：${parsedNames.join('、')}` : `批量生成${LEVEL_NAMES[batchLevel]}占位 ${batchCount} 个`)
    setBusy(true)
    try {
      const payload =
        createMode === 'named' && parsedNames.length === 1
          ? {
              operation: '新增机构',
              level: batchLevel,
              name: parsedNames[0],
              parentId: batchLevel > 1 ? batchParentId : '',
              externalCode: newExtCode.trim(),
            }
          : {
              operation: '批量初始化占位',
              level: batchLevel,
              batchCount: createMode === 'named' ? parsedNames.length : batchCount,
              names: createMode === 'named' ? parsedNames : [],
              parentId: batchLevel > 1 ? batchParentId : '',
            }
      const res = await fetch('/api/config-tickets', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ticketType: 'CFG-01', reason, payload}),
      })
      const data = await res.json()
      if (!res.ok) throw Error(data.error?.message ?? '提交失败')
      setNotice(`已提交变更单 ${data.ticketNo}，请在下方审批记录中批准生效`)
      setNewNames('')
      setNewExtCode('')
      setBatchReason('')
      setReload(v => v + 1)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  async function submitEdit() {
    if (!editing || !editReason.trim()) { setNotice('请填写变更原因'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/config-tickets', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ticketType: 'CFG-01',
          reason: editReason.trim(),
          payload: {
            operation: '修改名称或映射',
            orgId: editing.orgId,
            name: editName.trim(),
            parentId: editing.level > 1 ? editParentId : '',
            externalCode: editExtCode.trim(),
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw Error(data.error?.message ?? '提交失败')
      setNotice(`已提交变更单 ${data.ticketNo}，批准后自动生效`)
      setEditing(null)
      setEditReason('')
      setReload(v => v + 1)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  async function reviewTicket(ticketNo: string, action: '批准' | '驳回') {
    setBusy(true)
    try {
      const res = await fetch('/api/config-tickets/transition', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ticketNo, action, note: action === '批准' ? '审核通过并生效' : '驳回'}),
      })
      const data = await res.json()
      if (!res.ok) throw Error(data.error?.message ?? '审批失败')
      setNotice(`${ticketNo} 已${action}`)
      setReload(v => v + 1)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '审批失败')
    } finally {
      setBusy(false)
    }
  }

  const namedCount = items.filter(i => i.name).length
  const unnamedCount = items.length - namedCount
  const pendingTicketCount = tickets.filter(t => t.status === '待受理').length

  return (
    <div className="org-page-stack" data-testid="organizations-page">
      <div className="org-header-row">
        <PageHeader view="organizations" />
        <button type="button" className="app-icon-btn" disabled={loading} onClick={() => setReload(v => v + 1)}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          <span>刷新数据</span>
        </button>
      </div>

      {/* 4 等宽对齐 KPI 指标卡 */}
      <div className="org-kpi-grid">
        <div className="org-kpi-card">
          <div className="org-kpi-icon blue"><Building2 size={18} /></div>
          <div className="org-kpi-meta"><span>总机构数</span><strong>{items.length}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon green"><Layers size={18} /></div>
          <div className="org-kpi-meta"><span>已正式命名</span><strong>{namedCount}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon amber"><Tag size={18} /></div>
          <div className="org-kpi-meta"><span>待命名占位</span><strong>{unnamedCount}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon slate"><Check size={18} /></div>
          <div className="org-kpi-meta"><span>待审批变更</span><strong>{pendingTicketCount}</strong></div>
        </div>
      </div>

      {notice && <div className="app-banner info" role="status" data-testid="org-notice">{notice}</div>}

      {/* 卡片 1：新增组织机构 */}
      <section className="org-card">
        <div className="org-card-head">
          <h3>新增组织机构</h3>
          <div className="org-seg-switch">
            <button type="button" className={createMode === 'named' ? 'is-active' : ''} onClick={() => setCreateMode('named')}>直接命名新增</button>
            <button type="button" className={createMode === 'placeholder' ? 'is-active' : ''} onClick={() => setCreateMode('placeholder')}>按数量生成占位</button>
          </div>
        </div>

        <div className={`org-create-grid ${batchLevel > 1 ? 'has-parent' : ''} ${createMode === 'placeholder' ? 'is-placeholder' : ''}`}>
          <label className="org-field">
            <span>机构层级</span>
            <select value={batchLevel} onChange={e => setBatchLevel(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map(l => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
            </select>
          </label>

          {batchLevel > 1 && (
            <label className="org-field">
              <span>上级机构</span>
              <select value={batchParentId} onChange={e => setBatchParentId(e.target.value)}>
                <option value="">请选择上级机构</option>
                {items.filter(i => i.level === batchLevel - 1).map(p => (
                  <option key={p.orgId} value={p.orgId}>{p.code} · {p.name || p.placeholderKey}</option>
                ))}
              </select>
            </label>
          )}

          {createMode === 'named' ? (
            <>
              <label className="org-field org-field-wide">
                <span>机构名称</span>
                <input
                  placeholder="输入名称，多个机构可用逗号分隔"
                  value={newNames}
                  onChange={e => setNewNames(e.target.value)}
                />
              </label>
              <label className="org-field">
                <span>外部编码</span>
                <input
                  placeholder="选填"
                  value={newExtCode}
                  onChange={e => setNewExtCode(e.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="org-field">
              <span>新增数量</span>
              <input type="number" min={1} max={50} value={batchCount} onChange={e => setBatchCount(Number(e.target.value))} />
            </label>
          )}

          <label className="org-field org-field-wide">
            <span>变更原因</span>
            <input
              placeholder="留空自动生成"
              value={batchReason}
              onChange={e => setBatchReason(e.target.value)}
            />
          </label>

          <div className="org-field org-field-action">
            <span aria-hidden="true">&nbsp;</span>
            <button type="button" className="primary-button" disabled={busy} onClick={() => void submitCreate()}>
              <Plus size={15} /> {createMode === 'named' ? '新增机构' : '生成占位'}
            </button>
          </div>
        </div>
      </section>

      {/* 卡片 2：组织机构目录列表 */}
      <section className="org-card">
        <div className="org-card-head">
          <div className="org-level-tabs">
            <button type="button" className={levelTab === 'all' ? 'is-active' : ''} onClick={() => setLevelTab('all')}>
              <span>全部</span><em>{items.length}</em>
            </button>
            {[1, 2, 3, 4, 5, 6].map(l => (
              <button key={l} type="button" className={levelTab === l ? 'is-active' : ''} onClick={() => setLevelTab(l)}>
                <span>{LEVEL_NAMES[l].slice(0, 2)}</span><em>{items.filter(i => i.level === l).length}</em>
              </button>
            ))}
          </div>
          <div className="app-list-search org-table-search">
            <Search size={14} />
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜索机构名称、序号或编码" />
          </div>
        </div>

        <div className={`org-table-split ${editing ? 'has-editor' : ''}`}>
          <div className="org-table-wrap">
            <table className="org-table">
              <thead>
                <tr>
                  <th>层级</th>
                  <th>序号</th>
                  <th>占位标识</th>
                  <th>机构名称</th>
                  <th>上级机构</th>
                  <th>外部编码</th>
                  <th>状态</th>
                  <th style={{textAlign: 'right'}}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.orgId} className={editing?.orgId === item.orgId ? 'is-selected' : ''}>
                    <td><span className="app-type-tag">{LEVEL_NAMES[item.level] || `${item.level}级`}</span></td>
                    <td><strong>{item.code}</strong></td>
                    <td><code className="org-code-chip">{item.placeholderKey}</code></td>
                    <td>{item.name ? <strong>{item.name}</strong> : <span className="org-muted-text">待命名</span>}</td>
                    <td className="org-muted-cell">{item.parentId ? orgNameOf(item.parentId) : '根级'}</td>
                    <td className="org-muted-cell">{item.externalCode || '—'}</td>
                    <td><span className={`app-status-pill tone-${item.enabled ? 'success' : 'muted'}`}>{item.enabled ? '启用' : '停用'}</span></td>
                    <td style={{textAlign: 'right'}}>
                      <button
                        type="button"
                        className="app-icon-btn"
                        onClick={() => {
                          setEditing(item)
                          setEditName(item.name)
                          setEditParentId(item.parentId)
                          setEditExtCode(item.externalCode)
                          setEditReason('')
                        }}
                      >
                        <Pencil size={13} />
                        <span>编辑</span>
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="org-empty-cell">当前筛选条件下暂无组织机构</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {editing && (
            <aside className="org-editor-drawer" data-testid="org-editor">
              <div className="org-editor-head">
                <div>
                  <h4>编辑机构 · {editing.code}</h4>
                  <code className="org-code-chip">{editing.placeholderKey}</code>
                </div>
                <button type="button" className="app-icon-btn" onClick={() => setEditing(null)}><X size={14} /></button>
              </div>
              <div className="org-editor-body">
                <label className="org-field">
                  <span>机构名称</span>
                  <input value={editName} placeholder="输入正式机构名称" onChange={e => setEditName(e.target.value)} />
                </label>
                {editing.level > 1 && (
                  <label className="org-field">
                    <span>上级机构</span>
                    <select value={editParentId} onChange={e => setEditParentId(e.target.value)}>
                      <option value="">无</option>
                      {items.filter(i => i.level === editing.level - 1).map(p => (
                        <option key={p.orgId} value={p.orgId}>{p.code} · {p.name || p.placeholderKey}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="org-field">
                  <span>外部编码</span>
                  <input value={editExtCode} placeholder="如 EXT_ORG_001" onChange={e => setEditExtCode(e.target.value)} />
                </label>
                <label className="org-field">
                  <span>变更原因</span>
                  <input value={editReason} placeholder="请输入本次修改原因" onChange={e => setEditReason(e.target.value)} />
                </label>
                <button type="button" className="primary-button" disabled={busy} onClick={() => void submitEdit()}>提交变更审批</button>
              </div>
            </aside>
          )}
        </div>
      </section>

      {/* 卡片 3：变更审批记录 */}
      <section className="org-card">
        <div className="org-card-head">
          <h3>组织机构变更工单</h3>
          <span className="app-count-badge">{tickets.length}</span>
        </div>
        <div className="org-table-wrap">
          <table className="org-table">
            <thead>
              <tr>
                <th>工单号</th>
                <th>发起人</th>
                <th>变更内容</th>
                <th>状态</th>
                <th style={{textAlign: 'right'}}>操作</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.ticketNo}>
                  <td><code className="org-code-chip">{t.ticketNo}</code></td>
                  <td>{t.account}</td>
                  <td>{t.reason}</td>
                  <td>
                    <span className={`app-status-pill tone-${t.status === '已完成' ? 'success' : t.status === '已驳回' ? 'danger' : 'pending'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td style={{textAlign: 'right'}}>
                    {t.status === '待受理' ? (
                      <div className="org-row-actions">
                        <button type="button" className="primary-button org-btn-sm" disabled={busy} onClick={() => void reviewTicket(t.ticketNo, '批准')}><Check size={13} /> 批准</button>
                        <button type="button" className="danger-outline-button org-btn-sm" disabled={busy} onClick={() => void reviewTicket(t.ticketNo, '驳回')}><X size={13} /> 驳回</button>
                      </div>
                    ) : <span className="org-muted-text">—</span>}
                  </td>
                </tr>
              ))}
              {tickets.length === 0 && (
                <tr><td colSpan={5} className="org-empty-cell">暂无变更工单记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
