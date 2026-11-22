import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import type {Role,View} from '../../shared-ui/UiContextData'
import {identities,personOf} from '../../shared-ui/UiContextData'
import {Login,Sidebar,Topbar} from './Shell'
import {ChatApplication} from './ChatApplication'
import {adminTicketTypes,ticketTypes} from './ticket-catalog'
import {ManualApplication,TicketList,TicketTypes,WorkOrderDrawer} from './WorkOrderPages'
import {renderModuleView} from './module-registry'
import {buildPath,pageTitleForRoute,parseRoute,pushPath,replacePath,resolveViewForRole} from './routes'
import '../../shared-ui/styles/App.css'

type SessionProfile = {
  active?: boolean
  account: string
  email?: string
  name: string
  org: string
  businessLine?: string
  roles?: string[]
  actingRole: string
  subjectId: string
}

function toUiRole(actingRole: string): Role {
  if (actingRole === 'admin') return 'admin'
  if (actingRole === 'operator' || actingRole === 'ops') return 'ops'
  return 'user'
}

export function App() {
  const initialRoute = useMemo(() => parseRoute(typeof window === 'undefined' ? '/' : window.location.pathname), [])
  const [sessionReady, setSessionReady] = useState(false)
  const [role, setRole] = useState<Role | null>(null)
  const [view, setView] = useState<View>(initialRoute.view ?? 'overview')
  const [manualTicketType, setManualTicketType] = useState<string | null>(initialRoute.ticketType)
  const intendedRoute = useRef<{view: View; ticketType: string | null} | null>(
    initialRoute.view ? {view: initialRoute.view, ticketType: initialRoute.ticketType} : null,
  )
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState('')
  const [loginError, setLoginError] = useState('')

  const identity = useMemo(() => {
    const entry = identities.find(item => item.role === role)
    return entry && role ? {...entry, ...personOf(role)} : entry
  }, [role])

  useEffect(() => {
    let active = true
    fetch('/api/auth/session')
      .then(async response => (response.ok ? (await response.json()) as SessionProfile : {active: false}))
      .then(profile => {
        if (!active) return
        if (profile.active && 'account' in profile) {
          const restoredRole = toUiRole(profile.actingRole)
          sessionStorage.setItem('session-person', JSON.stringify({...profile, role: restoredRole}))
          if (restoredRole === 'ops') sessionStorage.setItem('operator', profile.account)
          const parsed = parseRoute(window.location.pathname)
          const nextView = resolveViewForRole(parsed.view, restoredRole)
          const nextTicket = nextView === 'manual' ? parsed.ticketType : null
          setRole(restoredRole)
          setView(nextView)
          setManualTicketType(nextTicket)
          replacePath(buildPath(nextView, nextTicket))
        } else {
          sessionStorage.removeItem('session-person')
          if (window.location.pathname === '/') replacePath('/login')
        }
      })
      .catch(() => {
        if (!active) return
        if (window.location.pathname === '/') replacePath('/login')
      })
      .finally(() => {
        if (active) setSessionReady(true)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseRoute(window.location.pathname)
      if (!role) {
        intendedRoute.current = parsed.view ? {view: parsed.view, ticketType: parsed.ticketType} : null
        return
      }
      const nextView = resolveViewForRole(parsed.view, role)
      const nextTicket = nextView === 'manual' ? parsed.ticketType : null
      setView(nextView)
      setManualTicketType(nextTicket)
      const canonical = buildPath(nextView, nextTicket)
      if (window.location.pathname !== canonical) replacePath(canonical)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [role])

  const navigate = useCallback((nextView: View, nextTicketType?: string | null) => {
    if (!role) return
    const safeNext = resolveViewForRole(nextView, role)
    const ticket = safeNext === 'manual' ? (nextTicketType ?? null) : null
    setView(safeNext)
    setManualTicketType(ticket)
    pushPath(buildPath(safeNext, ticket))
  }, [role])

  const selectManualTicketType = useCallback((code: string) => {
    setManualTicketType(code)
    pushPath(buildPath('manual', code))
  }, [])

  const safeView = role ? resolveViewForRole(view, role) : null

  useEffect(() => {
    document.title = pageTitleForRoute(safeView, safeView === 'manual' ? manualTicketType : null)
  }, [safeView, manualTicketType])

  const login = async (username: string, password: string) => {
    let nextRole: Role
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({username: username.trim(), password}),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setLoginError(body?.error?.message || '账号或密码错误')
        return
      }
      const profile = body as SessionProfile
      nextRole = toUiRole(profile.actingRole)
      sessionStorage.setItem('session-person', JSON.stringify({...profile, role: nextRole}))
      if (nextRole === 'ops') sessionStorage.setItem('operator', profile.account)
    } catch {
      setLoginError('管理服务未连接，请重试')
      return
    }
    setLoginError('')
    const pending = intendedRoute.current
    intendedRoute.current = null
    const nextView = resolveViewForRole(pending?.view ?? null, nextRole)
    const nextTicket = nextView === 'manual' ? (pending?.ticketType ?? null) : null
    setRole(nextRole)
    setView(nextView)
    setManualTicketType(nextTicket)
    pushPath(buildPath(nextView, nextTicket))
  }

  const logout = async () => {
    const r = await fetch('/api/auth/logout', {method: 'POST'})
    if (r.ok) {
      sessionStorage.removeItem('session-person')
      sessionStorage.removeItem('operator')
      intendedRoute.current = null
      setRole(null)
      setView('overview')
      setManualTicketType(null)
      pushPath('/login')
    }
  }

  if (!sessionReady) return null
  if (!role || !identity || !safeView) {
    return <Login onLogin={login} error={loginError} />
  }

  const moduleContent = renderModuleView(safeView, {role, onNavigate: navigate, onWorkOrder: setDrawer})
  let content: React.ReactNode
  if (moduleContent) content = moduleContent
  else if (safeView === 'chat') content = <ChatApplication role={role} account={personOf(role).account} catalog={(role === 'admin' ? [...ticketTypes, ...adminTicketTypes] : ticketTypes).map(item => ({code: item[0], name: item[1], mode: item[3], scene: item[4]}))} />
  else if (safeView === 'manual') content = <ManualApplication key={role} role={role} ticketType={manualTicketType} onSelectTicketType={selectManualTicketType} />
  else if (safeView === 'mine' || safeView === 'todo' || safeView === 'query') content = <TicketList key={role + safeView} view={safeView} role={role} />
  else if (safeView === 'types' && role === 'admin') content = <TicketTypes />
  else content = <ChatApplication role={role} account={personOf(role).account} catalog={ticketTypes.map(item => ({code: item[0], name: item[1], mode: item[3], scene: item[4]}))} />

  return (
    <div className="app-shell">
      <Sidebar identity={identity} view={safeView} onNavigate={navigate} collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)} />
      <div className={`app-main ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <Topbar identity={identity} onNavigate={navigate} onLogout={logout} />
        <main className="page-content" data-view={safeView}><div className="page-layout">{content}</div></main>
      </div>
      {drawer && <WorkOrderDrawer title={drawer} role={role} onClose={() => setDrawer('')} />}
    </div>
  )
}

export default App
