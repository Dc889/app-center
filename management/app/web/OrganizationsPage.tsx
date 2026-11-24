import {useEffect, useState} from 'react'
import {Building2, Check, Layers, Plus, RefreshCw, X} from 'lucide-react'
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

export function OrganizationsPage() {
  const [items, setItems] = useState<OrgItem[]>([])
  const [tickets, setTickets] = useState<ConfigTicket[]>([])
  const [levelTab, setLevelTab] = useState<'all' | number>('all')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)

  // Create organization (named single/multi or batch placeholder)
  const [createMode, setCreateMode] = useState<'named' | 'placeholder'>('named')
  const [batchLevel, setBatchLevel] = useState(1)
  const [batchCount, setBatchCount] = useState(5)
  const [batchParentId, setBatchParentId] = useState('')
  const [newNames, setNewNames] = useState('')
  const [newExtCode, setNewExtCode] = useState('')
  const [batchReason, setBatchReason] = useState('')

  // Single edit / add drawer
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

  const filtered = levelTab === 'all' ? items : items.filter(i => i.level === levelTab)
  const orgNameOf = (id: string) => {
    const found = items.find(i => i.orgId === id)
    return found ? `${found.code} ${found.name || found.placeholderKey}` : '—'
  }

  async function submitCreate() {
    const parsedNames = newNames.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    if (createMode === 'named' && parsedNames.length === 0) {
      setNotice('请输入组织机构名称（多个名称可用逗号分隔）')
      return
    }
    const reason = batchReason.trim() || (createMode === 'named' ? `新增 ${batchLevel} 级机构：${parsedNames.join('、')}` : `批量初始化 ${batchLevel} 级机构占位（${batchCount} 个）`)
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
      setNotice(`已提交 ${data.ticketNo}（在下方工单列表点击「批准」即可生效）`)
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
      setNotice(`已提交 ${data.ticketNo}，批准后自动生效并保留原占位别名`)
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

  return (
    <div data-testid="organizations-page">
      <div className="warehouse-top-bar">
        <PageHeader view="organizations" />
        <div className="warehouse-kpi-strip">
          <div className="warehouse-kpi-pill"><Building2 size={15} /><span>总机构数</span><strong>{items.length}</strong></div>
          <div className="warehouse-kpi-pill"><Layers size={15} /><span>已命名</span><strong>{items.filter(i => i.name).length}</strong></div>
          <div className="warehouse-kpi-pill"><span>占位待填</span><strong>{items.filter(i => !i.name).length}</strong></div>
        </div>
      </div>

      {notice && <p role="status" data-testid="org-notice">{notice}</p>}

      {/* 新增组织机构 / 批量生成占位工具条 */}
      <section className="panel" style={{padding: 16}}>
        <div className="panel-header" style={{marginBottom: 12}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}>
            <h3 style={{margin: 0}}>新增组织机构（提交 CFG-01 变更工单）</h3>
            <div className="usable-switch">
              <button type="button" className={createMode === 'named' ? 'active' : ''} onClick={() => setCreateMode('named')}>直接命名新增</button>
              <button type="button" className={createMode === 'placeholder' ? 'active' : ''} onClick={() => setCreateMode('placeholder')}>按数量生成占位</button>
            </div>
          </div>
          <button type="button" className="secondary-button" disabled={loading} onClick={() => setReload(v => v + 1)}><RefreshCw size={14} /> 刷新</button>
        </div>
        <div className="warehouse-toolbar" style={{flexWrap: 'wrap', gap: 10}}>
          <label className="log-filter">
            <span>机构层级</span>
            <select value={batchLevel} onChange={e => setBatchLevel(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map(l => <option key={l} value={l}>{l} 级机构（{l}.x）</option>)}
            </select>
          </label>
          {batchLevel > 1 && (
            <label className="log-filter">
              <span>上级机构</span>
              <select value={batchParentId} onChange={e => setBatchParentId(e.target.value)}>
                <option value="">请选择 {batchLevel - 1} 级上级机构</option>
                {items.filter(i => i.level === batchLevel - 1).map(p => (
                  <option key={p.orgId} value={p.orgId}>{p.code} · {p.name || p.placeholderKey}</option>
                ))}
              </select>
            </label>
          )}
          {createMode === 'named' ? (
            <>
              <input
                style={{flex: 1.4, minWidth: 240}}
                placeholder="输入组织机构名称（多个机构可用逗号分隔，如：刑侦支队, 经侦支队）"
                value={newNames}
                onChange={e => setNewNames(e.target.value)}
              />
              <input
                style={{width: 150}}
                placeholder="外部编码（选填）"
                value={newExtCode}
                onChange={e => setNewExtCode(e.target.value)}
              />
            </>
          ) : (
            <label className="log-filter">
              <span>新增数量</span>
              <input type="number" min={1} max={50} style={{width: 72}} value={batchCount} onChange={e => setBatchCount(Number(e.target.value))} />
            </label>
          )}
          <input
            style={{flex: 1, minWidth: 180}}
            placeholder="变更原因（选填，留空自动生成）"
            value={batchReason}
            onChange={e => setBatchReason(e.target.value)}
          />
          <button type="button" className="primary-button" disabled={busy} onClick={() => void submitCreate()}>
            <Plus size={15} /> {createMode === 'named' ? '新增组织机构' : '生成占位序号'}
          </button>
        </div>
      </section>

      {/* 1~6级筛选标签 */}
      <div className="warehouse-toolbar">
        <div className="usable-switch">
          <button type="button" className={levelTab === 'all' ? 'active' : ''} onClick={() => setLevelTab('all')}>全部（{items.length}）</button>
          {[1, 2, 3, 4, 5, 6].map(l => (
            <button key={l} type="button" className={levelTab === l ? 'active' : ''} onClick={() => setLevelTab(l)}>
              {l} 级（{items.filter(i => i.level === l).length}）
            </button>
          ))}
        </div>
      </div>

      <div className="warehouse-layout">
        <section className="panel table-panel" style={{overflowX: 'auto'}}>
          <table className="data-table">
            <thead>
              <tr>
                <th>层级</th>
                <th>序号</th>
                <th>占位关键字</th>
                <th>机构显示名称</th>
                <th>上级机构</th>
                <th>外部编码</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.orgId}>
                  <td>{item.level} 级</td>
                  <td><strong>{item.code}</strong></td>
                  <td><code>{item.placeholderKey}</code></td>
                  <td>{item.name || <span className="version-meta">未填写（显示占位）</span>}</td>
                  <td>{item.parentId ? orgNameOf(item.parentId) : '根级'}</td>
                  <td>{item.externalCode || '—'}</td>
                  <td><span className={`status ${item.enabled ? 'success' : 'warning'}`}>{item.enabled ? '启用' : '停用'}</span></td>
                  <td>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setEditing(item)
                        setEditName(item.name)
                        setEditParentId(item.parentId)
                        setEditExtCode(item.externalCode)
                        setEditReason('')
                      }}
                    >
                      配置名称 / 映射
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{textAlign: 'center', padding: 24}}>该层级暂无机构，可在上方一键批量生成占位序号。</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {editing && (
          <aside className="panel" data-testid="org-editor">
            <div className="panel-header" style={{marginBottom: 12}}>
              <h3>配置 {editing.code}（{editing.placeholderKey}）</h3>
              <button type="button" className="secondary-button" onClick={() => setEditing(null)}>关闭</button>
            </div>
            <div className="form-section" style={{display: 'grid', gap: 12}}>
              <label>
                <span>机构真实名称（留空则显示占位关键字）</span>
                <input value={editName} placeholder={`例如：${editing.placeholderKey} 对应真实机构名`} onChange={e => setEditName(e.target.value)} />
              </label>
              {editing.level > 1 && (
                <label>
                  <span>上级机构</span>
                  <select value={editParentId} onChange={e => setEditParentId(e.target.value)}>
                    <option value="">无</option>
                    {items.filter(i => i.level === editing.level - 1).map(p => (
                      <option key={p.orgId} value={p.orgId}>{p.code} · {p.name || p.placeholderKey}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span>外部系统映射编码（OA / LDAP / 子系统）</span>
                <input value={editExtCode} placeholder="例如 EXT_ORG_001" onChange={e => setEditExtCode(e.target.value)} />
              </label>
              <label>
                <span>变更原因（必填，记入 CFG-01 审计）</span>
                <input value={editReason} placeholder="说明本次填名或映射调整原因" onChange={e => setEditReason(e.target.value)} />
              </label>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void submitEdit()}>提交 CFG-01 变更单</button>
            </div>
          </aside>
        )}
      </div>

      {/* CFG-01 变更工单审批列表 */}
      <section className="panel table-panel" style={{marginTop: 16}}>
        <div className="panel-header"><h3>CFG-01 组织机构变更工单</h3></div>
        <table className="data-table">
          <thead>
            <tr><th>工单号</th><th>发起人</th><th>变更原因</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            {tickets.map(t => (
              <tr key={t.ticketNo}>
                <td><code>{t.ticketNo}</code></td>
                <td>{t.account}</td>
                <td>{t.reason}</td>
                <td><span className={`status ${t.status === '已完成' ? 'success' : t.status === '已驳回' ? 'danger' : 'warning'}`}>{t.status}</span></td>
                <td>
                  {t.status === '待受理' ? (
                    <div className="draft-toolbar">
                      <button type="button" className="primary-button" disabled={busy} onClick={() => void reviewTicket(t.ticketNo, '批准')}><Check size={14} /> 批准生效</button>
                      <button type="button" className="secondary-button" disabled={busy} onClick={() => void reviewTicket(t.ticketNo, '驳回')}><X size={14} /> 驳回</button>
                    </div>
                  ) : '—'}
                </td>
              </tr>
            ))}
            {tickets.length === 0 && <tr><td colSpan={5} style={{textAlign: 'center', padding: 16}}>暂无 CFG-01 变更工单</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}
