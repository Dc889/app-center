import {useEffect, useState} from 'react'
import {Check, Play, Plus, RefreshCw, ShieldAlert, X} from 'lucide-react'
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

export function KeywordRulesPage() {
  const [version, setVersion] = useState(1)
  const [items, setItems] = useState<KeywordRule[]>([])
  const [tickets, setTickets] = useState<ConfigTicket[]>([])
  const [catTab, setCatTab] = useState('全部')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  // Add form -> CFG-02
  const [category, setCategory] = useState('涉密标识')
  const [pattern, setPattern] = useState('')
  const [matchMode, setMatchMode] = useState('关键词包含')
  const [severity, setSeverity] = useState('阻断')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')

  // Dry-run scanner
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

  const filtered = catTab === '全部' ? items : items.filter(i => i.category === catTab)

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
    if (!pattern.trim() || !reason.trim()) { setNotice('请填写关键词/正则与变更原因'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/config-tickets', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ticketType: 'CFG-02',
          reason: reason.trim(),
          payload: {operation: '新增词条', category, pattern: pattern.trim(), matchMode, severity, targets: ['知识库文档', 'Skill 包', 'MCP 响应'], note: note.trim()},
        }),
      })
      const data = await res.json()
      if (!res.ok) throw Error(data.error?.message ?? '提交失败')
      setNotice(`已提交 ${data.ticketNo}，批准后更新词库版本`)
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

  return (
    <div data-testid="keyword-rules-page">
      <div className="warehouse-top-bar">
        <PageHeader view="keywordRules" />
        <div className="warehouse-kpi-strip">
          <div className="warehouse-kpi-pill"><ShieldAlert size={15} /><span>词库版本</span><strong>v{version}</strong></div>
          <div className="warehouse-kpi-pill"><span>启用词条</span><strong>{items.filter(i => i.enabled).length}</strong></div>
          <div className="warehouse-kpi-pill"><span>阻断级</span><strong>{items.filter(i => i.enabled && i.severity === '阻断').length}</strong></div>
        </div>
      </div>

      {notice && <p role="status" data-testid="kw-notice">{notice}</p>}

      {/* 在线试扫测试 */}
      <section className="panel" style={{padding: 16}}>
        <div className="panel-header" style={{marginBottom: 8}}>
          <h3>在线敏感词试扫验证（模拟知识库文档扫描，不留存文本）</h3>
          <button type="button" className="secondary-button" onClick={() => setReload(v => v + 1)}><RefreshCw size={14} /> 刷新</button>
        </div>
        <div className="warehouse-toolbar">
          <input style={{flex: 1, minWidth: 260}} placeholder="粘贴测试文本（如：本文件为内部涉密材料，password=123456）" value={sampleText} onChange={e => setSampleText(e.target.value)} />
          <button type="button" className="primary-button" onClick={() => void runDryScan()}><Play size={14} /> 立即试扫</button>
        </div>
        {dryRun && (
          <div style={{marginTop: 10, padding: '10px 12px', borderRadius: 8, background: dryRun.verdict === '通过' ? '#ecfdf3' : '#fef3f2', color: dryRun.verdict === '通过' ? '#067647' : '#b42318', fontSize: 13}}>
            <strong>扫描结论：{dryRun.verdict}</strong>（词库 v{dryRun.ruleSetVersion}）
            {dryRun.hits.length > 0 && ` · 命中 ${dryRun.hits.map(h => `[${h.severity}] ${h.pattern}`).join('、')}`}
          </div>
        )}
      </section>

      {/* 新增敏感词 -> CFG-02 */}
      <section className="panel" style={{padding: 16}}>
        <div className="panel-header" style={{marginBottom: 10}}><h3>新增敏感词条（提交 CFG-02 变更工单）</h3></div>
        <div className="warehouse-toolbar">
          <select value={category} onChange={e => setCategory(e.target.value)}>
            <option>涉密标识</option><option>个人隐私</option><option>凭据明文</option><option>业务合规</option>
          </select>
          <select value={matchMode} onChange={e => setMatchMode(e.target.value)}>
            <option>关键词包含</option><option>正则表达式</option>
          </select>
          <select value={severity} onChange={e => setSeverity(e.target.value)}>
            <option>阻断</option><option>告警</option>
          </select>
          <input placeholder="关键词或正则表达式" value={pattern} onChange={e => setPattern(e.target.value)} />
          <input placeholder="说明备注" value={note} onChange={e => setNote(e.target.value)} />
          <input placeholder="变更原因（必填）" value={reason} onChange={e => setReason(e.target.value)} />
          <button type="button" className="primary-button" disabled={busy} onClick={() => void submitAdd()}><Plus size={14} /> 提交 CFG-02</button>
        </div>
      </section>

      {/* 词库分类列表 */}
      <div className="warehouse-toolbar">
        <div className="usable-switch">
          {['全部', '涉密标识', '个人隐私', '凭据明文', '业务合规'].map(c => (
            <button key={c} type="button" className={catTab === c ? 'active' : ''} onClick={() => setCatTab(c)}>{c}</button>
          ))}
        </div>
      </div>

      <section className="panel table-panel">
        <table className="data-table">
          <thead>
            <tr><th>分类</th><th>关键词 / 正则</th><th>匹配方式</th><th>级别</th><th>适用范围</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.ruleId}>
                <td>{r.category}</td>
                <td><code>{r.pattern}</code></td>
                <td>{r.matchMode}</td>
                <td><span className={`status ${r.severity === '阻断' ? 'danger' : 'warning'}`}>{r.severity}</span></td>
                <td>{r.targets.join('、')}</td>
                <td><span className={`status ${r.enabled ? 'success' : 'warning'}`}>{r.enabled ? '启用' : '已停用'}</span></td>
                <td>{r.enabled ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void disableRule(r)}>申请停用</button> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel table-panel">
        <div className="panel-header"><h3>CFG-02 敏感词库变更工单</h3></div>
        <table className="data-table">
          <thead><tr><th>工单号</th><th>发起人</th><th>变更原因</th><th>状态</th><th>操作</th></tr></thead>
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
            {tickets.length === 0 && <tr><td colSpan={5} style={{textAlign: 'center', padding: 16}}>暂无 CFG-02 变更工单</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}
