import {useEffect, useState} from 'react'
import {
  ArrowRight, Bot, Building2, CheckCircle2, Clock, Cpu, Database, Edit3,
  KeyRound, Mail, Network, PlugZap, ShieldCheck, Sparkles, UserCheck,
} from 'lucide-react'
import type {View} from '../../../shared-ui/UiContextData'

type ProfileModel = {
  capturedAt: string
  syncedAt: string | null
  profile: {
    subjectId: string
    account: string
    email: string
    name: string
    org: string
    businessLine: string
    roles: string[]
    active: boolean
    authSource: 'dify' | 'local'
    difyAccountId: string | null
    difyWorkspaceId: string | null
    difyWorkspaceName: string | null
    ragflowPermission: string
    difyRole: string
    expiresAt: string | null
  }
  assets: {
    appsCount: number
    datasetsCount: number
    pluginsCount: number
    mcpCount: number
    apiKeysCount: number
    recentApps: {id: string; name: string; mode: string}[]
    recentDatasets: {id: string; name: string; documentCount: number}[]
  }
  ticketStats: {total: number; pending: number; completed: number; rejected: number}
  models: {
    key: string
    workspaceId: string
    workspaceName: string
    providerName: string
    modelName: string
    modelType: string
    enabled: boolean
    period: 'monthly' | 'total'
    usedTokens: number
    usedCalls: number
    tokenLimit: number | null
    callLimit: number | null
    tokenPercent: number | null
    callPercent: number | null
    exceeded: boolean
    warning: boolean
    quotaStatus: string
  }[]
  quotaTickets: {
    ticketNo: string
    modelName: string
    requestedTokenLimit: number | null
    requestedCallLimit: number | null
    reason: string
    status: string
    createdAt: string
    reviewNote: string | null
  }[]
  expirations: {
    itemId: string
    grantLabel: string
    ticketNo: string
    resourceName: string
    expiresAt: string
    daysRemaining: number
    status: string
  }[]
}

const ROLE_LABELS: Record<string, string> = {
  admin: '系统管理员',
  operator: '运营审核人员',
  ops: '运营审核人员',
  user: '普通用户',
}

export function ProfilePage({
  role,
  onNavigate,
}: {
  role: 'user' | 'ops' | 'admin'
  onNavigate?: (view: View, ticketType?: string | null) => void
}) {
  const [data, setData] = useState<ProfileModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [revision, setRevision] = useState(0)

  // Inline name edit state
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Inline MOD-01 quota request state
  const [reqModel, setReqModel] = useState<ProfileModel['models'][number] | null>(null)
  const [reqTokens, setReqTokens] = useState('')
  const [reqCalls, setReqCalls] = useState('')
  const [reqReason, setReqReason] = useState('')
  const [submittingReq, setSubmittingReq] = useState(false)

  useEffect(() => {
    const c = new AbortController()
    setLoading(true)
    fetch('/api/profile/me', {signal: c.signal})
      .then(async r => {
        if (!r.ok) throw new Error('读取个人中心信息失败')
        return r.json()
      })
      .then((res: ProfileModel) => {
        if (!c.signal.aborted) {
          setData(res)
          setNameDraft(res.profile.name || '')
          setErr('')
        }
      })
      .catch(e => {
        if (!c.signal.aborted) setErr(e?.message || '读取失败')
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false)
      })
    return () => c.abort()
  }, [revision, role])

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nameDraft.trim()) return
    setSavingName(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/profile/me', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({name: nameDraft.trim()}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '姓名更新失败')
      // Keep sessionStorage display name synced
      try {
        const saved = JSON.parse(sessionStorage.getItem('session-person') ?? 'null')
        if (saved) sessionStorage.setItem('session-person', JSON.stringify({...saved, name: nameDraft.trim()}))
      } catch {}
      setEditingName(false)
      setMsg('个人姓名已更新。')
      setRevision(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '姓名更新失败')
    } finally {
      setSavingName(false)
    }
  }

  const submitQuotaRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reqModel) return
    setSubmittingReq(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/model-quotas/request', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          workspaceId: reqModel.workspaceId,
          providerName: reqModel.providerName,
          modelName: reqModel.modelName,
          modelType: reqModel.modelType,
          requestedTokenLimit: reqTokens.trim() ? Number(reqTokens) : null,
          requestedCallLimit: reqCalls.trim() ? Number(reqCalls) : null,
          reason: reqReason.trim(),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || '调额申请提交失败')
      setMsg(`模型调额申请单 ${body.ticket?.ticketNo} 已提交，运营审批通过后将自动生效并恢复模型调用。`)
      setReqModel(null)
      setReqTokens(''); setReqCalls(''); setReqReason('')
      setRevision(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '调额申请提交失败')
    } finally {
      setSubmittingReq(false)
    }
  }

  if (loading && !data) {
    return <div data-testid="profile-page" style={{padding: 24, color: '#64748b'}}>正在加载个人中心…</div>
  }
  if (!data) {
    return <div data-testid="profile-page" style={{padding: 24, color: '#dc2626'}}>{err || '无法加载个人中心'}</div>
  }

  const {profile, assets, ticketStats, models, quotaTickets, expirations} = data
  const initials = (profile.name || profile.account || 'U').slice(0, 1).toUpperCase()
  const roleLabel = ROLE_LABELS[role] || ROLE_LABELS[profile.roles[0]] || '普通用户'

  return (
    <div data-testid="profile-page" style={{display: 'flex', flexDirection: 'column', gap: 18}}>
      {/* Hero Identity Card */}
      <section
        style={{
          background: 'linear-gradient(135deg, #ffffff 0%, #f0f6ff 100%)',
          border: '1px solid #dbeafe',
          borderRadius: 14,
          padding: '22px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 18,
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 18}}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.22)',
            }}
          >
            {initials}
          </div>
          <div>
            <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
              {editingName ? (
                <form onSubmit={saveName} style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
                  <input
                    value={nameDraft}
                    onChange={e => setNameDraft(e.target.value)}
                    maxLength={50}
                    autoFocus
                    style={{padding: '4px 10px', borderRadius: 6, border: '1px solid #93c5fd', fontSize: 15, fontWeight: 600, width: 160}}
                  />
                  <button type="submit" disabled={savingName} style={{padding: '4px 10px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, cursor: 'pointer'}}>
                    {savingName ? '保存中…' : '保存'}
                  </button>
                  <button type="button" className="secondary-button" style={{padding: '4px 8px', fontSize: 12}} onClick={() => { setEditingName(false); setNameDraft(profile.name) }}>
                    取消
                  </button>
                </form>
              ) : (
                <>
                  <h2 style={{margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a'}}>{profile.name}</h2>
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    title="修改显示姓名"
                    style={{display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 12, cursor: 'pointer'}}
                  >
                    <Edit3 size={12} /> 编辑姓名
                  </button>
                </>
              )}
              <span style={{padding: '2px 10px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', fontSize: 12, fontWeight: 600}}>{roleLabel}</span>
              <span style={{padding: '2px 10px', borderRadius: 999, background: profile.active ? '#dcfce7' : '#fee2e2', color: profile.active ? '#15803d' : '#b91c1c', fontSize: 12, fontWeight: 500}}>
                {profile.active ? '账号正常' : '已停用'}
              </span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 13, color: '#475569'}}>
              <span style={{display: 'inline-flex', alignItems: 'center', gap: 5}}><UserCheck size={14} color="#64748b" /> 账号：{profile.account}</span>
              <span style={{display: 'inline-flex', alignItems: 'center', gap: 5}}><Mail size={14} color="#64748b" /> {profile.email}</span>
              <span style={{display: 'inline-flex', alignItems: 'center', gap: 5}}><Building2 size={14} color="#64748b" /> 所属组织：<strong style={{color: '#0f172a'}}>{profile.org}</strong></span>
              {profile.difyWorkspaceName && (
                <span style={{display: 'inline-flex', alignItems: 'center', gap: 5}}><Sparkles size={14} color="#6366f1" /> 工作区：{profile.difyWorkspaceName}</span>
              )}
            </div>
          </div>
        </div>
        <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
          {onNavigate && (
            <>
              <button type="button" className="secondary-button" onClick={() => onNavigate('mine')} style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13}}>
                我的申请 ({ticketStats.total}) <ArrowRight size={14} />
              </button>
              <button type="button" className="primary-button" onClick={() => onNavigate('chat')} style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13}}>
                发起新申请
              </button>
            </>
          )}
        </div>
      </section>

      {err && <div role="alert" style={{padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13}}>{err}</div>}
      {msg && <div role="status" style={{padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', fontSize: 13, fontWeight: 500}}>{msg}</div>}

      {/* 4 Asset KPI Cards */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14}}>
        {[
          {label: '我的 Dify 应用', value: assets.appsCount, sub: '工作区全部应用', icon: Bot, color: '#2563eb', bg: '#eff6ff'},
          {label: '我的知识库', value: assets.datasetsCount, sub: '自建与纳管知识库', icon: Database, color: '#059669', bg: '#ecfdf5'},
          {label: '已装插件', value: assets.pluginsCount, sub: '工作区已安装插件', icon: PlugZap, color: '#7c3aed', bg: '#f5f3ff'},
          {label: '已绑 MCP 服务', value: assets.mcpCount, sub: '工作区外部工具服务', icon: Network, color: '#d97706', bg: '#fffbeb'},
        ].map(card => {
          const Icon = card.icon
          return (
            <article
              key={card.label}
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <div style={{width: 42, height: 42, borderRadius: 10, background: card.bg, color: card.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
                <Icon size={20} />
              </div>
              <div>
                <div style={{fontSize: 12, color: '#64748b'}}>{card.label}</div>
                <div style={{fontSize: 24, fontWeight: 700, color: '#0f172a', lineHeight: 1.2, marginTop: 2}}>{card.value}</div>
                <div style={{fontSize: 11, color: '#94a3b8', marginTop: 2}}>{card.sub}</div>
              </div>
            </article>
          )
        })}
      </div>

      {/* Main 2-Column Content */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 18, alignItems: 'start'}}>
        {/* Left Column: Model Quotas & Expirations */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 18}}>
          {/* My Model Usage & Quotas */}
          <section style={{background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14}}>
              <div>
                <h3 style={{margin: 0, fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6}}>
                  <Cpu size={16} color="#2563eb" /> 我的模型用量与配额
                </h3>
                <p style={{margin: '3px 0 0', fontSize: 12, color: '#64748b'}}>查看本人工作区各模型的消耗进度；额度不足或触发超限禁用时可一键申请调额。</p>
              </div>
            </div>

            {reqModel && (
              <form onSubmit={submitQuotaRequest} style={{background: '#f8fafc', border: '1px solid #bfdbfe', borderRadius: 10, padding: 14, marginBottom: 14}}>
                <h4 style={{margin: '0 0 10px', fontSize: 13, color: '#1e3a8a'}}>发起模型调额申请（MOD-01）· {reqModel.modelName}</h4>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10}}>
                  <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
                    期望 Token 上限
                    <input type="number" min={1000} value={reqTokens} onChange={e => setReqTokens(e.target.value)} placeholder="如：200000" style={{padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1'}} />
                  </label>
                  <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12}}>
                    期望调用次数上限
                    <input type="number" min={10} value={reqCalls} onChange={e => setReqCalls(e.target.value)} placeholder="如：1000" style={{padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1'}} />
                  </label>
                </div>
                <label style={{display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, marginBottom: 10}}>
                  申请理由（必填）
                  <input value={reqReason} onChange={e => setReqReason(e.target.value)} required placeholder="请说明业务场景与调额必要性" style={{padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1'}} />
                </label>
                <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
                  <button type="button" className="secondary-button" style={{padding: '5px 12px', fontSize: 12}} onClick={() => setReqModel(null)}>取消</button>
                  <button type="submit" disabled={submittingReq} style={{padding: '5px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, cursor: 'pointer'}}>
                    {submittingReq ? '提交中…' : '提交调额申请'}
                  </button>
                </div>
              </form>
            )}

            {models.length > 0 ? (
              <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                {models.map(m => {
                  const pct = m.tokenPercent ?? 0
                  const barColor = !m.enabled || m.exceeded ? '#dc2626' : m.warning ? '#f59e0b' : '#2563eb'
                  return (
                    <div key={m.key} style={{border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: !m.enabled ? '#fef2f2' : '#fcfcfd'}}>
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
                        <div>
                          <strong style={{fontSize: 14, color: '#0f172a'}}>{m.modelName}</strong>
                          <span style={{marginLeft: 8, fontSize: 11, color: '#64748b'}}>{m.providerName.split('/').at(-1)}</span>
                        </div>
                        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                          <span className={`status ${m.enabled ? 'success' : 'danger'}`}>{m.enabled ? '可用' : '已禁用'}</span>
                          <button
                            type="button"
                            className="secondary-button"
                            style={{padding: '3px 10px', fontSize: 12}}
                            onClick={() => {
                              try {
                                sessionStorage.setItem('mod01-prefill', JSON.stringify({key: m.key, operationType: '配置额度'}))
                              } catch {}
                              if (onNavigate) onNavigate('manual', 'MOD-01')
                              else {
                                setReqModel(m)
                                setReqTokens(String(Math.max((m.tokenLimit ?? 50000) * 2, 100000)))
                                setReqCalls(String(Math.max((m.callLimit ?? 500) * 2, 1000)))
                              }
                            }}
                          >
                            申请调额
                          </button>
                        </div>
                      </div>
                      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#475569', marginTop: 8}}>
                        <span>Token 消耗：<strong>{m.usedTokens.toLocaleString()}</strong> / {m.tokenLimit ? m.tokenLimit.toLocaleString() : '不限'}</span>
                        <span>调用次数：<strong>{m.usedCalls}</strong> / {m.callLimit ?? '不限'}</span>
                      </div>
                      {m.tokenLimit && (
                        <div style={{height: 7, background: '#e2e8f0', borderRadius: 4, marginTop: 6, overflow: 'hidden'}}>
                          <div style={{height: '100%', width: `${Math.min(100, pct)}%`, background: barColor, borderRadius: 4}} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{padding: '18px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: 8}}>
                当前工作区暂未检测到已配置的模型调用记录
              </div>
            )}

            {quotaTickets.length > 0 && (
              <div style={{marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12}}>
                <div style={{fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8}}>我的调额申请记录（MOD-01）</div>
                <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                  {quotaTickets.slice(0, 5).map(t => (
                    <div key={t.ticketNo} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '6px 10px', background: '#f8fafc', borderRadius: 6}}>
                      <span><code style={{fontSize: 11}}>{t.ticketNo}</code> · {t.modelName}（Token {t.requestedTokenLimit ?? '-'} / 次数 {t.requestedCallLimit ?? '-'}）</span>
                      <span className={`status ${t.status === '已批准' ? 'success' : t.status === '已驳回' ? 'danger' : 'warning'}`}>{t.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* My Expirations */}
          <section style={{background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20}}>
            <h3 style={{margin: '0 0 12px', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6}}>
              <KeyRound size={16} color="#d97706" /> 我的密钥与授权有效期
            </h3>
            {expirations.length > 0 ? (
              <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                {expirations.map(item => (
                  <div key={item.itemId} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: '1px solid #f1f5f9', borderRadius: 8, background: '#fcfcfd'}}>
                    <div>
                      <div style={{fontSize: 13, fontWeight: 600, color: '#0f172a'}}>{item.resourceName}</div>
                      <div style={{fontSize: 11, color: '#64748b', marginTop: 2}}>{item.grantLabel} · {item.ticketNo} · 到期：{new Date(item.expiresAt).toLocaleDateString('zh-CN')}</div>
                    </div>
                    <span className={`status ${item.status === '已过期' ? 'danger' : item.status === '即将到期' ? 'warning' : item.status === '已回收' ? 'neutral' : 'success'}`}>
                      {item.status === '已回收' ? '已回收' : item.daysRemaining < 0 ? `已逾期 ${Math.abs(item.daysRemaining)} 天` : `剩 ${item.daysRemaining} 天`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{padding: '16px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: 8}}>
                暂无即将到期的访问密钥或共享授权
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Organization, Tickets & Security */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 18}}>
          {/* Organization & Subsystem Info */}
          <section style={{background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20}}>
            <h3 style={{margin: '0 0 14px', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6}}>
              <Building2 size={16} color="#4f46e5" /> 组织机构与子系统映射
            </h3>
            <dl style={{margin: 0, display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: 10, columnGap: 12, fontSize: 13}}>
              <dt style={{color: '#64748b'}}>所属组织机构</dt>
              <dd style={{margin: 0, fontWeight: 600, color: '#0f172a'}}>{profile.org}</dd>
              <dt style={{color: '#64748b'}}>业务条线</dt>
              <dd style={{margin: 0, color: '#334155'}}>{profile.businessLine}</dd>
              <dt style={{color: '#64748b'}}>Dify 主工作区</dt>
              <dd style={{margin: 0, color: '#334155'}}>{profile.difyWorkspaceName || '暂未绑定'}</dd>
              <dt style={{color: '#64748b'}}>Dify 角色</dt>
              <dd style={{margin: 0, color: '#334155'}}>{profile.difyRole}</dd>
              <dt style={{color: '#64748b'}}>RAGFlow 权限</dt>
              <dd style={{margin: 0, color: '#334155'}}>{profile.ragflowPermission}</dd>
              <dt style={{color: '#64748b'}}>平台主体 ID</dt>
              <dd style={{margin: 0, fontFamily: 'monospace', fontSize: 12, color: '#64748b'}}>{profile.subjectId}</dd>
            </dl>
            <div style={{marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: 8}}>
              <div style={{fontSize: 12, color: '#64748b'}}>自助变更申请（跳转工单系统填写，管理员审批生效）：</div>
              <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 5}}
                  onClick={() => onNavigate?.('manual', 'ACC-04')}
                >
                  申请变更组织 / 角色 <ArrowRight size={13} />
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 5}}
                  onClick={() => onNavigate?.('manual', 'ACC-03')}
                >
                  发起资源交接申请 <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </section>

          {/* My Tickets Summary */}
          <section style={{background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20}}>
            <h3 style={{margin: '0 0 14px', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6}}>
              <Clock size={16} color="#2563eb" /> 我的工单概览
            </h3>
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10}}>
              <div style={{padding: '12px 10px', borderRadius: 8, background: '#eff6ff', textAlign: 'center'}}>
                <div style={{fontSize: 20, fontWeight: 700, color: '#1d4ed8'}}>{ticketStats.pending}</div>
                <div style={{fontSize: 12, color: '#475569', marginTop: 2}}>办理中</div>
              </div>
              <div style={{padding: '12px 10px', borderRadius: 8, background: '#f0fdf4', textAlign: 'center'}}>
                <div style={{fontSize: 20, fontWeight: 700, color: '#15803d'}}>{ticketStats.completed}</div>
                <div style={{fontSize: 12, color: '#475569', marginTop: 2}}>已办结</div>
              </div>
              <div style={{padding: '12px 10px', borderRadius: 8, background: '#fef2f2', textAlign: 'center'}}>
                <div style={{fontSize: 20, fontWeight: 700, color: '#b91c1c'}}>{ticketStats.rejected}</div>
                <div style={{fontSize: 12, color: '#475569', marginTop: 2}}>已驳回/失败</div>
              </div>
            </div>
          </section>

          {/* Security & Auth Info */}
          <section style={{background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20}}>
            <h3 style={{margin: '0 0 12px', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6}}>
              <ShieldCheck size={16} color="#059669" /> 登录与安全说明
            </h3>
            <div style={{display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#334155', lineHeight: 1.6}}>
              <CheckCircle2 size={16} color="#059669" style={{marginTop: 2, flexShrink: 0}} />
              <div>
                <strong>{profile.authSource === 'dify' ? 'Dify 统一身份实时验密' : '应用中心平台账号认证'}</strong>
                <div style={{fontSize: 12, color: '#64748b', marginTop: 4}}>
                  {profile.authSource === 'dify'
                    ? '当前账号通过底层 Dify 实时核验密码，应用中心不留存您的明文或密文密码。如需修改登录密码，请前往 Dify 个人设置中修改。'
                    : '当前使用应用中心本地凭证登录，所有工单审批与资源变更均自动写入平台审计日志。'}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
