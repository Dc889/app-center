import type {Role, View} from '../../shared-ui/UiContextData'
import {pageMeta} from '../../shared-ui/UiContextData'

export const VIEW_PATHS: Record<View, string> = {
  overview: '/overview',
  knowledge: '/knowledge',
  agents: '/agents',
  knowledgeWarehouse: '/knowledge-warehouse',
  agentMonitor: '/agent-monitor',
  serviceMonitor: '/service-monitor',
  pluginWarehouse: '/plugin-warehouse',
  mcpWarehouse: '/mcp-warehouse',
  skillWarehouse: '/skill-warehouse',
  plugins: '/plugins',
  mcp: '/mcp',
  skills: '/skills',
  security: '/security',
  accounts: '/accounts',
  audit: '/audit',
  chat: '/chat',
  manual: '/manual',
  mine: '/mine',
  todo: '/todo',
  query: '/query',
  types: '/types',
  subsystems: '/subsystems',
  organizations: '/organizations',
  keywordRules: '/keyword-rules',
  mcpTestSuites: '/mcp-test-suites',
}

const PATH_TO_VIEW: Record<string, View> = Object.fromEntries(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as View]),
) as Record<string, View>

const USER_ALLOWED_VIEWS: View[] = [
  'agents',
  'knowledgeWarehouse',
  'pluginWarehouse',
  'mcpWarehouse',
  'skillWarehouse',
  'chat',
  'manual',
  'mine',
]

export type ParsedRoute = {
  isLogin: boolean
  view: View | null
  ticketType: string | null
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed || '/'
}

export function parseRoute(pathname: string): ParsedRoute {
  const normalized = normalizePathname(pathname)
  if (normalized === '/' || normalized === '/login') {
    return {isLogin: true, view: null, ticketType: null}
  }
  const manualMatch = /^\/manual\/([A-Za-z]{2,4}-\d{2})$/.exec(normalized)
  if (manualMatch) {
    return {isLogin: false, view: 'manual', ticketType: manualMatch[1].toUpperCase()}
  }
  const view = PATH_TO_VIEW[normalized] ?? null
  return {isLogin: false, view, ticketType: null}
}

export function buildPath(view: View, ticketType?: string | null): string {
  if (view === 'manual' && ticketType) {
    return `/manual/${encodeURIComponent(ticketType.toUpperCase())}`
  }
  return VIEW_PATHS[view]
}

export function defaultViewForRole(role: Role): View {
  return role === 'user' ? 'agents' : 'overview'
}

export function resolveViewForRole(view: View | null, role: Role): View {
  if (!view) return defaultViewForRole(role)
  if (role === 'user' && !USER_ALLOWED_VIEWS.includes(view)) return 'agents'
  if (role === 'ops' && (view === 'types' || view === 'subsystems' || view === 'organizations')) return 'overview'
  return view
}

export function pageTitleForRoute(view: View | null, ticketType?: string | null): string {
  if (!view) return '登录 · 应用中心'
  const meta = pageMeta[view]
  if (view === 'manual' && ticketType) return `${meta.title} · ${ticketType} · 应用中心`
  return `${meta.title} · 应用中心`
}

export function pushPath(path: string) {
  if (typeof window === 'undefined') return
  if (window.location.pathname !== path) {
    window.history.pushState(null, '', path)
  }
}

export function replacePath(path: string) {
  if (typeof window === 'undefined') return
  if (window.location.pathname !== path) {
    window.history.replaceState(null, '', path)
  }
}
