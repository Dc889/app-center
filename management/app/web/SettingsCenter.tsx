import {BookKey, Building2, FlaskConical, ServerCog, Settings, Workflow} from 'lucide-react'
import type {Role, View} from '../../shared-ui/UiContextData'
import {OrganizationsPage} from './OrganizationsPage'
import {SubsystemsPage} from './SubsystemsPage'
import {KeywordRulesPage} from './KeywordRulesPage'
import {McpTestSuitesPage} from './McpTestSuitesPage'
import {TicketTypes} from './WorkOrderPages'

export type SettingsTabView = 'organizations' | 'subsystems' | 'keywordRules' | 'mcpTestSuites' | 'types'

export const SETTINGS_VIEWS: readonly SettingsTabView[] = [
  'organizations',
  'subsystems',
  'keywordRules',
  'mcpTestSuites',
  'types',
]

export function isSettingsView(view: View): view is SettingsTabView {
  return (SETTINGS_VIEWS as readonly string[]).includes(view)
}

export function SettingsCenter({
  activeTab,
  role,
  onNavigate,
}: {
  activeTab: SettingsTabView
  role: Role
  onNavigate: (view: View) => void
}) {
  const allTabs: {id: SettingsTabView; label: string; icon: typeof Building2; adminOnly?: boolean}[] = [
    {id: 'organizations', label: '组织机构', icon: Building2, adminOnly: true},
    {id: 'subsystems', label: '纳管子系统', icon: ServerCog, adminOnly: true},
    {id: 'keywordRules', label: '敏感词库', icon: BookKey},
    {id: 'mcpTestSuites', label: 'MCP 题库', icon: FlaskConical},
    {id: 'types', label: '工单类型', icon: Workflow, adminOnly: true},
  ]
  const tabs = allTabs.filter(t => !t.adminOnly || role === 'admin')

  const effectiveTab = tabs.some(t => t.id === activeTab) ? activeTab : tabs[0]?.id ?? 'keywordRules'

  return (
    <div className="settings-center" data-testid="settings-center">
      <div className="settings-top-bar">
        <div className="settings-brand">
          <div className="settings-brand-icon"><Settings size={18} /></div>
          <h1>系统设置</h1>
        </div>
        <nav className="settings-tabs" role="tablist" aria-label="系统设置分类">
          {tabs.map(tab => {
            const Icon = tab.icon
            const active = effectiveTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`settings-tab ${active ? 'is-active' : ''}`}
                onClick={() => onNavigate(tab.id)}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      <div className="settings-pane">
        {effectiveTab === 'organizations' && role === 'admin' && <OrganizationsPage />}
        {effectiveTab === 'subsystems' && role === 'admin' && <SubsystemsPage />}
        {effectiveTab === 'keywordRules' && <KeywordRulesPage />}
        {effectiveTab === 'mcpTestSuites' && <McpTestSuitesPage />}
        {effectiveTab === 'types' && role === 'admin' && <TicketTypes />}
      </div>
    </div>
  )
}
