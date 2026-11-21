import type {Role} from '../../shared-ui/UiContextData'
import {useState} from 'react'
import {Layers3} from 'lucide-react'
import {Sparkles} from 'lucide-react'
import {ShieldCheck} from 'lucide-react'
import {Activity} from 'lucide-react'
import {FileCheck2} from 'lucide-react'
import {identities} from '../../shared-ui/UiContextData'
import type {Identity} from '../../shared-ui/UiContextData'
import {ArrowRight} from 'lucide-react'
import type {View} from '../../shared-ui/UiContextData'
import {baseTicketNav} from '../../shared-ui/UiContextData'
import {operationTicketNav} from '../../shared-ui/UiContextData'
import {Workflow} from 'lucide-react'
import {PanelLeftClose} from 'lucide-react'
import {warehouseNav} from '../../shared-ui/UiContextData'
import {monitorNav} from '../../shared-ui/UiContextData'
import type {NavItem} from '../../shared-ui/UiContextData'
import {AlertTriangle} from 'lucide-react'
import {ClipboardCheck} from 'lucide-react'
import {ChevronDown} from 'lucide-react'
import {LogOut} from 'lucide-react'

export function Login({ onLogin }: { onLogin: (role: Role, account?: string) => void }) {
  const [operator,setOperator]=useState('zhou.min')
  const [loginAccount,setLoginAccount]=useState('')
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
              <span className="mini-label">演示环境</span>
              <h2>选择身份进入</h2>
            </div>
            <div className="network-pill"><span /> 用户网络分区</div>
          </div>
          <div className="login-demo-controls">
            <label>
              <span>运维账户</span>
              <select value={operator} onChange={e=>setOperator(e.target.value)}><option value="zhou.min">周敏</option><option value="wang.ning">王宁</option></select>
            </label>
            <label>
              <span>指定账户（可选）</span>
              <input value={loginAccount} placeholder="留空使用所选身份" onChange={e=>setLoginAccount(e.target.value)}/>
            </label>
          </div>
          <div className="identity-list">
            {identities.map((identity, index) => {
              const Icon = identity.icon
              return (
                <button
                  key={identity.role}
                  className={`identity-card identity-${index + 1}`}
                  onClick={() => onLogin(identity.role,loginAccount || (identity.role==="ops"?operator:identity.account))}
                >
                  <div className="identity-icon"><Icon size={21} /></div>
                  <div className="identity-main">
                    <div><strong>{identity.roleName}</strong><span>{identity.role==="ops" && operator==="wang.ning" ? "王宁 · wang.ning" : identity.name+" · "+identity.account}</span></div>
                  </div>
                  <ArrowRight size={19} className="identity-arrow" />
                </button>
              )
            })}
          </div>
          <div className="login-security"><ShieldCheck size={15} /> 当前为演示登录入口</div>
        </section>
        <footer className="login-footer">应用中心 · 内部演示环境 · 2026</footer>
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
  const ticketNav = identity.role === 'user' ? baseTicketNav : [
    ...operationTicketNav,
    ...(identity.role === 'admin' ? [{ id: 'types' as View, label: '工单类型', icon: Workflow }] : []),
  ]
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
            <div><span className={`avatar avatar-${identity.role}`}>{identity.initials}</span><p><strong>{identity.name}</strong><small>{identity.account}</small></p></div>
            <div className="menu-role">{identity.roleName} · {identity.org}</div>
            <button onClick={onLogout}><LogOut size={16} /> 退出登录</button>
          </div>
        )}
      </div>
    </header>
  )
}
