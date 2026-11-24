import {useEffect, useState} from 'react'
import {AlertTriangle, Check, CheckCircle2, Play, Plus, RefreshCw, Search, ShieldAlert, ShieldCheck, X} from 'lucide-react'
import {PageHeader} from '../../shared-ui/UiContext'

type KeywordRule = {
  ruleId: string
  category: string
  pattern: string
  matchMode: string
  severity: string
  targets: string[]
  enabled: boolean
  note: string
}

type ConfigTicket = {
  ticketNo: string
  account: string
  reason: string
  status: string
}

type DryRunResult = {
  ruleSetVersion: number
  verdict: string
  hits: Array<{ruleId: string; category: string; pattern: string; severity: string; matchCount: number; sample: string}>
}

const CATEGORIES = ['全部', '涉密标识', '个人隐私', '凭据明文', '业务合规']

export function KeywordRulesPage() {
  const [version, setVersion] = useState(1)
  const [items, setItems] = useState<KeywordRule[]>([])
  const [tickets, setTickets] = useState<ConfigTicket[]>([])
  const [catTab, setCatTab] = useState('全部')
  const [keyword, setKeyword] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  const [category, setCategory] = useState('涉密标识')
  const [pattern, setPattern] = useState('')
  const [matchMode, setMatchMode] = useState('关键词包含')
  const [severity, setSeverity] = useState('阻断')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')

  const [sampleText, setSampleText] = useState('')
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([
      fetch('/api/keyword-rules').then(r => r.json()),
      fetch('/api/config-tickets?ticketType=CFG-02').then(r => r.json()),
    ]).then(([kwData, tData]) => {
      if (!active) return
      setVersion(kwData.ruleSetVersion || 1)
      setItems(Array.isArray(kwData.items) ? kwData.items : [])
      setTickets(Array.isArray(tData.items) ? tData.items : [])
    })
    return () => { active = false }
  }, [reload])

  const q = keyword.trim().toLowerCase()
  const filtered = items.filter(i => {
    if (catTab !== '全部' && i.category !== catTab) return false
    if (!q) return true
    return [i.pattern, i.category, i.note, i.matchMode].some(v => (v || '').toLowerCase().includes(q))
  })

  async function runDryScan() {
    if (!sampleText.trim()) return
    const res = await fetch('/api/keyword-rules/dry-run', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({text: sampleText}),
    })
    setDryRun(await res.json())
  }

  async function submitAdd() {
    if (!pattern.trim()) { setNotice('请填写关键词或正则表达式'); return }
    const finalReason = reason.trim() || `新增${category}规则：${pattern.trim()}`
    setBusy(true)
    try {
      const res = await fetch('/api/config-tickets', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ticketType: 'CFG-02',
          reason: finalReason,
          payload: {operation: '新增词条', category, pattern: pattern.trim(), matchMode, severity, targets: ['知识库文档', 'Skill 包', 'MCP 响应'], note: note.trim()},
        }),
      })
      const data = await res.json()
      if (!res.ok) throw Error(data.error?.message ?? '提交失败')
      setNotice(`已提交变更单 ${data.ticketNo}，请在下方审批记录中批准生效`)
      setPattern('')
      setNote('')
      setReason('')
      setReload(v => v + 1)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  async function disableRule(rule: KeywordRule) {
    setBusy(true)
    try {
      const res = await fetch('/api/config-tickets', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ticketType: 'CFG-02',
          reason: `停用敏感词条：${rule.pattern}`,
          payload: {operation: '停用词条', ruleId: rule.ruleId},
        }),
      })
      const data = await res.json()
      if (!res.ok) throw Error(data.error?.message ?? '提交失败')
      setNotice(`已提交停用工单 ${data.ticketNo}`)
      setReload(v => v + 1)
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
        body: JSON.stringify({ticketNo, action, note: action === '批准' ? '批准并同步词库版本' : '驳回'}),
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

  const enabledCount = items.filter(i => i.enabled).length
  const blockCount = items.filter(i => i.enabled && i.severity === '阻断').length
  const pendingCount = tickets.filter(t => t.status === '待受理').length

  return (
    <div className="org-page-stack" data-testid="keyword-rules-page">
      <div className="org-header-row">
        <PageHeader view="keywordRules" />
        <button type="button" className="app-icon-btn" onClick={() => setReload(v => v + 1)}>
          <RefreshCw size={14} />
          <span>刷新数据</span>
        </button>
      </div>

      {/* 4 等宽对齐 KPI 指标卡 */}
      <div className="org-kpi-grid">
        <div className="org-kpi-card">
          <div className="org-kpi-icon blue"><ShieldCheck size={18} /></div>
          <div className="org-kpi-meta"><span>当前词库版本</span><strong>v{version}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon green"><Check size={18} /></div>
          <div className="org-kpi-meta"><span>启用词条数</span><strong>{enabledCount}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon amber"><ShieldAlert size={18} /></div>
          <div className="org-kpi-meta"><span>阻断级词条</span><strong>{blockCount}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon slate"><AlertTriangle size={18} /></div>
          <div className="org-kpi-meta"><span>待审批变更</span><strong>{pendingCount}</strong></div>
        </div>
      </div>

      {notice && <div className="app-banner info" role="status" data-testid="kw-notice">{notice}</div>}

      {/* 卡片 1：在线试扫验证 */}
      <section className="org-card">
        <div className="org-card-head">
          <h3>在线敏感词试扫验证</h3>
          <span className="app-type-tag">零留存内存扫描</span>
        </div>
        <div className="cfg-inline-grid">
          <label className="org-field">
            <span>测试文本</span>
            <input
              placeholder="输入或粘贴待检测文本，如：本文件为内部涉密材料，password=123456"
              value={sampleText}
              onChange={e => setSampleText(e.target.value)}
            />
          </label>
          <div className="org-field org-field-action">
            <span aria-hidden="true">&nbsp;</span>
            <button type="button" className="primary-button" onClick={() => void runDryScan()}>
              <Play size={14} /> 立即试扫
            </button>
          </div>
        </div>
        {dryRun && (
          <div className={`app-banner ${dryRun.verdict === '通过' ? 'info' : 'danger'}`}>
            {dryRun.verdict === '通过' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span>
              <strong>扫描结论：{dryRun.verdict}</strong> · 词库 v{dryRun.ruleSetVersion}
              {dryRun.hits.length > 0 && ` · 命中 ${dryRun.hits.map(h => `${h.severity} ${h.pattern}`).join('、')}`}
            </span>
          </div>
        )}
      </section>

      {/* 卡片 2：新增敏感词条 */}
      <section className="org-card">
        <div className="org-card-head">
          <h3>新增敏感词条</h3>
        </div>
        <div className="cfg-kw-grid">
          <label className="org-field">
            <span>规则分类</span>
            <select value={category} onChange={e => setCategory(e.target.value)}>
              <option>涉密标识</option><option>个人隐私</option><option>凭据明文</option><option>业务合规</option>
            </select>
          </label>
          <label className="org-field">
            <span>匹配方式</span>
            <select value={matchMode} onChange={e => setMatchMode(e.target.value)}>
              <option>关键词包含</option><option>正则表达式</option>
            </select>
          </label>
          <label className="org-field">
            <span>处置级别</span>
            <select value={severity} onChange={e => setSeverity(e.target.value)}>
              <option>阻断</option><option>告警</option>
            </select>
          </label>
          <label className="org-field">
            <span>关键词或正则</span>
            <input placeholder="输入匹配表达式" value={pattern} onChange={e => setPattern(e.target.value)} />
          </label>
          <label className="org-field">
            <span>规则说明</span>
            <input placeholder="选填" value={note} onChange={e => setNote(e.target.value)} />
          </label>
          <label className="org-field">
            <span>变更原因</span>
            <input placeholder="留空自动生成" value={reason} onChange={e => setReason(e.target.value)} />
          </label>
          <div className="org-field org-field-action">
            <span aria-hidden="true">&nbsp;</span>
            <button type="button" className="primary-button" disabled={busy} onClick={() => void submitAdd()}>
              <Plus size={14} /> 新增词条
            </button>
          </div>
        </div>
      </section>

      {/* 卡片 3：敏感词库列表 */}
      <section className="org-card">
        <div className="org-card-head">
          <div className="org-level-tabs">
            {CATEGORIES.map(c => {
              const count = c === '全部' ? items.length : items.filter(i => i.category === c).length
              return (
                <button key={c} type="button" className={catTab === c ? 'is-active' : ''} onClick={() => setCatTab(c)}>
                  <span>{c}</span><em>{count}</em>
                </button>
              )
            })}
          </div>
          <div className="app-list-search org-table-search">
            <Search size={14} />
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜索关键词、分类或说明" />
          </div>
        </div>

        <div className="org-table-wrap">
          <table className="org-table">
            <thead>
              <tr>
                <th>分类</th>
                <th>关键词 / 正则</th>
                <th>匹配方式</th>
                <th>级别</th>
                <th>适用范围</th>
                <th>状态</th>
                <th style={{textAlign: 'right'}}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.ruleId}>
                  <td><span className="app-type-tag">{r.category}</span></td>
                  <td><code className="org-code-chip">{r.pattern}</code></td>
                  <td className="org-muted-cell">{r.matchMode}</td>
                  <td><span className={`app-status-pill tone-${r.severity === '阻断' ? 'danger' : 'pending'}`}>{r.severity}</span></td>
                  <td className="org-muted-cell">{r.targets.join('、')}</td>
                  <td><span className={`app-status-pill tone-${r.enabled ? 'success' : 'muted'}`}>{r.enabled ? '启用' : '停用'}</span></td>
                  <td style={{textAlign: 'right'}}>
                    {r.enabled ? (
                      <button type="button" className="app-icon-btn" disabled={busy} onClick={() => void disableRule(r)}>申请停用</button>
                    ) : <span className="org-muted-text">—</span>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="org-empty-cell">当前筛选条件下暂无词条</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 卡片 4：变更审批记录 */}
      <section className="org-card">
        <div className="org-card-head">
          <h3>敏感词库变更工单</h3>
          <span className="app-count-badge">{tickets.length}</span>
        </div>
        <div className="org-table-wrap">
          <table className="org-table">
            <thead>
              <tr><th>工单号</th><th>发起人</th><th>变更原因</th><th>状态</th><th style={{textAlign: 'right'}}>操作</th></tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.ticketNo}>
                  <td><code className="org-code-chip">{t.ticketNo}</code></td>
                  <td>{t.account}</td>
                  <td>{t.reason}</td>
                  <td><span className={`app-status-pill tone-${t.status === '已完成' ? 'success' : t.status === '已驳回' ? 'danger' : 'pending'}`}>{t.status}</span></td>
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
              {tickets.length === 0 && <tr><td colSpan={5} className="org-empty-cell">暂无变更工单记录</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
