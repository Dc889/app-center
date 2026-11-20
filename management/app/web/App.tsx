import {useMemo,useState} from 'react'
import type {Role,View} from '../../shared-ui/UiContextData'
import {identities,personOf} from '../../shared-ui/UiContextData'
import {Login,Sidebar,Topbar} from './Shell'
import {ChatApplication} from './ChatApplication'
import {adminTicketTypes,ticketTypes} from './ticket-catalog'
import {ManualApplication,TicketList,TicketTypes,WorkOrderDrawer} from './WorkOrderPages'
import {renderModuleView} from './module-registry'
import '../../shared-ui/styles/App.css'

export function App() {
  const [role, setRole] = useState<Role | null>(null)
  const [view, setView] = useState<View>('overview')
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState('')
  const identity = useMemo(() => {
    const entry=identities.find(item=>item.role===role)
    return entry && role ? {...entry,...personOf(role)} : entry
  }, [role])

  const [loginError,setLoginError] = useState('')
  const login = async (nextRole: Role, account?:string) => {
    try {
      const response=await fetch('/api/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:account ?? personOf(nextRole).account,role:nextRole==='ops'?'operator':nextRole})})
      if(!response.ok) throw Error()
      const profile=await response.json()
      sessionStorage.setItem('session-person',JSON.stringify({...profile,role:nextRole}))
    } catch {setLoginError('管理服务未连接，请重试');return}
    if(nextRole==='ops') sessionStorage.setItem('operator',account ?? 'zhou.min')
    setLoginError('')
    setRole(nextRole)
    setView(nextRole === 'user' ? 'agents' : 'overview')
  }

  if (!role || !identity) return <>{loginError && <p role="alert">{loginError}</p>}<Login onLogin={login} /></>

  const monitorViews: View[] = ['overview', 'knowledge', 'agentMonitor', 'plugins', 'mcp', 'skills', 'security', 'accounts', 'audit']
  const safeView = role === 'user' && monitorViews.includes(view) ? 'agents' : view

  const moduleContent = renderModuleView(safeView, { role, onNavigate: setView, onWorkOrder: setDrawer })
  let content: React.ReactNode
  if (moduleContent) content = moduleContent
  else if (safeView === 'chat') content = <ChatApplication role={role} account={personOf(role).account} catalog={(role==='admin'?[...ticketTypes,...adminTicketTypes]:ticketTypes).map(item=>({code:item[0],name:item[1],mode:item[3],scene:item[4]}))} />
  else if (safeView === 'manual') content = <ManualApplication key={role} role={role} />
  else if (safeView === 'mine' || safeView === 'todo' || safeView === 'query') content = <TicketList key={role+safeView} view={safeView} role={role} />
  else if (safeView === 'types' && role === 'admin') content = <TicketTypes />
  else content = <ChatApplication role={role} account={personOf(role).account} catalog={ticketTypes.map(item=>({code:item[0],name:item[1],mode:item[3],scene:item[4]}))} />

  return (
    <div className="app-shell">
      <Sidebar identity={identity} view={safeView} onNavigate={setView} collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)} />
      <div className={`app-main ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <Topbar identity={identity} onNavigate={setView} onLogout={async () => { const r=await fetch('/api/demo-session',{method:'DELETE'}); if(r.ok){setRole(null);setView('overview')} }} />
        <main className="page-content">{content}</main>
      </div>
      {drawer && <WorkOrderDrawer title={drawer} role={role} onClose={() => setDrawer('')} />}
    </div>
  )
}

export default App
