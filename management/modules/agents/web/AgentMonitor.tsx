import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Users, Bot, Layers3, Search, X } from 'lucide-react'

export type InvocationLog = {
  seq: number
  time: string
  ownerAccount: string
  ownerName: string
  ownerOrg: string
  appName: string
  appId: string
  appMode: string
  sourceIp: string
  caller: string
  models: string[]
  modelLabels: string[]
  knowledgeBases: string[]
  knowledgeLabels: string[]
  mcpCalls: string[]
  mcpLabels: string[]
  pluginCalls: string[]
  pluginLabels: string[]
  duration: string
  httpStatus: string
  result: '成功' | '失败'
  errorCode: string
  ticketNo?: string
}

export type AccountGroup = {
  account: string
  name: string
  org: string
  useCount: number
  apps: {
    name: string
    appId: string
    appMode: string
    inWarehouse: boolean
    useCount: number
  }[]
}

export type AgentMonitorModel = {
  asOf: string
  window: string
  metrics: {
    accountCount: number | null
    totalAppCount: number | null
    outsideAppCount: number
    callCount: number
    failedCallCount: number
  }
  sources: {
    difyCatalog: string
    invocations: string
  }
  accountGroups: AccountGroup[]
  filterOptions: {
    ipOptions: string[]
    modelOptions: string[]
    knowledgeOptions: string[]
    mcpOptions: string[]
    pluginOptions: string[]
  }
  logs: {
    total: number
    page: number
    pageSize: number
    items: InvocationLog[]
  }
  overview?: {
    difyAccountCount: number | null
    ragflowAccountCount: number | null
    difyAppCount: number | null
    warehouseAppCount: number
  }
  analysis?: {
    runDistribution: { label: string; count: number }[] | null
    callSeries: { hour: { label: string; count: number }[]; day: { label: string; count: number }[]; month: { label: string; count: number }[] } | null
    tokenDistribution: { label: string; count: number }[] | null
    tokenRanking: RankingRow[]
    modelCallRanking: RankingRow[]
    usage: null | {
      appId: string
      appName: string
      description: string | null
      iterationCount: number | null
      versions: { version: string; publishedAt?: string; at?: string }[]
      ipDistribution: { ip: string; count: number }[] | null
    }
  }
}

type RankingRow = {
  appId: string
  appName: string
  totalTokens: number | null
  totalCalls: number
  models: { model: string; calls: number; tokens: number }[]
}

function metricText(value: number | null | undefined) {
  return value === null || value === undefined ? '未采集' : String(value)
}

function displayList(items: string[], empty: string) {
  return items.length ? items.join('、') : <span className="empty-slot">{empty}</span>
}

function TraceSummary({ items, empty = '未使用' }: { items: string[]; empty?: string }) {
  if (!items.length) return <span className="trace-empty">— · {empty}</span>
  return (
    <ul className="trace-list">
      {items.map(item => <li key={item}>{item}</li>)}
    </ul>
  )
}

function InvocationTrace({ log, onClose }: { log: InvocationLog; onClose: () => void }) {
  return (
    <aside className="trace-details" data-testid="invocation-trace">
      <div className="trace-details-head">
        <div>
          <span className="mini-label">调用溯源</span>
          <h4>{log.appName} <em>序号 {log.seq}</em></h4>
          <p>{log.time} · {log.ownerName} · {log.ownerAccount} · {log.sourceIp}</p>
        </div>
        <div>
          <span className={`status ${log.result === '成功' ? 'success' : 'danger'}`}>{log.result}</span>
          <button aria-label="关闭调用详情" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div className="trace-details-grid">
        <section>
          <h5>这次调用</h5>
          <dl>
            <div><dt>账户</dt><dd>{log.ownerName} · {log.ownerAccount}</dd></div>
            <div><dt>组织</dt><dd>{log.ownerOrg}</dd></div>
            <div><dt>智能体应用</dt><dd>{log.appName} · {log.appMode}</dd></div>
            <div><dt>调用 IP</dt><dd>{log.sourceIp}</dd></div>
            <div><dt>调用方</dt><dd>{log.caller}</dd></div>
          </dl>
        </section>
        <section>
          <h5>结果</h5>
          <dl>
            <div><dt>应用 ID</dt><dd>{log.appId}</dd></div>
            <div><dt>耗时</dt><dd>{log.duration}</dd></div>
            <div><dt>HTTP 状态</dt><dd>{log.httpStatus}</dd></div>
            <div><dt>错误码</dt><dd>{log.errorCode}</dd></div>
          </dl>
        </section>
        <section className="trace-resource-detail">
          <h5>本次实际使用</h5>
          <div><strong>模型</strong><TraceSummary items={log.models} /></div>
          <div><strong>知识库</strong><TraceSummary items={log.knowledgeBases} empty="未使用知识库" /></div>
          <div><strong>MCP</strong><TraceSummary items={log.mcpCalls} empty="未调用 MCP" /></div>
          <div><strong>插件</strong><TraceSummary items={log.pluginCalls} empty="未调用插件" /></div>
        </section>
      </div>
    </aside>
  )
}

export function AgentMonitor({
  onWorkOrder: _onWorkOrder,
}: {
  role: 'user' | 'ops' | 'admin'
  onWorkOrder?: (title: string) => void
}) {
  const [account, setAccount] = useState('全部账户')
  const [appName, setAppName] = useState('全部应用')
  const [ip, setIp] = useState('全部 IP')
  const [model, setModel] = useState('全部模型')
  const [knowledge, setKnowledge] = useState('全部知识库')
  const [mcp, setMcp] = useState('全部 MCP')
  const [plugin, setPlugin] = useState('全部插件')
  const [keyword, setKeyword] = useState('')
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [usageApp, setUsageApp] = useState('')
  const [usageFrom, setUsageFrom] = useState('')
  const [usageTo, setUsageTo] = useState('')
  const [callGrain, setCallGrain] = useState<'hour' | 'day' | 'month'>('hour')
  const [tokenModel, setTokenModel] = useState('全部模型')
  const [callModel, setCallModel] = useState('全部模型')
  const [data, setData] = useState<AgentMonitorModel | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (account !== '全部账户') params.set('account', account)
    if (appName !== '全部应用') params.set('appName', appName)
    if (ip !== '全部 IP') params.set('ip', ip)
    if (model !== '全部模型') params.set('model', model)
    if (knowledge !== '全部知识库') params.set('knowledge', knowledge)
    if (mcp !== '全部 MCP') params.set('mcp', mcp)
    if (plugin !== '全部插件') params.set('plugin', plugin)
    if (keyword.trim()) params.set('q', keyword.trim())
    if (usageApp) params.set('usageApp', usageApp)
    if (usageFrom) params.set('usageFrom', new Date(usageFrom).toISOString())
    if (usageTo) params.set('usageTo', new Date(usageTo).toISOString())
    params.set('page', String(page))
    params.set('pageSize', '20')

    fetch(`/api/agent-monitor?${params.toString()}`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(res.status === 403 ? '无权限查看智能体监控' : '获取智能体监控数据失败')
        return res.json()
      })
      .then((json: AgentMonitorModel) => {
        if (!controller.signal.aborted) {
          setData(json)
          setError(null)
        }
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) {
          setError(err.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [account, appName, ip, model, knowledge, mcp, plugin, keyword, page, usageApp, usageFrom, usageTo])

  const groups = data?.accountGroups ?? []
  const appTotal = groups.reduce((sum, group) => sum + group.apps.length, 0)
  const accountApps = account === '全部账户'
    ? groups.flatMap(group => group.apps.map(app => app.name))
    : groups.find(group => group.account === account)?.apps.map(app => app.name) ?? []

  const ipOptions = data?.filterOptions?.ipOptions ?? []
  const modelOptions = data?.filterOptions?.modelOptions ?? []
  const knowledgeOptions = data?.filterOptions?.knowledgeOptions ?? []
  const mcpOptions = data?.filterOptions?.mcpOptions ?? []
  const pluginOptions = data?.filterOptions?.pluginOptions ?? []

  const logs = data?.logs?.items ?? []
  const totalLogs = data?.logs?.total ?? 0
  const selectedLog = logs.find(log => log.seq === selectedSeq) ?? null

  const chooseAccount = (next: string) => {
    setAccount(next)
    setAppName('全部应用')
    setSelectedSeq(null)
    setPage(1)
  }

  const chooseApp = (owner: string, name: string) => {
    setAccount(owner)
    setAppName(name)
    setSelectedSeq(null)
    setPage(1)
  }

  const clearFilters = () => {
    setAccount('全部账户')
    setAppName('全部应用')
    setIp('全部 IP')
    setModel('全部模型')
    setKnowledge('全部知识库')
    setMcp('全部 MCP')
    setPlugin('全部插件')
    setKeyword('')
    setSelectedSeq(null)
    setPage(1)
  }

  return (
    <div data-testid="agent-monitor">
      {/* 头部与角色标识 */}
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Dify 全量</span>
          <h1 className="page-title">智能体监控</h1>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert" style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* 四大指标卡 */}
      <div className="metric-grid four" data-testid="agent-metric-grid">
        <article className="metric-card"><div className="metric-icon tone-1"><Users size={19} /></div><span>Dify 账户数量</span><strong>{metricText(data?.overview?.difyAccountCount ?? (data?.sources.difyCatalog === 'collected' ? data.metrics.accountCount : null))}</strong><small>Dify 上有应用的账户</small></article>
        <article className="metric-card"><div className="metric-icon tone-2"><Users size={19} /></div><span>RAGFlow 账户数量</span><strong>{metricText(data?.overview?.ragflowAccountCount)}</strong><small>RAGFlow 账户目录</small></article>
        <article className="metric-card"><div className="metric-icon tone-3"><Bot size={19} /></div><span>Dify 应用数量</span><strong>{metricText(data?.overview?.difyAppCount ?? (data?.sources.difyCatalog === 'collected' ? data.metrics.totalAppCount : null))}</strong><small>子系统内全部应用</small></article>
        <article className="metric-card"><div className="metric-icon tone-4"><Layers3 size={19} /></div><span>仓库应用数量</span><strong>{data ? data.overview?.warehouseAppCount ?? 0 : '—'}</strong><small>已进入智能体仓库</small></article>
      </div>
      <AgentAnalysis data={data} groups={groups} usageApp={usageApp} setUsageApp={setUsageApp} usageFrom={usageFrom} setUsageFrom={setUsageFrom} usageTo={usageTo} setUsageTo={setUsageTo} callGrain={callGrain} setCallGrain={setCallGrain} tokenModel={tokenModel} setTokenModel={setTokenModel} callModel={callModel} setCallModel={setCallModel} />

      {/* 监控主体布局 */}
      <div className="monitor-layout">
        {/* 左侧账户 / 应用树 */}
        <aside className="panel account-tree" data-testid="account-tree">
          <div className="panel-title">
            <div>
              <h3>账户 / 应用</h3>
              
            </div>
          </div>
          <button className={`account-all ${account === '全部账户' ? 'active' : ''}`} onClick={() => chooseAccount('全部账户')}>
            <strong>全部账户</strong>
            <em>{appTotal} 个应用</em>
          </button>
          {groups.map(group => (
            <div key={group.account} className="account-block">
              <button className={account === group.account && appName === '全部应用' ? 'active' : ''} onClick={() => chooseAccount(group.account)}>
                <span>{group.name.slice(0, 1)}</span>
                <span><strong>{group.name}</strong><small>{group.account} · {group.org}</small></span>
                <em>{group.apps.length} 个应用</em>
              </button>
              {group.apps.map(app => (
                <button
                  key={app.name}
                  className={`app-node ${account === group.account && appName === app.name ? 'active' : ''}`}
                  onClick={() => chooseApp(group.account, app.name)}
                >
                  <strong>{app.name}</strong>
                  <small>{app.inWarehouse ? '工单应用' : '仅 Dify'}</small>
                  <em>{app.useCount} 次</em>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* 右侧调用审计日志 */}
        <section className="panel table-panel log-panel">
          <div className="panel-title">
            <div>
              <h3>所有应用调用记录明细</h3>
              
            </div>
            <button className="secondary-button compact" onClick={clearFilters}>清空筛选</button>
          </div>
          <div className="log-filters">
            <label className="catalog-search log-search">
              <Search size={16} />
              <input
                data-testid="log-search"
                value={keyword}
                onChange={event => { setKeyword(event.target.value); setPage(1) }}
                placeholder="搜索账户、应用、IP、模型、知识库、MCP 或插件"
              />
            </label>
            <label className="log-filter">
              <span>账户</span>
              <select data-testid="log-account" value={account} onChange={event => chooseAccount(event.target.value)}>
                <option>全部账户</option>
                {groups.map(group => (
                  <option key={group.account} value={group.account}>{group.name} · {group.account}</option>
                ))}
              </select>
            </label>
            <label className="log-filter">
              <span>智能体应用</span>
              <select
                data-testid="log-app"
                value={appName}
                onChange={event => { setAppName(event.target.value); setSelectedSeq(null); setPage(1) }}
              >
                <option>全部应用</option>
                {Array.from(new Set(accountApps)).map(name => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="log-filter">
              <span>调用 IP</span>
              <select value={ip} onChange={event => { setIp(event.target.value); setPage(1) }}>
                <option>全部 IP</option>
                {ipOptions.map(item => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="log-filter">
              <span>模型</span>
              <select value={model} onChange={event => { setModel(event.target.value); setPage(1) }}>
                <option>全部模型</option>
                {modelOptions.map(item => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="log-filter">
              <span>知识库</span>
              <select value={knowledge} onChange={event => { setKnowledge(event.target.value); setPage(1) }}>
                <option>全部知识库</option>
                {knowledgeOptions.map(item => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="log-filter">
              <span>MCP</span>
              <select value={mcp} onChange={event => { setMcp(event.target.value); setPage(1) }}>
                <option>全部 MCP</option>
                {mcpOptions.map(item => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="log-filter">
              <span>插件</span>
              <select value={plugin} onChange={event => { setPlugin(event.target.value); setPage(1) }}>
                <option>全部插件</option>
                {pluginOptions.map(item => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="log-count" data-testid="log-count">
            当前 {totalLogs} 条{account !== '全部账户' ? ` · ${groups.find(group => group.account === account)?.name}` : ''}{appName !== '全部应用' ? ` · ${appName}` : ''}
          </div>
          <div className="table-wrap log-wrap" data-testid="invocation-log">
            <table className="log-table">
              <thead>
                <tr>
                  <th>序号</th>
                  <th>账户</th>
                  <th>智能体应用</th>
                  <th>调用 IP</th>
                  <th>模型</th>
                  <th>知识库</th>
                  <th>MCP</th>
                  <th>插件</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr>
                    <td className="log-empty" colSpan={9}>
                      {loading ? '正在加载数据...' : '没有符合筛选条件的调用。'}
                    </td>
                  </tr>
                )}
                {logs.map(log => (
                  <tr
                    key={log.seq}
                    className={`${log.seq === selectedSeq ? 'selected' : ''} ${log.result === '失败' ? 'failed' : ''}`}
                    onClick={() => setSelectedSeq(log.seq)}
                  >
                    <td className="nowrap">{log.seq}</td>
                    <td><b>{log.ownerName}</b><small>{log.ownerAccount}</small></td>
                    <td className="strong-cell">{log.appName}</td>
                    <td className="mono-cell nowrap">{log.sourceIp}</td>
                    <td>{displayList(log.modelLabels, '未使用')}</td>
                    <td>{displayList(log.knowledgeLabels, '未使用')}</td>
                    <td>{displayList(log.mcpLabels, '未使用')}</td>
                    <td>{displayList(log.pluginLabels, '未使用')}</td>
                    <td>
                      <button
                        className="row-action"
                        onClick={event => {
                          event.stopPropagation()
                          setSelectedSeq(log.seq)
                        }}
                      >
                        溯源
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedLog && <InvocationTrace log={selectedLog} onClose={() => setSelectedSeq(null)} />}
        </section>
      </div>
    </div>
  )
}

function rankedValue(row: RankingRow, model: string, field: 'tokens' | 'calls') {
  if (model === '全部模型') return field === 'tokens' ? row.totalTokens : row.totalCalls
  const found = row.models.find(item => item.model === model)
  return found ? found[field] : 0
}

function AgentAnalysis({
  data, groups, usageApp, setUsageApp, usageFrom, setUsageFrom, usageTo, setUsageTo, callGrain, setCallGrain, tokenModel, setTokenModel, callModel, setCallModel,
}: {
  data: AgentMonitorModel | null
  groups: AccountGroup[]
  usageApp: string
  setUsageApp: (value: string) => void
  usageFrom: string
  setUsageFrom: (value: string) => void
  usageTo: string
  setUsageTo: (value: string) => void
  callGrain: 'hour' | 'day' | 'month'
  setCallGrain: (value: 'hour' | 'day' | 'month') => void
  tokenModel: string
  setTokenModel: (value: string) => void
  callModel: string
  setCallModel: (value: string) => void
}) {
  const analysis = data?.analysis
  const apps = groups.flatMap(group => group.apps)
  const models = [...new Set((analysis?.tokenRanking ?? analysis?.modelCallRanking ?? []).flatMap(row => row.models.map(item => item.model)))]
  const callSeries = analysis?.callSeries?.[callGrain] ?? null
  const tokenRows = [...(analysis?.tokenRanking ?? [])].sort((a, b) => (rankedValue(b, tokenModel, 'tokens') ?? 0) - (rankedValue(a, tokenModel, 'tokens') ?? 0))
  const callRows = [...(analysis?.modelCallRanking ?? [])].sort((a, b) => (rankedValue(b, callModel, 'calls') ?? 0) - (rankedValue(a, callModel, 'calls') ?? 0))
  return (
    <>
      <section className="panel" data-testid="agent-run-analysis" style={{ marginTop: 16 }}>
        <div className="panel-title"><div><h3>智能体次数分析</h3><p>运行数量按应用累计调用次数分档。调用趋势按北京时间统计每小时、每天和每月。</p></div></div>
        {analysis?.runDistribution ? (
          <div style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={analysis.runDistribution}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="应用数量" fill="#6366f1" /></BarChart></ResponsiveContainer></div>
        ) : <p>调用次数未采集，暂不能划分 10万及以上、5万～10万、1万～5万、小于1万。</p>}
        <div className="usable-switch" style={{ margin: '12px 0' }}>
          {([['hour', '每小时'], ['day', '每天'], ['month', '每月']] as const).map(([key, label]) => <button key={key} type="button" className={callGrain === key ? 'active' : ''} onClick={() => setCallGrain(key)}>{label}</button>)}
        </div>
        {callSeries ? (
          <div style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={callSeries}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} /><Tooltip /><Line dataKey="count" name="调用次数" stroke="#5b6cf9" dot={false} /></LineChart></ResponsiveContainer></div>
        ) : <p>每小时、每天、每月调用次数未采集。</p>}
      </section>
      <section className="panel" data-testid="agent-usage-analysis" style={{ marginTop: 16 }}>
        <div className="panel-title"><div><h3>智能体应用使用情况分析</h3><p>选择一个应用和时间范围后，查看调用 IP、应用介绍、迭代次数和版本时间。</p></div></div>
        <div className="log-filters">
          <label className="log-filter"><span>智能体应用</span>
            <select aria-label="分析指定智能体" value={usageApp} onChange={event => setUsageApp(event.target.value)}>
              <option value="">请选择应用</option>
              {apps.map(app => <option key={app.appId} value={app.appId}>{app.name}</option>)}
            </select>
          </label>
          <label className="log-filter"><span>开始时间</span><input aria-label="使用分析开始时间" type="datetime-local" value={usageFrom} onChange={event => setUsageFrom(event.target.value)} /></label>
          <label className="log-filter"><span>结束时间</span><input aria-label="使用分析结束时间" type="datetime-local" value={usageTo} onChange={event => setUsageTo(event.target.value)} /></label>
        </div>
        {!analysis?.usage ? <p>请选择智能体应用。</p> : (
          <div>
            <p>应用介绍 · {analysis.usage.description ?? '未采集'}</p>
            <p>迭代次数 · {metricText(analysis.usage.iterationCount)}</p>
            <div className="table-wrap"><table><thead><tr><th>迭代版本</th><th>时间</th></tr></thead><tbody>{analysis.usage.versions.length ? analysis.usage.versions.map(version => <tr key={version.version}><td>{version.version}</td><td>{version.publishedAt || version.at || '未采集'}</td></tr>) : <tr><td colSpan={2}>迭代版本未采集</td></tr>}</tbody></table></div>
            {analysis.usage.ipDistribution ? (
              <div className="table-wrap"><table><thead><tr><th>调用 IP</th><th>次数</th></tr></thead><tbody>{analysis.usage.ipDistribution.length ? analysis.usage.ipDistribution.map(row => <tr key={row.ip}><td>{row.ip}</td><td>{row.count}</td></tr>) : <tr><td colSpan={2}>所选时间范围内没有调用 IP</td></tr>}</tbody></table></div>
            ) : <p>调用 IP 分布未采集。</p>}
          </div>
        )}
      </section>
      <section className="panel" data-testid="agent-token-analysis" style={{ marginTop: 16 }}>
        <div className="panel-title"><div><h3>智能体使用 token 数量分析</h3><p>按 token 区间统计应用数量，并分别按总消耗和指定模型查看 token 与调用次数排行。</p></div></div>
        {analysis?.tokenDistribution ? (
          <div style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={analysis.tokenDistribution}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="应用数量" fill="#0f766e" /></BarChart></ResponsiveContainer></div>
        ) : <p>token 消耗未采集，暂不能划分区间。</p>}
        <RankingTable title="token 消耗排行" rows={tokenRows} model={tokenModel} setModel={setTokenModel} models={models} field="tokens" />
        <RankingTable title="模型调用次数排行" rows={callRows} model={callModel} setModel={setCallModel} models={models} field="calls" />
      </section>
    </>
  )
}

function RankingTable({ title, rows, model, setModel, models, field }: { title: string; rows: RankingRow[]; model: string; setModel: (value: string) => void; models: string[]; field: 'tokens' | 'calls' }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="panel-title"><h3>{title}</h3>
        <label className="log-filter"><span>模型</span>
          <select aria-label={title + '模型筛选'} value={model} onChange={event => setModel(event.target.value)}>
            <option>全部模型</option>
            {models.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <div className="table-wrap"><table><thead><tr><th>智能体应用</th><th>{field === 'tokens' ? 'token 数' : '调用次数'}</th><th>模型明细</th></tr></thead><tbody>
        {rows.length ? rows.map(row => {
          const value = rankedValue(row, model, field)
          return <tr key={row.appId || row.appName}><td>{row.appName}</td><td>{value === null ? '未采集' : value}</td><td>{row.models.map(item => `${item.model} ${field === 'tokens' ? item.tokens : item.calls}`).join('、') || '未采集'}</td></tr>
        }) : <tr><td colSpan={3}>未采集</td></tr>}
      </tbody></table></div>
    </div>
  )
}
