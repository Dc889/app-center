import {useEffect, useState} from 'react'
import {Check, Network, Play, Plus, RefreshCw, X} from 'lucide-react'
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

export function McpTestSuitesPage() {
  const [version, setVersion] = useState(1)
  const [items, setItems] = useState<McpCase[]>([])
  const [tickets, setTickets] = useState<ConfigTicket[]>([])
  const [catTab, setCatTab] = useState('全部')
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

  const filtered = catTab === '全部' ? items : items.filter(i => i.category === catTab)

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
    if (!prompt.trim() || !reason.trim()) { setNotice('请填写测试问题与变更原因'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/config-tickets', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ticketType: 'CFG-03',
          reason: reason.trim(),
          payload: {operation: '新增测试题', suiteId: 'default-compliance', category, prompt: prompt.trim(), argumentsTemplate: '{}', assertionRule},
        }),
      })
      const data = await res.json()
      if (!res.ok) throw Error(data.error?.message ?? '提交失败')
      setNotice(`已提交 ${data.ticketNo}，批准后更新题库版本`)
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

  return (
    <div data-testid="mcp-test-suites-page">
      <div className="warehouse-top-bar">
        <PageHeader view="mcpTestSuites" />
        <div className="warehouse-kpi-strip">
          <div className="warehouse-kpi-pill"><Network size={15} /><span>题库版本</span><strong>v{version}</strong></div>
          <div className="warehouse-kpi-pill"><span>启用测试题</span><strong>{items.filter(i => i.enabled).length}</strong></div>
        </div>
      </div>

      {notice && <p role="status" data-testid="mcp-suite-notice">{notice}</p>}

      {/* 在线试跑 */}
      <section className="panel" style={{padding: 16}}>
        <div className="panel-header" style={{marginBottom: 8}}>
          <h3>在线 MCP 违规探测联调</h3>
          <button type="button" className="secondary-button" onClick={() => setReload(v => v + 1)}><RefreshCw size={14} /> 刷新</button>
        </div>
        <div className="warehouse-toolbar">
          <input style={{flex: 1, minWidth: 260}} value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="目标 MCP 端点地址" />
          <button type="button" className="primary-button" disabled={busy} onClick={() => void runTest()}><Play size={14} /> 试跑当前题库</button>
        </div>
        {dryRun && (
          <div style={{marginTop: 10, padding: '10px 12px', borderRadius: 8, background: dryRun.passedCases === dryRun.totalCases ? '#ecfdf3' : '#fffaeb', fontSize: 13}}>
            <strong>试跑结果：{dryRun.passedCases} / {dryRun.totalCases} 通过</strong>（题库 v{dryRun.testSuiteVersion}，端点 {dryRun.endpoint}）
          </div>
        )}
      </section>

      {/* 新增测试题 -> CFG-03 */}
      <section className="panel" style={{padding: 16}}>
        <div className="panel-header" style={{marginBottom: 10}}><h3>新增预设测试题（提交 CFG-03 变更工单）</h3></div>
        <div className="warehouse-toolbar">
          <select value={category} onChange={e => setCategory(e.target.value)}>
            <option>越权数据试探</option><option>违规内容诱导</option><option>隐私泄露检测</option><option>提示词投毒检测</option>
          </select>
          <select value={assertionRule} onChange={e => setAssertionRule(e.target.value)}>
            <option>不得命中敏感词库</option><option>必须拒绝响应</option><option>禁止正则匹配</option>
          </select>
          <input style={{flex: 1, minWidth: 220}} placeholder="测试问题 / 探测提示词" value={prompt} onChange={e => setPrompt(e.target.value)} />
          <input placeholder="变更原因（必填）" value={reason} onChange={e => setReason(e.target.value)} />
          <button type="button" className="primary-button" disabled={busy} onClick={() => void submitAdd()}><Plus size={14} /> 提交 CFG-03</button>
        </div>
      </section>

      <div className="warehouse-toolbar">
        <div className="usable-switch">
          {['全部', '越权数据试探', '违规内容诱导', '隐私泄露检测', '提示词投毒检测'].map(c => (
            <button key={c} type="button" className={catTab === c ? 'active' : ''} onClick={() => setCatTab(c)}>{c}</button>
          ))}
        </div>
      </div>

      <section className="panel table-panel">
        <table className="data-table">
          <thead><tr><th>编号</th><th>探测类别</th><th>测试问题</th><th>判定规则</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.caseId}>
                <td><code>{c.caseId}</code></td>
                <td>{c.category}</td>
                <td>{c.prompt}</td>
                <td>{c.assertionRule}</td>
                <td><span className={`status ${c.enabled ? 'success' : 'warning'}`}>{c.enabled ? '启用' : '已停用'}</span></td>
                <td>{c.enabled ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void disableCase(c)}>申请停用</button> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel table-panel">
        <div className="panel-header"><h3>CFG-03 MCP 合规题库变更工单</h3></div>
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
            {tickets.length === 0 && <tr><td colSpan={5} style={{textAlign: 'center', padding: 16}}>暂无 CFG-03 变更工单</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}
