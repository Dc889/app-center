import {useEffect, useState} from 'react'
import {AlertTriangle, Check, CheckCircle2, Layers, Network, Play, Plus, RefreshCw, Search, ShieldCheck, X} from 'lucide-react'
import {PageHeader} from '../../shared-ui/UiContext'

type McpCase = {
  caseId: string
  suiteId: string
  category: string
  prompt: string
  argumentsTemplate: string
  assertionRule: string
  enabled: boolean
}

type ConfigTicket = {
  ticketNo: string
  account: string
  reason: string
  status: string
}

type DryRunOut = {
  testSuiteVersion: number
  endpoint: string
  totalCases: number
  passedCases: number
  results: Array<{caseId: string; category: string; passed: boolean; verdict: string; error?: string}>
}

const CATEGORIES = ['全部', '越权数据试探', '违规内容诱导', '隐私泄露检测', '提示词投毒检测']

export function McpTestSuitesPage() {
  const [version, setVersion] = useState(1)
  const [items, setItems] = useState<McpCase[]>([])
  const [tickets, setTickets] = useState<ConfigTicket[]>([])
  const [catTab, setCatTab] = useState('全部')
  const [keyword, setKeyword] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  const [category, setCategory] = useState('越权数据试探')
  const [prompt, setPrompt] = useState('')
  const [assertionRule, setAssertionRule] = useState('不得命中敏感词库')
  const [reason, setReason] = useState('')

  const [endpoint, setEndpoint] = useState('http://127.0.0.1:4390/mcp/time')
  const [dryRun, setDryRun] = useState<DryRunOut | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([
      fetch('/api/mcp-test-suites').then(r => r.json()),
      fetch('/api/config-tickets?ticketType=CFG-03').then(r => r.json()),
    ]).then(([sData, tData]) => {
      if (!active) return
      setVersion(sData.testSuiteVersion || 1)
      setItems(Array.isArray(sData.items) ? sData.items : [])
      setTickets(Array.isArray(tData.items) ? tData.items : [])
    })
    return () => { active = false }
  }, [reload])

  const q = keyword.trim().toLowerCase()
  const filtered = items.filter(i => {
    if (catTab !== '全部' && i.category !== catTab) return false
    if (!q) return true
    return [i.caseId, i.category, i.prompt, i.assertionRule].some(v => (v || '').toLowerCase().includes(q))
  })

  async function runTest() {
    setBusy(true)
    try {
      const res = await fetch('/api/mcp-test-suites/dry-run', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({endpoint}),
      })
      setDryRun(await res.json())
    } finally {
      setBusy(false)
    }
  }

  async function submitAdd() {
    if (!prompt.trim()) { setNotice('请填写测试问题'); return }
    const finalReason = reason.trim() || `新增${category}测试题`
    setBusy(true)
    try {
      const res = await fetch('/api/config-tickets', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ticketType: 'CFG-03',
          reason: finalReason,
          payload: {operation: '新增测试题', suiteId: 'default-compliance', category, prompt: prompt.trim(), argumentsTemplate: '{}', assertionRule},
        }),
      })
      const data = await res.json()
      if (!res.ok) throw Error(data.error?.message ?? '提交失败')
      setNotice(`已提交变更单 ${data.ticketNo}，请在下方审批记录中批准生效`)
      setPrompt('')
      setReason('')
      setReload(v => v + 1)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  async function disableCase(c: McpCase) {
    setBusy(true)
    try {
      const res = await fetch('/api/config-tickets', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ticketType: 'CFG-03',
          reason: `停用测试题 ${c.caseId}`,
          payload: {operation: '停用测试题', caseId: c.caseId},
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
        body: JSON.stringify({ticketNo, action, note: action === '批准' ? '批准并生效新题库' : '驳回'}),
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
  const categoryCount = new Set(items.filter(i => i.enabled).map(i => i.category)).size
  const pendingCount = tickets.filter(t => t.status === '待受理').length

  return (
    <div className="org-page-stack" data-testid="mcp-test-suites-page">
      <div className="org-header-row">
        <PageHeader view="mcpTestSuites" />
        <button type="button" className="app-icon-btn" onClick={() => setReload(v => v + 1)}>
          <RefreshCw size={14} />
          <span>刷新数据</span>
        </button>
      </div>

      {/* 4 等宽对齐 KPI 指标卡 */}
      <div className="org-kpi-grid">
        <div className="org-kpi-card">
          <div className="org-kpi-icon blue"><Network size={18} /></div>
          <div className="org-kpi-meta"><span>当前题库版本</span><strong>v{version}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon green"><ShieldCheck size={18} /></div>
          <div className="org-kpi-meta"><span>启用测试题</span><strong>{enabledCount}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon amber"><Layers size={18} /></div>
          <div className="org-kpi-meta"><span>覆盖探测类别</span><strong>{categoryCount}</strong></div>
        </div>
        <div className="org-kpi-card">
          <div className="org-kpi-icon slate"><AlertTriangle size={18} /></div>
          <div className="org-kpi-meta"><span>待审批变更</span><strong>{pendingCount}</strong></div>
        </div>
      </div>

      {notice && <div className="app-banner info" role="status" data-testid="mcp-suite-notice">{notice}</div>}

      {/* 卡片 1：在线 MCP 违规探测联调 */}
      <section className="org-card">
        <div className="org-card-head">
          <h3>在线 MCP 违规探测联调</h3>
          <span className="app-type-tag">实时端点探测</span>
        </div>
        <div className="cfg-inline-grid">
          <label className="org-field">
            <span>目标 MCP 端点地址</span>
            <input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="http://127.0.0.1:4390/mcp/time" />
          </label>
          <div className="org-field org-field-action">
            <span aria-hidden="true">&nbsp;</span>
            <button type="button" className="primary-button" disabled={busy} onClick={() => void runTest()}>
              <Play size={14} /> 试跑当前题库
            </button>
          </div>
        </div>
        {dryRun && (
          <div className={`app-banner ${dryRun.passedCases === dryRun.totalCases ? 'info' : 'danger'}`}>
            {dryRun.passedCases === dryRun.totalCases ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span>
              <strong>试跑结果：{dryRun.passedCases} / {dryRun.totalCases} 通过</strong> · 题库 v{dryRun.testSuiteVersion} · {dryRun.endpoint}
            </span>
          </div>
        )}
      </section>

      {/* 卡片 2：新增预设测试题 */}
      <section className="org-card">
        <div className="org-card-head">
          <h3>新增预设测试题</h3>
        </div>
        <div className="cfg-mcp-grid">
          <label className="org-field">
            <span>探测类别</span>
            <select value={category} onChange={e => setCategory(e.target.value)}>
              <option>越权数据试探</option><option>违规内容诱导</option><option>隐私泄露检测</option><option>提示词投毒检测</option>
            </select>
          </label>
          <label className="org-field">
            <span>判定规则</span>
            <select value={assertionRule} onChange={e => setAssertionRule(e.target.value)}>
              <option>不得命中敏感词库</option><option>必须拒绝响应</option><option>禁止正则匹配</option>
            </select>
          </label>
          <label className="org-field">
            <span>测试问题</span>
            <input placeholder="输入探测提示词" value={prompt} onChange={e => setPrompt(e.target.value)} />
          </label>
          <label className="org-field">
            <span>变更原因</span>
            <input placeholder="留空自动生成" value={reason} onChange={e => setReason(e.target.value)} />
          </label>
          <div className="org-field org-field-action">
            <span aria-hidden="true">&nbsp;</span>
            <button type="button" className="primary-button" disabled={busy} onClick={() => void submitAdd()}>
              <Plus size={14} /> 新增测试题
            </button>
          </div>
        </div>
      </section>

      {/* 卡片 3：预设测试题库列表 */}
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
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜索编号、类别或问题内容" />
          </div>
        </div>

        <div className="org-table-wrap">
          <table className="org-table">
            <thead>
              <tr>
                <th>编号</th>
                <th>探测类别</th>
                <th>测试问题</th>
                <th>判定规则</th>
                <th>状态</th>
                <th style={{textAlign: 'right'}}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.caseId}>
                  <td><code className="org-code-chip">{c.caseId}</code></td>
                  <td><span className="app-type-tag">{c.category}</span></td>
                  <td>{c.prompt}</td>
                  <td className="org-muted-cell">{c.assertionRule}</td>
                  <td><span className={`app-status-pill tone-${c.enabled ? 'success' : 'muted'}`}>{c.enabled ? '启用' : '停用'}</span></td>
                  <td style={{textAlign: 'right'}}>
                    {c.enabled ? (
                      <button type="button" className="app-icon-btn" disabled={busy} onClick={() => void disableCase(c)}>申请停用</button>
                    ) : <span className="org-muted-text">—</span>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="org-empty-cell">当前筛选条件下暂无测试题</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 卡片 4：变更审批记录 */}
      <section className="org-card">
        <div className="org-card-head">
          <h3>MCP 合规题库变更工单</h3>
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
