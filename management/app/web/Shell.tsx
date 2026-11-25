import {useState} from 'react'
import type {FormEvent} from 'react'
import {Layers3, Sparkles, ShieldCheck, Activity, FileCheck2, Settings, PanelLeftClose, AlertTriangle, ClipboardCheck, ChevronDown, LogOut, Lock, User, Eye, EyeOff} from 'lucide-react'
import type {Identity, View, NavItem} from '../../shared-ui/UiContextData'
import {baseTicketNav, operationTicketNav, warehouseNav, monitorNav} from '../../shared-ui/UiContextData'
import {isSettingsView} from './SettingsCenter'

export function Login({ onLogin, error }: { onLogin: (username: string, password: string) => Promise<void> | void; error?: string }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!username.trim() || !password) return
    setSubmitting(true)
    try {
      await onLogin(username.trim(), password)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-shell">
        <section className="login-brand">
          <div className="brand-mark brand-mark-large"><Layers3 size={28} /></div>
          <span>AI 运营管理平台</span>
        </section>
        <section className="login-copy">
          <span className="login-kicker"><Sparkles size={14} /> 应用治理 · 运行监控 · 工单协同</span>
          <h1>统一资源管理<br />高效工单协作</h1>
          <div className="login-features">
            <span><ShieldCheck size={18} /> 审批边界清晰</span>
            <span><Activity size={18} /> 运行状态透明</span>
            <span><FileCheck2 size={18} /> 全流程可审计</span>
          </div>
        </section>
        <section className="login-panel">
          <div className="login-panel-head">
            <div>
              <span className="mini-label">统一身份认证</span>
              <h2>账号密码登录</h2>
            </div>
            <div className="network-pill"><span /> 用户网络分区</div>
          </div>
          <form className="login-form" onSubmit={event => void handleSubmit(event)} data-testid="login-form">
            <label className="login-field">
              <span>账号 / 邮箱</span>
              <div className="login-input-wrap">
                <User size={16} />
                <input
                  name="username"
                  type="text"
                  autoComplete="username"
                  placeholder="例如 chen.yu 或 chen.yu@kpw.com"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                />
              </div>
            </label>
            <label className="login-field">
              <span>登录密码</span>
              <div className="login-input-wrap">
                <Lock size={16} />
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="login-eye-btn"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword(v => !v)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            {error && <p className="login-error" role="alert">{error}</p>}
            <button type="submit" className="primary-button login-submit" disabled={submitting || !username.trim() || !password}>
              {submitting ? '正在验证...' : '登录'}
            </button>
          </form>
          <div className="login-security"><ShieldCheck size={15} /> 支持管理平台、Dify 与 RAGFlow 统一账号登录</div>
        </section>
        <footer className="login-footer">应用中心 · 统一身份认证 · 2026</footer>
      </div>
    </main>
  )
}

export function Sidebar({
  identity, view, onNavigate, collapsed, onCollapse,
}: {
  identity: Identity
  view: View
  onNavigate: (view: View) => void
  collapsed: boolean
  onCollapse: () => void
}) {
  const ticketNav = identity.role === 'user' ? baseTicketNav : operationTicketNav
  const settingsDefaultView: View = identity.role === 'admin' ? 'organizations' : 'keywordRules'
  const settingsNav: NavItem[] = [
    { id: settingsDefaultView, label: '系统设置', icon: Settings },
  ]
  const personalNav: NavItem[] = [
    { id: 'profile', label: '个人中心', icon: User },
  ]
  const activeSettingsView: View = isSettingsView(view) ? settingsDefaultView : view
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="side-brand">
        <div className="brand-mark"><Layers3 size={21} /></div>
        {!collapsed && <div><strong>应用中心</strong><span>AI 运营管理平台</span></div>}
      </div>
      <button className="collapse-btn" onClick={onCollapse} aria-label="折叠侧边栏">
        <PanelLeftClose size={17} />
      </button>
      <nav>
        <NavGroup title="仓库" items={warehouseNav} view={view} onNavigate={onNavigate} collapsed={collapsed} />
        {identity.role !== 'user' && (
          <NavGroup title="监控" items={monitorNav} view={view} onNavigate={onNavigate} collapsed={collapsed} />
        )}
        <NavGroup title="工单" items={ticketNav} view={view} onNavigate={onNavigate} collapsed={collapsed} />
        {identity.role !== 'user' && (
          <NavGroup title="系统" items={settingsNav} view={activeSettingsView} onNavigate={onNavigate} collapsed={collapsed} />
        )}
        <NavGroup title="个人" items={personalNav} view={view} onNavigate={onNavigate} collapsed={collapsed} />
      </nav>
    </aside>
  )
}

export function NavGroup({
  title, items, view, onNavigate, collapsed,
}: {
  title: string
  items: NavItem[]
  view: View
  onNavigate: (view: View) => void
  collapsed: boolean
}) {
  return (
    <div className="nav-group">
      {!collapsed && <div className="nav-title">{title}</div>}
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            data-view={item.id}
            aria-label={item.label}
            className={`nav-item ${view === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={item.label}
          >
            <Icon size={18} />
            {!collapsed && <span>{item.label}</span>}


          </button>
        )
      })}
    </div>
  )
}

export function Topbar({
  identity, onNavigate, onLogout,
}: {
  identity: Identity
  onNavigate: (view: View) => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <header className="topbar">
      <div className="partition"><span /> 用户网络分区</div>
      <div className="top-actions">
        {identity.role !== 'user' && (
          <>
            <button className="top-action alert-action" onClick={() => onNavigate('security')}>
              <AlertTriangle size={17} /><span>事件中心</span>
            </button>
            <button className="top-action" onClick={() => onNavigate('todo')}>
              <ClipboardCheck size={17} />
              <span>{identity.role === 'admin' ? '账号配置待办' : '运维待办'}</span>

            </button>
          </>
        )}
        <button className="user-trigger" onClick={() => setOpen(!open)}>
          <span className={`avatar avatar-${identity.role}`}>{identity.initials}</span>
          <span className="user-copy"><strong>{identity.name}</strong><small>{identity.org}</small></span>
          <ChevronDown size={16} />
        </button>
        {open && (
          <div className="user-menu">
            <div><span className={`avatar avatar-${identity.role}`}>{identity.initials}</span><p><strong>{identity.name}</strong><small>{identity.email ?? `${identity.account}@kpw.com`}</small></p></div>
            <div className="menu-role">{identity.roleName} · {identity.org}</div>
            <button onClick={() => { setOpen(false); onNavigate('profile') }}><User size={16} /> 个人中心与设置</button>
            <button onClick={onLogout}><LogOut size={16} /> 退出登录</button>
          </div>
        )}
      </div>
    </header>
  )
}
