import {useEffect, useState} from 'react'
import {Activity, Cpu, Download, FileCode2, Globe, Play, Settings2, Sparkles} from 'lucide-react'
import type {View} from '../../../shared-ui/UiContextData'

type ModelRow = {
  model: string
  provider: string
  calls: number
  tokens: number
  avgLatencySec: number
  errorRatePct: number
  errors: number
}

type IpRow = {ip: string; count: number; errors: number}

type AppInsightDetail = {
  days: number
  app: {
    appId: string
    name: string
    mode: string
    description: string
    source: string
    workspaceName: string
    ownerName: string
  }
  summary: {
    calls: number
    tokens: number
    avgLatencySec: number
    errorRatePct: number
    modelCount: number
  }
  models: ModelRow[]
  sourceChannels: {source: string; count: number}[]
  versions: {version: string; at: string | null}[]
  dsl: {
    nodeCount: number
    nodeTypes: Record<string, number>
    models: string[]
    datasetCount: number
    externalTools: string[]
    promptPreviews: string[]
    yamlText: string
  }
  callerIps: {
    available: boolean
    source: string
    containerName?: string
    appIps: IpRow[]
    gatewayIps: IpRow[]
  }
  aiReady: boolean
  aiModel: string | null
  latestReport: {
    taskId: string
    model: string
    report: string
    elapsedSec: number
    analyzedAt: string
  } | null
}

type HighFreqApp = {
  appId: string
  appName: string
  mode: string
  runCount: number
  totalTokens: number
  ownerName: string
  hasReport: boolean
  lastAnalyzedAt: string | null
}

type BatchTask = {
  taskId: string
  model: string
  total: number
  succeeded: number
  failed: number
  createdByName: string
  createdAt: string
}

const MODE_LABELS: Record<string, string> = {
  'agent-chat': 'Agent',
  agent: 'Agent',
  workflow: 'Workflow',
  'advanced-chat': 'Chatflow',
  chat: 'Chat',
  completion: 'Completion',
}

const SOURCE_LABELS: Record<string, string> = {
  api: '外部 API 调用',
  console: 'Dify 控制台调试',
  web_app: 'Web 应用分享页',
}

export function AgentAppInsightsPanel({
  apps,
  selectedAppId,
  onSelectAppId,
  onNavigate,
}: {
  apps: {appId: string; name: string; appMode: string}[]
  selectedAppId: string
  onSelectAppId: (id: string) => void
  onNavigate?: (view: View, ticketType?: string | null) => void
}) {
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [subTab, setSubTab] = useState<'models' | 'ips' | 'dsl'>('models')
  const [detail, setDetail] = useState<AppInsightDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showYaml, setShowYaml] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiMsg, setAiMsg] = useState('')
  const [rev, setRev] = useState(0)

  // Batch high-freq AI analysis state
  const [minRuns, setMinRuns] = useState('1')
  const [highFreq, setHighFreq] = useState<HighFreqApp[]>([])
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([])
  const [tasks, setTasks] = useState<BatchTask[]>([])
  const [batchBusy, setBatchBusy] = useState(false)

  // Auto-select first app if none selected yet
  useEffect(() => {
    if (!selectedAppId && apps.length > 0) {
      onSelectAppId(apps[0].appId)
    }
  }, [apps, selectedAppId, onSelectAppId])

  useEffect(() => {
    if (!selectedAppId) return
    const c = new AbortController()
    setLoading(true)
    setError('')
    fetch(`/api/agent-insights/app-detail?appId=${encodeURIComponent(selectedAppId)}&days=${days}`, {signal: c.signal})
      .then(async r => {
        const b = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(b?.message || b?.error?.message || '读取应用深度分析失败')
        return b as AppInsightDetail
      })
      .then(res => {
        if (!c.signal.aborted) setDetail(res)
      })
      .catch(e => {
        if (!c.signal.aborted && e.name !== 'AbortError') setError(e?.message || '读取失败')
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false)
      })
    return () => c.abort()
  }, [selectedAppId, days, rev])

  useEffect(() => {
    if (subTab !== 'dsl') return
    const c = new AbortController()
    fetch('/api/agent-insights/tasks', {signal: c.signal})
      .then(r => (r.ok ? r.json() : null))
      .then(res => { if (res && !c.signal.aborted) setTasks(res.tasks ?? []) })
      .catch(() => {})
    return () => c.abort()
  }, [subTab, rev])

  const downloadYaml = () => {
    if (!detail?.dsl?.yamlText) return
    const blob = new Blob([detail.dsl.yamlText], {type: 'text/yaml;charset=utf-8'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${detail.app.name || detail.app.appId}.yml`
    a.click()
    URL.revokeObjectURL(url)
  }

  const runSingleAiAnalysis = async () => {
    if (!selectedAppId) return
    setAnalyzing(true)
    setAiMsg('')
    setError('')
    try {
      const r = await fetch('/api/agent-insights/analyze', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({appId: selectedAppId}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || body?.error?.message || 'AI 分析失败')
      setAiMsg(`AI 作用分析完成（模型：${body.task?.model || detail?.aiModel || '默认'}）`)
      setRev(n => n + 1)
    } catch (e: any) {
      setError(e?.message || 'AI 分析失败')
    } finally {
      setAnalyzing(false)
    }
  }

  const scanHighFreq = async () => {
    setBatchBusy(true)
    setError('')
    try {
      const r = await fetch(`/api/agent-insights/high-freq?minRuns=${encodeURIComponent(minRuns || '0')}&days=${days}`)
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '扫描高频应用失败')
      const items: HighFreqApp[] = body.items ?? []
      setHighFreq(items)
      setSelectedBatchIds(items.slice(0, 10).map(i => i.appId))
    } catch (e: any) {
      setError(e?.message || '扫描失败')
    } finally {
      setBatchBusy(false)
    }
  }

  const runBatchAiAnalysis = async () => {
    if (selectedBatchIds.length === 0) return
    setBatchBusy(true)
    setAiMsg('')
    setError('')
    try {
      const r = await fetch('/api/agent-insights/analyze', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({appIds: selectedBatchIds}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || body?.error?.message || '批量 AI 分析失败')
      setAiMsg(`批量分析任务 ${body.task?.taskId} 已完成：成功 ${body.task?.succeeded ?? 0} 个，失败 ${body.task?.failed ?? 0} 个`)
      setRev(n => n + 1)
    } catch (e: any) {
      setError(e?.message || '批量 AI 分析失败')
    } finally {
      setBatchBusy(false)
    }
  }

  const maxModelCalls = Math.max(1, ...(detail?.models ?? []).map(m => m.calls))

  return (
    <section className="panel" data-testid="agent-usage-analysis" style={{marginTop: 16}}>
      <div className="panel-title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10}}>
        <div>
          <h3>智能体应用深度分析 · 模型使用、调用 IP 与 DSL 作用解析</h3>
          <p>聚合单应用真实模型消耗分布、Nginx 入口调用 IP、YAML 编排结构解析与受控 AI 功能分析。</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          style={{display: 'inline-flex', alignItems: 'center', gap: 6}}
          onClick={() => onNavigate?.('manual', 'CFG-04')}
        >
          <Settings2 size={14} /> AI 分析引擎配置 · CFG-04
        </button>
      </div>

      {/* 应用与时间窗选择栏 */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
          <select
            aria-label="分析指定智能体"
            value={selectedAppId}
            onChange={e => onSelectAppId(e.target.value)}
            style={{minWidth: 260}}
          >
            <option value="">请选择智能体应用</option>
            {apps.map(a => (
              <option key={a.appId} value={a.appId}>{a.name} · {MODE_LABELS[a.appMode] || a.appMode}</option>
            ))}
          </select>
          <div className="usable-switch">
            {([7, 30, 90] as const).map(d => (
              <button key={d} type="button" className={days === d ? 'active' : ''} onClick={() => setDays(d)}>
                近 {d} 日
              </button>
            ))}
          </div>
        </div>

        <div className="usable-switch">
          <button type="button" className={subTab === 'models' ? 'active' : ''} onClick={() => setSubTab('models')}>
            <Cpu size={13} style={{marginRight: 4, verticalAlign: -2}} /> 模型使用分析
          </button>
          <button type="button" className={subTab === 'ips' ? 'active' : ''} onClick={() => setSubTab('ips')}>
            <Globe size={13} style={{marginRight: 4, verticalAlign: -2}} /> 调用 IP 与来源
          </button>
          <button type="button" className={subTab === 'dsl' ? 'active' : ''} onClick={() => setSubTab('dsl')}>
            <FileCode2 size={13} style={{marginRight: 4, verticalAlign: -2}} /> YAML 与 AI 作用分析
          </button>
        </div>
      </div>

      {error && <p role="alert" style={{color: '#b42318', fontSize: 13, marginBottom: 10}}>{error}</p>}
      {aiMsg && <p role="status" style={{color: '#027a48', fontSize: 13, fontWeight: 500, marginBottom: 10}}>{aiMsg}</p>}
      {loading && <p style={{color: '#64748b', fontSize: 13}}>正在聚合 Dify 应用深度数据…</p>}

      {detail && !loading && (
        <>
          {/* 应用元信息抬头 */}
          <div style={{display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12}}>
            <strong style={{fontSize: 16}}>{detail.app.name}</strong>
            <span className="app-status-pill tone-progress">{MODE_LABELS[detail.app.mode] || detail.app.mode}</span>
            <span className="app-status-pill tone-muted">{detail.app.source}</span>
            <span className="app-status-pill tone-muted">{detail.app.ownerName}</span>
            {detail.app.workspaceName && <span style={{fontSize: 12, color: '#64748b'}}>{detail.app.workspaceName}</span>}
          </div>

          {/* Tab 1: 模型使用分析 */}
          {subTab === 'models' && (
            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
              <div className="metric-grid four">
                <article className="metric-card">
                  <span>调用次数</span>
                  <strong>{detail.summary.calls.toLocaleString()}</strong>
                </article>
                <article className="metric-card">
                  <span>Token 消耗</span>
                  <strong>{detail.summary.tokens.toLocaleString()}</strong>
                </article>
                <article className="metric-card">
                  <span>平均耗时</span>
                  <strong>{detail.summary.avgLatencySec.toFixed(2)} s</strong>
                </article>
                <article className="metric-card">
                  <span>错误率</span>
                  <strong style={{color: detail.summary.errorRatePct > 5 ? '#b42318' : '#027a48'}}>
                    {detail.summary.errorRatePct.toFixed(1)}%
                  </strong>
                </article>
              </div>

              {/* 模型调用量分布 */}
              <div style={{border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, background: '#f8fafc'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
                  <strong style={{fontSize: 14}}>模型调用量分布</strong>
                  <span style={{fontSize: 12, color: '#64748b'}}>近 {detail.days} 日 · 共 {detail.models.length} 个模型</span>
                </div>
                {detail.models.length > 0 ? (
                  <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                    {detail.models.map(m => {
                      const pct = Math.max(4, Math.round((m.calls / maxModelCalls) * 100))
                      return (
                        <div key={`${m.model}-${m.provider}`} style={{display: 'grid', gridTemplateColumns: '180px 1fr 90px', alignItems: 'center', gap: 10, fontSize: 13}}>
                          <div style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                            <strong>{m.model}</strong> <span style={{color: '#64748b', fontSize: 11}}>{m.provider}</span>
                          </div>
                          <div style={{height: 10, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden'}}>
                            <div style={{width: `${pct}%`, height: '100%', background: '#2563eb', borderRadius: 999}} />
                          </div>
                          <div style={{textAlign: 'right', fontFamily: 'monospace', fontWeight: 600}}>{m.calls} 次</div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{fontSize: 13, color: '#64748b'}}>近 {detail.days} 日该应用暂无模型调用记录</div>
                )}
              </div>

              {/* 模型调用明细表（按调用量倒序） */}
              <div>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8}}>
                  <strong style={{fontSize: 14}}>模型调用明细</strong>
                  <span style={{fontSize: 12, color: '#64748b'}}>按调用量倒序</span>
                </div>
                <div className="org-table-wrap">
                  <table className="org-table">
                    <thead>
                      <tr>
                        <th>模型</th><th>供应商</th><th>调用次数</th><th>Token</th><th>平均耗时</th><th>错误率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.models.length > 0 ? detail.models.map(m => (
                        <tr key={`${m.model}-${m.provider}`}>
                          <td style={{fontWeight: 600}}>{m.model}</td>
                          <td><span className="app-status-pill tone-muted">{m.provider}</span></td>
                          <td style={{fontFamily: 'monospace', fontWeight: 600}}>{m.calls.toLocaleString()}</td>
                          <td style={{fontFamily: 'monospace'}}>{m.tokens.toLocaleString()}</td>
                          <td style={{fontFamily: 'monospace'}}>{m.avgLatencySec.toFixed(2)} s</td>
                          <td style={{fontFamily: 'monospace', color: m.errorRatePct > 5 ? '#b42318' : '#027a48', fontWeight: 600}}>
                            {m.errorRatePct.toFixed(1)}%
                          </td>
                        </tr>
                      )) : (
                        <tr><td colSpan={6} style={{textAlign: 'center', color: '#9ca3af', padding: '20px 0'}}>近 {detail.days} 日暂无模型调用明细</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: 调用 IP 与来源分析 */}
          {subTab === 'ips' && (
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16}}>
              <div style={{border: '1px solid #e5e7eb', borderRadius: 8, padding: 14}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
                  <strong style={{fontSize: 14}}>Dify 网关调用 IP 排行</strong>
                  <span style={{fontSize: 12, color: '#64748b'}}>
                    {detail.callerIps.available ? `来源：${detail.callerIps.containerName || 'docker-nginx-1'}` : 'Nginx 日志未采集'}
                  </span>
                </div>
                <div className="org-table-wrap">
                  <table className="org-table">
                    <thead><tr><th>调用 IP</th><th>请求次数</th><th>异常次数</th></tr></thead>
                    <tbody>
                      {(detail.callerIps.appIps.length > 0 ? detail.callerIps.appIps : detail.callerIps.gatewayIps).length > 0 ? (
                        (detail.callerIps.appIps.length > 0 ? detail.callerIps.appIps : detail.callerIps.gatewayIps).map(row => (
                          <tr key={row.ip}>
                            <td><code className="org-code">{row.ip}</code></td>
                            <td style={{fontFamily: 'monospace', fontWeight: 600}}>{row.count}</td>
                            <td style={{fontFamily: 'monospace', color: row.errors > 0 ? '#b42318' : '#64748b'}}>{row.errors}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={3} style={{textAlign: 'center', color: '#9ca3af', padding: '18px 0'}}>近期暂无 API/网关访问 IP 记录</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
                <div style={{border: '1px solid #e5e7eb', borderRadius: 8, padding: 14}}>
                  <strong style={{fontSize: 14, display: 'block', marginBottom: 10}}>
                    <Activity size={14} style={{marginRight: 4, verticalAlign: -2}} /> 调用来源渠道分布
                  </strong>
                  <div className="org-table-wrap">
                    <table className="org-table">
                      <thead><tr><th>来源渠道</th><th>调用次数</th></tr></thead>
                      <tbody>
                        {detail.sourceChannels.length > 0 ? detail.sourceChannels.map(s => (
                          <tr key={s.source}>
                            <td>{SOURCE_LABELS[s.source] || s.source}</td>
                            <td style={{fontFamily: 'monospace', fontWeight: 600}}>{s.count}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={2} style={{textAlign: 'center', color: '#9ca3af', padding: '14px 0'}}>暂无渠道调用统计</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{border: '1px solid #e5e7eb', borderRadius: 8, padding: 14}}>
                  <strong style={{fontSize: 14, display: 'block', marginBottom: 10}}>应用迭代版本记录</strong>
                  <div className="org-table-wrap">
                    <table className="org-table">
                      <thead><tr><th>版本</th><th>更新时间</th></tr></thead>
                      <tbody>
                        {detail.versions.length > 0 ? detail.versions.slice(0, 6).map((v, i) => (
                          <tr key={`${v.version}-${i}`}>
                            <td><code className="org-code">{v.version}</code></td>
                            <td style={{fontSize: 12, color: '#64748b'}}>{v.at ? new Date(v.at).toLocaleString('zh-CN', {hour12: false}) : '—'}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={2} style={{textAlign: 'center', color: '#9ca3af', padding: '14px 0'}}>暂无工作流版本记录</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: YAML 结构解析与 AI 作用分析 */}
          {subTab === 'dsl' && (
            <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
              {/* 静态 YAML 结构卡片 */}
              <div style={{border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, background: '#f8fafc'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10}}>
                  <strong style={{fontSize: 14}}>DSL 静态结构解析</strong>
                  <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                    <button type="button" className="secondary-button" onClick={() => setShowYaml(v => !v)}>
                      {showYaml ? '收起 YAML 原文' : '查看 YAML 原文'}
                    </button>
                    <button type="button" className="secondary-button" onClick={downloadYaml} style={{display: 'inline-flex', alignItems: 'center', gap: 4}}>
                      <Download size={13} /> 导出 YAML
                    </button>
                    {detail.aiReady ? (
                      <button type="button" className="primary-button" disabled={analyzing} onClick={runSingleAiAnalysis} style={{display: 'inline-flex', alignItems: 'center', gap: 4}}>
                        <Sparkles size={13} /> {analyzing ? 'AI 分析中…' : 'AI 分析应用作用'}
                      </button>
                    ) : (
                      <button type="button" className="primary-button" onClick={() => onNavigate?.('manual', 'CFG-04')}>
                        先通过 CFG-04 配置 AI 分析模型
                      </button>
                    )}
                  </div>
                </div>

                <div className="app-audit-metrics" style={{marginBottom: 10}}>
                  <div><span>编排节点数</span><strong>{detail.dsl.nodeCount}</strong></div>
                  <div><span>配置模型数</span><strong>{detail.dsl.models.length}</strong></div>
                  <div><span>挂载知识库</span><strong>{detail.dsl.datasetCount}</strong></div>
                  <div><span>外部工具/HTTP</span><strong>{detail.dsl.externalTools.length}</strong></div>
                </div>

                <div style={{fontSize: 12, color: '#334155', display: 'flex', flexDirection: 'column', gap: 4}}>
                  <div><strong>编排模型：</strong>{detail.dsl.models.length ? detail.dsl.models.join('、') : '未显式绑定'}</div>
                  <div><strong>外部工具与接口：</strong>{detail.dsl.externalTools.length ? detail.dsl.externalTools.join('；') : '无外部 HTTP/工具节点'}</div>
                  {detail.dsl.promptPreviews.length > 0 && (
                    <div><strong>提示词摘录：</strong>{detail.dsl.promptPreviews[0]}</div>
                  )}
                </div>

                {showYaml && (
                  <pre style={{marginTop: 10, padding: 12, background: '#0f172a', color: '#e2e8f0', borderRadius: 6, fontSize: 12, maxHeight: 280, overflow: 'auto'}}>
                    {detail.dsl.yamlText}
                  </pre>
                )}
              </div>

              {/* AI 深度功能分析报告 */}
              {detail.latestReport && (
                <div style={{border: '1px solid #bfdbfe', borderRadius: 8, padding: 14, background: '#eff6ff'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8}}>
                    <strong style={{fontSize: 14, color: '#1e3a8a'}}>
                      <Sparkles size={14} style={{marginRight: 4, verticalAlign: -2}} /> AI 功能作用分析报告
                    </strong>
                    <span style={{fontSize: 12, color: '#475569'}}>
                      模型：{detail.latestReport.model} · 耗时 {detail.latestReport.elapsedSec}s · {new Date(detail.latestReport.analyzedAt).toLocaleString('zh-CN', {hour12: false})}
                    </span>
                  </div>
                  <pre style={{margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.65, color: '#1e293b'}}>
                    {detail.latestReport.report}
                  </pre>
                </div>
              )}

              {/* 高频应用批量分析与报告导出 */}
              <div style={{border: '1px solid #e5e7eb', borderRadius: 8, padding: 14}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10}}>
                  <div>
                    <strong style={{fontSize: 14}}>高频应用批量 AI 作用分析与导出</strong>
                    <div style={{fontSize: 12, color: '#64748b'}}>按运行次数阈值扫描高频应用，使用 CFG-04 审批生效的大模型分批分析并导出汇总 CSV。</div>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <span style={{fontSize: 12, color: '#475569'}}>最低运行次数</span>
                    <input type="number" min={0} value={minRuns} onChange={e => setMinRuns(e.target.value)} style={{width: 80}} />
                    <button type="button" className="secondary-button" disabled={batchBusy} onClick={scanHighFreq}>
                      扫描高频应用
                    </button>
                    {highFreq.length > 0 && (
                      <button
                        type="button"
                        className="primary-button"
                        disabled={batchBusy || !detail.aiReady || selectedBatchIds.length === 0}
                        onClick={runBatchAiAnalysis}
                        style={{display: 'inline-flex', alignItems: 'center', gap: 4}}
                      >
                        <Play size={13} /> 批量分析已选 ({selectedBatchIds.length})
                      </button>
                    )}
                  </div>
                </div>

                {highFreq.length > 0 && (
                  <div className="org-table-wrap" style={{marginBottom: 12}}>
                    <table className="org-table">
                      <thead><tr><th style={{width: 44}}>选择</th><th>应用名称</th><th>模式</th><th>近{days}日运行</th><th>Token</th><th>所有者</th><th>分析状态</th></tr></thead>
                      <tbody>
                        {highFreq.slice(0, 20).map(a => (
                          <tr key={a.appId}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedBatchIds.includes(a.appId)}
                                onChange={e => setSelectedBatchIds(prev => e.target.checked ? [...prev, a.appId] : prev.filter(id => id !== a.appId))}
                              />
                            </td>
                            <td style={{fontWeight: 500}}>{a.appName}</td>
                            <td>{MODE_LABELS[a.mode] || a.mode}</td>
                            <td style={{fontFamily: 'monospace', fontWeight: 600}}>{a.runCount}</td>
                            <td style={{fontFamily: 'monospace'}}>{a.totalTokens.toLocaleString()}</td>
                            <td>{a.ownerName}</td>
                            <td>
                              <span className={`app-status-pill ${a.hasReport ? 'tone-success' : 'tone-muted'}`}>
                                {a.hasReport ? '已有报告' : '待分析'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tasks.length > 0 && (
                  <div className="org-table-wrap">
                    <table className="org-table">
                      <thead><tr><th>任务 ID</th><th>分析模型</th><th>总数 / 成功 / 失败</th><th>发起人</th><th>时间</th><th>导出</th></tr></thead>
                      <tbody>
                        {tasks.slice(0, 8).map(t => (
                          <tr key={t.taskId}>
                            <td><code className="org-code">{t.taskId}</code></td>
                            <td>{t.model}</td>
                            <td>{t.total} / {t.succeeded} / {t.failed}</td>
                            <td>{t.createdByName}</td>
                            <td style={{fontSize: 12, color: '#64748b'}}>{new Date(t.createdAt).toLocaleString('zh-CN', {hour12: false})}</td>
                            <td>
                              <a className="row-action" href={`/api/agent-insights/export?taskId=${encodeURIComponent(t.taskId)}`} download>
                                导出 CSV
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
