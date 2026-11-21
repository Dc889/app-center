import { useEffect, useState } from 'react'
import { Users, Bot, Layers3, Activity, Search, X } from 'lucide-react'

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
          <p>{log.time} · {log.ownerName}（{log.ownerAccount}）· {log.sourceIp}</p>
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
  }, [account, appName, ip, model, knowledge, mcp, plugin, keyword, page])

  const groups = data?.accountGroups ?? []
  const appTotal = groups.reduce((sum, group) => sum + group.apps.length, 0)
  const outsideCount = groups.reduce((sum, group) => sum + group.apps.filter(app => !app.inWarehouse).length, 0)
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
      <div className="metric-grid four">
        <article className="metric-card">
          <div className="metric-icon tone-1"><Users size={19} /></div>
          <span>Dify 账户</span>
          <strong>{data?.metrics.accountCount ?? groups.length}</strong>
          <small>有应用的开发账户</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon tone-2"><Bot size={19} /></div>
          <span>全部应用</span>
          <strong>{data?.metrics.totalAppCount ?? appTotal}</strong>
          <small>含未走工单的应用</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon tone-3"><Layers3 size={19} /></div>
          <span>未进仓库</span>
          <strong>{data?.metrics.outsideAppCount ?? outsideCount}</strong>
          <small>只存在于 Dify</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon tone-5"><Activity size={19} /></div>
          <span>调用记录</span>
          <strong>{data?.metrics.callCount ?? totalLogs}</strong>
          <small>当前样本可逐条溯源</small>
        </article>
      </div>

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
              <h3>调用记录</h3>
              
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
