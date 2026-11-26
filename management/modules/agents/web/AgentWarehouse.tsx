import { useEffect, useState } from 'react'
import {
  Bot, ChevronRight, Code2, Copy, History, Play,
  Search, Tag, Terminal, Trophy, ArrowUpRight, ShieldAlert
} from 'lucide-react'

type Role = 'user' | 'ops' | 'admin'
type UsageMethodId = 'run' | 'embed' | 'api'

type AgentRelease = {
  version: string
  publishedAt: string
  changedAt: string
  summary: string
  ticket: string
}

type WarehouseAgentItem = {
  id: string
  name: string
  emoji: string
  developer: string
  developerAccount: string
  org: string
  description: string
  tags: string[]
  directlyUsable: boolean
  methods: UsageMethodId[]
  unavailableReason: string
  visibleOrgs: string[]
  mode: string
  runUrl?: string
  apiBaseUrl?: string
  successCount: number
  releases: AgentRelease[]
}

type AgentWarehouseData = {
  asOf: string
  role: Role
  org: string
  metrics: {
    total: number
    usableCount: number
    fullMethodCount: number
    runCount: number
    apiCount: number
    unavailableCount: number
  }
  tags: string[]
  ranking: {
    id: string
    name: string
    developer: string
    org: string
    count: number
  }[]
  items: WarehouseAgentItem[]
}

const usageMethodCatalog: { id: UsageMethodId; label: string; hint: string }[] = [
  { id: 'run', label: '运行', hint: '在平台内直接以 Web 形式交互运行' },
  { id: 'embed', label: '嵌入网站', hint: '生成 iframe 代码嵌入内部业务系统' },
  { id: 'api', label: '访问 API', hint: '通过后端 API 接口发起调用并读取响应' },
]

export function AgentWarehouse({
  role,
  onWorkOrder,
}: {
  role: Role
  onWorkOrder?: (title: string) => void
}) {
  const [data, setData] = useState<AgentWarehouseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [keyword, setKeyword] = useState('')
  const [tag, setTag] = useState('全部标签')
  const [method, setMethod] = useState<'全部方式' | UsageMethodId>('全部方式')
  const [usable, setUsable] = useState<'全部' | '可直接使用' | '暂不可用' | '三种方式齐全'>('全部')
  const [selectedId, setSelectedId] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let active = true
    const params = new URLSearchParams()
    if (keyword.trim()) params.set('q', keyword.trim())
    if (tag !== '全部标签') params.set('tag', tag)
    if (method !== '全部方式') params.set('method', method)
    if (usable !== '全部') params.set('usable', usable)

    fetch(`/api/agent-warehouse?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('读取智能体仓库失败')
        return res.json()
      })
      .then((json: AgentWarehouseData) => {
        if (!active) return
        setData(json)
        setError(null)
        if (!selectedId && json.items.length > 0) {
          setSelectedId(json.items[0].id)
        }
      })
      .catch((err: Error) => {
        if (active) setError(err.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [keyword, tag, method, usable, selectedId])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(''), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  const items = data?.items ?? []
  const metrics = data?.metrics ?? {
    total: 0,
    usableCount: 0,
    fullMethodCount: 0,
    runCount: 0,
    apiCount: 0,
    unavailableCount: 0,
  }
  const ranking = data?.ranking ?? []
  const tags = data?.tags ?? []

  const maxUse = Math.max(...ranking.map((r) => r.count), 1)
  const selected = items.find((agent) => agent.id === selectedId) ?? items[0]

  const focusAgent = (id: string) => {
    setKeyword('')
    setTag('全部标签')
    setMethod('全部方式')
    setUsable('全部')
    setSelectedId(id)
  }

  const copyAccess = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(key)
  }

  const accessText = (agent: WarehouseAgentItem, methodId: UsageMethodId) => {
    const runUrl = agent.runUrl || `${window.location.protocol}//${window.location.hostname}/app/${agent.id}/overview`
    const apiBase = agent.apiBaseUrl || `${window.location.protocol}//${window.location.hostname}/v1`
    if (methodId === 'run') return runUrl
    if (methodId === 'embed') return `<iframe src="${runUrl}" width="100%" height="600" frameborder="0"></iframe>`
    return `curl -X POST ${apiBase}/chat-messages -H "Authorization: Bearer app-xxxx" -H "Content-Type: application/json" -d '{"inputs":{},"query":"你好","response_mode":"blocking","user":"demo"}'`
  }

  return (
    <div data-testid="warehouse-page">
      <header className="page-header">
        <div>
          <span className="page-eyebrow">工单应用 · 智能体目录</span>
          <h1 className="page-title">智能体仓库</h1>
        </div>
        <div className="warehouse-kpi-strip" data-testid="agent-warehouse-kpis">
          <div className="warehouse-kpi-pill">
            <Bot size={15} />
            <span>可用应用</span>
            <strong>{metrics.total}</strong>
          </div>
          <div className="warehouse-kpi-pill">
            <Play size={15} />
            <span>可运行</span>
            <strong>{metrics.runCount}</strong>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert" style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* 使用排行榜 */}
      <section className="panel ranking-panel" data-testid="usage-ranking">
        <div className="panel-title">
          <div>
            <h3><Trophy size={15} /> {role === 'user' ? '可用条目使用排行' : '使用排行榜'}</h3>
            <p>按成功调用次数排序</p>
          </div>
        </div>
        <div className="ranking-list">
          {ranking.map((item, index) => {
            const count = item.count
            return (
              <button
                key={item.id}
                type="button"
                className={selected?.id === item.id ? 'active' : ''}
                onClick={() => focusAgent(item.id)}
              >
                <b>{index + 1}</b>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.developer} · {item.org}</small>
                </span>
                <i><em style={{ width: `${Math.max(8, Math.round((count / maxUse) * 100))}%` }} /></i>
                <em>{count} 次</em>
                <ChevronRight size={14} />
              </button>
            )
          })}
        </div>
      </section>

      {/* 工具栏：搜索、可用性与方式筛选 */}
      <div className="warehouse-toolbar">
        <label className="catalog-search warehouse-search">
          <Search size={16} />
          <input
            data-testid="warehouse-search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索名称、开发人员、简介或标签"
          />
        </label>
        <div className="usable-switch" data-testid="warehouse-usable">
          {(['全部', '可直接使用', '暂不可用'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={usable === item ? 'active' : ''}
              onClick={() => setUsable(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <select
          className="warehouse-method"
          aria-label="使用方式"
          data-testid="warehouse-method"
          value={method}
          onChange={(event) => setMethod(event.target.value as '全部方式' | UsageMethodId)}
        >
          <option value="全部方式">使用方式</option>
          {usageMethodCatalog.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>

      {/* 标签栏 */}
      <div className="tag-row">
        <Tag size={14} />
        <button
          type="button"
          className={tag === '全部标签' ? 'active' : ''}
          onClick={() => setTag('全部标签')}
        >
          全部标签
        </button>
        {tags.map((item) => (
          <button
            key={item}
            type="button"
            className={tag === item ? 'active' : ''}
            onClick={() => setTag(item)}
          >
            {item}
          </button>
        ))}
        <em>当前 {items.length} 个</em>
      </div>

      {/* 内嵌可滑动 Dify 风格矩形图标块展示区与右侧详情 */}
      <div className="warehouse-layout">
        <div className="dify-catalog-scroll">
          <div className="dify-tile-grid" data-testid="agent-grid">
            {items.length === 0 && (
              <div className="agent-empty">
                {loading ? '正在加载智能体仓库...' : '没有符合当前筛选的智能体。'}
              </div>
            )}
            {items.map((agent) => {
              const current = agent.releases[0]
              const count = agent.successCount ?? 0
              const badgeClass = agent.directlyUsable ? 'usable' : 'pending'
              const badgeText = agent.directlyUsable ? '可使用' : '待申请'
              return (
                <article
                  key={agent.id}
                  role="button"
                  tabIndex={0}
                  data-testid={`agent-card-${agent.id}`}
                  className={`dify-tile-card ${selected?.id === agent.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(agent.id)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(agent.id) } }}
                >
                  <div className="dify-tile-head">
                    <span className="dify-tile-icon tone-agent">{agent.emoji || <Bot size={20} />}</span>
                    <div className="dify-tile-title">
                      <strong>{agent.name}</strong>
                      <small>{agent.developer} · {current?.version ?? agent.mode}</small>
                    </div>
                    <span className={`dify-status-badge ${badgeClass}`}>{badgeText}</span>
                  </div>
                  <p className="dify-tile-desc">{agent.description || '暂无简介'}</p>
                  <div className="dify-tile-foot">
                    <div className="dify-tile-tags">
                      {usageMethodCatalog.filter((m) => agent.methods.includes(m.id)).map((m) => {
                        const Icon = m.id === 'run' ? Play : m.id === 'embed' ? Code2 : Terminal
                        return <span key={m.id} className="dify-tile-tag"><Icon size={11} />{m.label}</span>
                      })}
                      {agent.methods.length === 0 && <span className="dify-tile-tag">待开通方式</span>}
                    </div>
                    <b>{count} 次</b>
                  </div>
                </article>
              )
            })}
          </div>
        </div>

        {/* 详情抽屉/侧边栏 */}
        {selected && (
          <aside className="panel agent-detail" data-testid="agent-detail">
            <div className="agent-detail-head">
              <span className="agent-emoji">{selected.emoji}</span>
              <div>
                <span className="mini-label">{selected.mode} · {selected.developer}</span>
                <h3>{selected.name}</h3>
                <p>{selected.description}</p>
              </div>
            </div>

            {/* 运维/管理员快捷工单动作 */}
            {role !== 'user' && onWorkOrder && (
              <div style={{ display: 'flex', gap: 8, margin: '12px 0', padding: '10px 12px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                {selected.directlyUsable ? (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, color: '#dc2626' }}
                    onClick={() => onWorkOrder(`AG-05 · 申请下架 ${selected.name} (${selected.id})`)}
                  >
                    <ShieldAlert size={14} /> 发起下架 (AG-05)
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, color: '#2563eb' }}
                    onClick={() => onWorkOrder(`AG-04 · 申请再发布 ${selected.name} (${selected.id})`)}
                  >
                    <ArrowUpRight size={14} /> 发起再发布 (AG-04)
                  </button>
                )}
              </div>
            )}

            <div className="agent-tags">
              {selected.tags.map((item) => <span key={item}>{item}</span>)}
            </div>

            <div className="detail-block">
              <h4>使用方式</h4>
              
              {!selected.directlyUsable && (
                <div className="method-block-note">{selected.unavailableReason}</div>
              )}
              {usageMethodCatalog.map((item) => {
                const opened = selected.methods.includes(item.id)
                const text = accessText(selected, item.id)
                const Icon = item.id === 'run' ? Play : item.id === 'embed' ? Code2 : Terminal
                const copyKey = `${selected.id}-${item.id}`
                return (
                  <div
                    key={item.id}
                    className={`method-block ${opened ? 'on' : 'off'}`}
                    data-testid={`method-${item.id}`}
                  >
                    <div>
                      <Icon size={15} />
                      <strong>{item.label}</strong>
                      <em>{opened ? '已开通' : '未开通'}</em>
                    </div>
                    <p>{item.hint}</p>
                    {opened ? (
                      <code>{text}</code>
                    ) : (
                      <small>{selected.unavailableReason || '发布工单没有开通这一方式。'}</small>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      {item.id === 'run' && opened && (
                        <a
                          href={text}
                          target="_blank"
                          rel="noreferrer"
                          className="primary-button compact"
                          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <ArrowUpRight size={13} /> 打开使用
                        </a>
                      )}
                      <button
                        type="button"
                        className="secondary-button compact"
                        disabled={!opened}
                        onClick={() => copyAccess(copyKey, text)}
                      >
                        <Copy size={13} /> {copied === copyKey ? '已复制' : '复制地址'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="detail-block">
              <h4><History size={14} /> 迭代记录</h4>
              
              <div className="table-wrap">
                <table className="release-table" data-testid="release-table">
                  <thead>
                    <tr>
                      <th>版本号</th>
                      <th>发布时间</th>
                      <th>更改时间</th>
                      <th>变更说明</th>
                      {role !== 'user' && <th>工单</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.releases.map((release, index) => (
                      <tr key={release.version} data-testid="release-row">
                        <td>
                          {release.version}
                          {index === 0 && <i>当前</i>}
                        </td>
                        <td>{release.publishedAt}</td>
                        <td>{release.changedAt}</td>
                        <td>{release.summary}</td>
                        {role !== 'user' && (
                          <td>
                            {onWorkOrder && release.ticket ? (
                              <button
                                type="button"
                                className="row-action"
                                style={{ padding: '2px 6px', fontSize: 11 }}
                                onClick={() => onWorkOrder(`智能体工单 · ${release.ticket}`)}
                              >
                                {release.ticket}
                              </button>
                            ) : (
                              release.ticket || '—'
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
