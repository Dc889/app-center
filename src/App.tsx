import { useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Bell, Bot,
  Check, ChevronDown, CircleHelp, ClipboardCheck,
  ClipboardList, Clock3, Database, Download, FileCheck2, FilePlus2, Filter,
  Gauge, Headphones, KeyRound, Layers3, ListChecks, LogOut,
  MessageSquareText, Network, PackageCheck, PanelLeftClose, PlugZap, Plus,
  Search, Send, ServerCog, ShieldAlert, ShieldCheck, Sparkles,
  UserCog, Users, WandSparkles, Workflow, X, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import './App.css'

type Role = 'user' | 'ops' | 'admin'
type View =
  | 'overview' | 'knowledge' | 'agents' | 'plugins' | 'mcp' | 'skills'
  | 'security' | 'accounts' | 'audit'
  | 'chat' | 'manual' | 'mine' | 'todo' | 'query' | 'types'

type Identity = {
  role: Role
  roleName: string
  name: string
  account: string
  org: string
  initials: string
  note: string
  icon: LucideIcon
}

type NavItem = { id: View; label: string; icon: LucideIcon }

const identities: Identity[] = [
  {
    role: 'user', roleName: '用户', name: '陈宇', account: 'chen.yu',
    org: '业务一部', initials: '陈', note: '申请资源、跟踪本人申请',
    icon: Users,
  },
  {
    role: 'ops', roleName: '运维人员', name: '周敏', account: 'zhou.min',
    org: '平台运营组', initials: '周', note: '监控运行态、办理业务工单',
    icon: Headphones,
  },
  {
    role: 'admin', roleName: '系统管理员', name: '李强', account: 'li.qiang',
    org: '系统管理组', initials: '李', note: '管理工单类型、办理账号工单',
    icon: UserCog,
  },
]

const monitorNav: NavItem[] = [
  { id: 'overview', label: '统一概览', icon: Gauge },
  { id: 'knowledge', label: '知识库', icon: Database },
  { id: 'agents', label: '智能体与广场', icon: Bot },
  { id: 'plugins', label: '插件', icon: PlugZap },
  { id: 'mcp', label: 'MCP', icon: Network },
  { id: 'skills', label: 'Skill', icon: PackageCheck },
  { id: 'security', label: '安全事件', icon: ShieldAlert },
  { id: 'accounts', label: '账号与集成', icon: Users },
  { id: 'audit', label: '审计追踪', icon: FileCheck2 },
]

const baseTicketNav: NavItem[] = [
  { id: 'chat', label: '对话申请', icon: MessageSquareText },
  { id: 'manual', label: '手工申请', icon: FilePlus2 },
  { id: 'mine', label: '我的申请', icon: ClipboardList },
]

const operationTicketNav: NavItem[] = [
  ...baseTicketNav,
  { id: 'todo', label: '我的待办', icon: ListChecks },
  { id: 'query', label: '工单查询', icon: Search },
]

const pageMeta: Record<View, { title: string; eyebrow: string; desc: string }> = {
  overview: { title: '统一概览', eyebrow: '运行全景', desc: '汇聚资源、服务、调用和待办，快速定位需要介入的事项。' },
  knowledge: { title: '知识库监控', eyebrow: '知识资产', desc: '跟踪纳管资源、构建过程、模型目录核对与文档安全审查。' },
  agents: { title: '智能体与广场', eyebrow: '应用运行', desc: '查看发布状态、调用质量、资源校验和广场访问情况。' },
  plugins: { title: '插件监控', eyebrow: '扩展生态', desc: '观测 daemon 健康、运行内存、失败与自动禁用记录。' },
  mcp: { title: 'MCP 监控', eyebrow: '工具连接', desc: '追踪目录、绑定、调用表现以及异常隔离工单。' },
  skills: { title: 'Skill 监控', eyebrow: '文件仓库', desc: '查看 Skill 上架、版本、下载量与下载组织分布。' },
  security: { title: '安全事件', eyebrow: '风险闭环', desc: '集中研判告警、跟踪处置证据和复核状态。' },
  accounts: { title: '账号与集成', eyebrow: '一致性治理', desc: '核对三方账号映射、接口健康和同步任务。' },
  audit: { title: '审计追踪', eyebrow: '全程留痕', desc: '检索工单、执行、目录、下载和访问审计记录。' },
  chat: { title: '对话申请', eyebrow: '智能填单', desc: '描述你想完成的事情，我会匹配工单类型并协助填写。' },
  manual: { title: '手工申请', eyebrow: '工单目录', desc: '按业务对象选择工单类型，逐项填写并检查。' },
  mine: { title: '我的申请', eyebrow: '申请跟踪', desc: '查看本人提交的草稿、办理进度与执行结果。' },
  todo: { title: '我的待办', eyebrow: '待处理事项', desc: '办理分派给你的工单与系统事件。' },
  query: { title: '工单查询', eyebrow: '全量检索', desc: '按条件检索当前可见范围内的工单。' },
  types: { title: '工单类型', eyebrow: '流程定义', desc: '定义字段和流程，测试通过后发布新版本。' },
}

const trendData = [
  { time: '00:00', total: 182, success: 168, alert: 7 },
  { time: '04:00', total: 126, success: 119, alert: 4 },
  { time: '08:00', total: 308, success: 291, alert: 10 },
  { time: '12:00', total: 442, success: 416, alert: 16 },
  { time: '16:00', total: 386, success: 369, alert: 12 },
  { time: '20:00', total: 268, success: 257, alert: 8 },
  { time: '现在', total: 324, success: 310, alert: 9 },
]

const categoryData = [
  { name: '知识库', value: 72, secondary: 28 },
  { name: '智能体', value: 86, secondary: 22 },
  { name: '插件', value: 48, secondary: 16 },
  { name: 'MCP', value: 62, secondary: 13 },
  { name: '集成', value: 38, secondary: 9 },
]

type AgentCallRecord = {
  recordId: string
  time: string
  method: '广场 Web' | '外部 API'
  userAccount: string
  userOrg: string
  keyId: string
  callerName: string
  callerOrg: string
  sourceIp: string
  apiPath: string
  appId: string
  appName: string
  appMode: 'chatbot' | 'agent-chat' | 'workflow' | 'advanced-chat'
  messageId: string
  runId: string
  models: string[]
  totalTokens: string
  knowledgeBases: string[]
  mcpCalls: string[]
  pluginCalls: string[]
  duration: string
  httpStatus: string
  result: '成功' | '失败'
  errorCode: string
}

type AgentCallSeed = Pick<AgentCallRecord,
  'time' | 'method' | 'userAccount' | 'userOrg' | 'keyId' | 'callerName' |
  'callerOrg' | 'sourceIp' | 'appName' | 'duration' | 'result'
> & { difyRef: string }

const agentCallSeeds: AgentCallSeed[] = [
  { time: '11-16 20:42:18', method: '广场 Web', userAccount: 'chen.yu', userOrg: '业务一部', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.16.72', appName: '案件摘要助手', difyRef: '01JCF8Q9A2', duration: '1.8s', result: '成功' },
  { time: '11-16 20:39:44', method: '外部 API', userAccount: '—', userOrg: '—', keyId: 'KEY-REG-0188', callerName: '警情数据交换服务', callerOrg: '情指中心', sourceIp: '10.24.31.18', appName: '警情辅助分析', difyRef: '01JCF8K3B7', duration: '8.2s', result: '失败' },
  { time: '11-16 20:34:06', method: '广场 Web', userAccount: 'wu.fan', userOrg: '网安支队', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.22.41', appName: '线索分析 Agent', difyRef: '01JCF89P4C', duration: '2.4s', result: '成功' },
  { time: '11-16 20:28:31', method: '外部 API', userAccount: '—', userOrg: '—', keyId: 'KEY-REG-0142', callerName: '资金研判平台', callerOrg: '经侦支队', sourceIp: '10.24.40.26', appName: '资金研判助手', difyRef: '01JCF80N8E', duration: '1.2s', result: '成功' },
  { time: '11-16 19:56:20', method: '广场 Web', userAccount: 'lin.jie', userOrg: '经侦支队', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.40.81', appName: '企业风险查询', difyRef: '01JCF6A7M1', duration: '3.6s', result: '成功' },
  { time: '11-16 19:42:12', method: '广场 Web', userAccount: 'zheng.yi', userOrg: '情指中心', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.31.45', appName: '警情辅助分析', difyRef: '01JCF5D2T9', duration: '2.1s', result: '成功' },
  { time: '11-16 18:54:03', method: '外部 API', userAccount: '—', userOrg: '—', keyId: 'KEY-REG-0201', callerName: '日志分析平台', callerOrg: '网安支队', sourceIp: '10.24.22.19', appName: '网络日志研判', difyRef: '01JCF2J8H4', duration: '12.8s', result: '失败' },
  { time: '11-16 18:36:47', method: '广场 Web', userAccount: 'sun.ning', userOrg: '治安支队', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.28.61', appName: '勤务问答助手', difyRef: '01JCF1F6K8', duration: '1.5s', result: '成功' },
  { time: '11-16 17:58:25', method: '外部 API', userAccount: '—', userOrg: '—', keyId: 'KEY-REG-0096', callerName: '移动警务门户', callerOrg: '业务一部', sourceIp: '10.24.16.12', appName: '执法文书校验', difyRef: '01JCEZ73Q3', duration: '4.3s', result: '成功' },
  { time: '11-16 17:26:38', method: '广场 Web', userAccount: 'tang.yu', userOrg: '刑侦支队', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.36.54', appName: '案件串并助手', difyRef: '01JCEXC5R6', duration: '2.9s', result: '成功' },
  { time: '11-16 16:48:16', method: '广场 Web', userAccount: 'gao.feng', userOrg: '业务一部', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.16.93', appName: '案件摘要助手', difyRef: '01JCEV5D7A', duration: '7.6s', result: '失败' },
  { time: '11-16 16:14:52', method: '外部 API', userAccount: '—', userOrg: '—', keyId: 'KEY-REG-0165', callerName: '案件协同系统', callerOrg: '刑侦支队', sourceIp: '10.24.36.20', appName: '案件串并助手', difyRef: '01JCET56W2', duration: '1.9s', result: '成功' },
  { time: '11-16 15:32:19', method: '广场 Web', userAccount: 'ma.xin', userOrg: '治安支队', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.28.87', appName: '勤务问答助手', difyRef: '01JCEQPF4B', duration: '2.3s', result: '成功' },
  { time: '11-16 14:46:05', method: '外部 API', userAccount: '—', userOrg: '—', keyId: 'KEY-REG-0188', callerName: '警情数据交换服务', callerOrg: '情指中心', sourceIp: '10.24.31.18', appName: '警情辅助分析', difyRef: '01JCEN1S6P', duration: '3.7s', result: '成功' },
  { time: '11-16 13:24:33', method: '广场 Web', userAccount: 'chen.yu', userOrg: '业务一部', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.16.72', appName: '知识检索助手', difyRef: '01JCEHA9J5', duration: '1.6s', result: '成功' },
  { time: '11-16 12:18:41', method: '外部 API', userAccount: '—', userOrg: '—', keyId: 'KEY-REG-0142', callerName: '资金研判平台', callerOrg: '经侦支队', sourceIp: '10.24.40.26', appName: '资金研判助手', difyRef: '01JCECZY8N', duration: '9.4s', result: '失败' },
  { time: '11-16 11:42:27', method: '广场 Web', userAccount: 'wu.fan', userOrg: '网安支队', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.22.41', appName: '网络日志研判', difyRef: '01JCEAT2V4', duration: '2.8s', result: '成功' },
  { time: '11-16 10:36:14', method: '广场 Web', userAccount: 'tang.yu', userOrg: '刑侦支队', keyId: '—', callerName: '—', callerOrg: '—', sourceIp: '10.24.36.54', appName: '案件摘要助手', difyRef: '01JCE73X9M', duration: '2.0s', result: '成功' },
]

type AppTraceProfile = Pick<AgentCallRecord,
  'appId' | 'appMode' | 'models' | 'knowledgeBases' | 'mcpCalls' | 'pluginCalls'
>

const appTraceProfiles: Record<string, AppTraceProfile> = {
  '案件摘要助手': {
    appId: 'app_case_summary', appMode: 'advanced-chat',
    models: ['openai / gpt-4.1-mini · 1,284入 / 342出'],
    knowledgeBases: ['案件法规库（ds_case_01）· 命中2段', '文书范例库（ds_doc_06）· 命中1段'],
    mcpCalls: ['档案检索 / search_archive · 成功 0.6s'],
    pluginCalls: ['langgenius/jina_tool / reader · 成功 0.4s'],
  },
  '警情辅助分析': {
    appId: 'app_incident_analysis', appMode: 'workflow',
    models: ['azure_openai / gpt-4.1 · 2,104入 / 518出', 'openai / text-embedding-3-large · 226'],
    knowledgeBases: ['警情处置规范（ds_incident_08）· 命中4段'],
    mcpCalls: ['地图服务 / geo_search · 成功 0.8s', '警情库 / get_incident · 成功 0.5s'],
    pluginCalls: ['langgenius/json_process / parse · 成功 0.1s'],
  },
  '线索分析 Agent': {
    appId: 'app_clue_agent', appMode: 'agent-chat',
    models: ['anthropic / claude-sonnet-4 · 1,876入 / 622出'],
    knowledgeBases: ['线索研判手册（ds_clue_03）· 命中3段'],
    mcpCalls: ['线索查询 / get_clue · 成功 0.7s'],
    pluginCalls: ['langgenius/duckduckgo / search · 成功 0.5s', 'langgenius/chart / render · 成功 0.2s'],
  },
  '资金研判助手': {
    appId: 'app_fund_analysis', appMode: 'workflow',
    models: ['deepseek / deepseek-chat · 1,032入 / 288出'],
    knowledgeBases: ['经侦指标库（ds_fund_05）· 命中2段'],
    mcpCalls: ['企业查询 / query_company · 成功 0.4s'],
    pluginCalls: ['langgenius/code / python · 成功 0.3s'],
  },
  '企业风险查询': {
    appId: 'app_company_risk', appMode: 'chatbot',
    models: ['qwen / qwen-max · 864入 / 176出'],
    knowledgeBases: ['企业风险规则库（ds_risk_11）· 命中5段'],
    mcpCalls: ['企业查询 / query_company · 成功 0.9s'],
    pluginCalls: [],
  },
  '网络日志研判': {
    appId: 'app_netlog_analysis', appMode: 'workflow',
    models: ['azure_openai / gpt-4.1-mini · 3,412入 / 708出'],
    knowledgeBases: ['网络安全规则库（ds_net_04）· 命中6段'],
    mcpCalls: ['日志检索 / search_log · 成功 1.1s'],
    pluginCalls: ['langgenius/code / python · 成功 0.8s'],
  },
  '勤务问答助手': {
    appId: 'app_duty_qa', appMode: 'chatbot',
    models: ['qwen / qwen-plus · 724入 / 166出'],
    knowledgeBases: ['勤务规范库（ds_duty_02）· 命中3段'],
    mcpCalls: [],
    pluginCalls: [],
  },
  '执法文书校验': {
    appId: 'app_doc_check', appMode: 'workflow',
    models: ['openai / gpt-4.1-mini · 1,506入 / 298出'],
    knowledgeBases: ['执法文书标准库（ds_lawdoc_07）· 命中4段'],
    mcpCalls: [],
    pluginCalls: ['internal/document_validator / validate · 成功 0.7s'],
  },
  '案件串并助手': {
    appId: 'app_case_link', appMode: 'agent-chat',
    models: ['anthropic / claude-sonnet-4 · 2,224入 / 544出'],
    knowledgeBases: ['案件特征库（ds_case_09）· 命中5段'],
    mcpCalls: ['案件协同 / find_similar_case · 成功 0.8s'],
    pluginCalls: ['langgenius/chart / render · 成功 0.2s'],
  },
  '知识检索助手': {
    appId: 'app_knowledge_search', appMode: 'chatbot',
    models: ['openai / gpt-4.1-mini · 696入 / 142出', 'openai / text-embedding-3-large · 184'],
    knowledgeBases: ['综合政策库（ds_policy_01）· 命中5段', '办事指南库（ds_guide_03）· 命中2段'],
    mcpCalls: [],
    pluginCalls: [],
  },
}

const tokenTotals = ['1,852', '2,848', '2,498', '1,320', '1,040', '2,934', '4,120', '890', '1,988', '2,768', '1,946', '2,442', '902', '3,016', '1,022', '1,566', '4,120', '1,832']

const agentCallRecords: AgentCallRecord[] = agentCallSeeds.map((seed, index) => {
  const profile = appTraceProfiles[seed.appName]
  const hasWorkflowRun = profile.appMode === 'workflow' || profile.appMode === 'advanced-chat'
  const hasMessage = profile.appMode !== 'workflow'
  const failureCode = index === 1 ? 'DIFY_MODEL_TIMEOUT' : index === 6 ? 'MCP_UPSTREAM_TIMEOUT' : index === 10 ? 'MODEL_RATE_LIMIT' : index === 15 ? 'PLUGIN_EXECUTION_ERROR' : '—'
  return {
    ...seed,
    recordId: `CALL-20261116-${String(18 - index).padStart(4, '0')}`,
    apiPath: seed.method === '广场 Web'
      ? `/explore/apps/${profile.appId.replace('app_', '')}/chat`
      : profile.appMode === 'workflow' ? '/v1/workflows/run' : '/v1/chat-messages',
    ...profile,
    messageId: hasMessage ? `msg_${seed.difyRef}` : '—',
    runId: hasWorkflowRun ? `run_${seed.difyRef}` : '—',
    totalTokens: tokenTotals[index],
    httpStatus: seed.result === '成功' ? '200' : index === 10 ? '429' : '504',
    errorCode: seed.result === '成功' ? '—' : failureCode,
  }
})

type AvailabilityCategory = 'knowledge' | 'plugins' | 'mcp' | 'skills' | 'agents'
type AvailabilityStatus = '能用' | '不能用'
type AvailabilityRecord = {
  category: AvailabilityCategory
  name: string
  source: string
  status: AvailabilityStatus
  reason: string
  orgScope: string
  changedAt: string
}

const availabilityRecords: AvailabilityRecord[] = [
  { category: 'knowledge', name: '案件法规库', source: 'Dify', status: '能用', reason: '已分享、审查通过、未暂停', orgScope: '全局 · 本网段', changedAt: '11-16 20:32' },
  { category: 'knowledge', name: '反诈话术资料库', source: 'RAGFlow', status: '能用', reason: '已分享、审查通过、未暂停', orgScope: '业务一部 / 刑侦支队', changedAt: '11-16 18:45' },
  { category: 'knowledge', name: '经侦案例知识库', source: 'RAGFlow', status: '能用', reason: '已分享、审查通过、未暂停', orgScope: '经侦支队', changedAt: '11-16 17:26' },
  { category: 'knowledge', name: '网络安全规则库', source: 'Dify', status: '不能用', reason: '知识库已暂停', orgScope: '网安支队', changedAt: '11-16 19:18' },
  { category: 'knowledge', name: '公共安全知识集', source: 'Dify', status: '不能用', reason: '文档安全审查未通过', orgScope: '全局 · 本网段', changedAt: '11-16 16:09' },
  { category: 'knowledge', name: '个人测试语料库', source: 'RAGFlow', status: '不能用', reason: '未分享，仅创建人可见', orgScope: '创建人本人', changedAt: '11-16 14:52' },

  { category: 'plugins', name: 'document-parser', source: '内网插件仓库', status: '能用', reason: '已上架、公开、未自动禁用', orgScope: '全局 · 本网段', changedAt: '11-16 20:11' },
  { category: 'plugins', name: 'json-process', source: 'Dify Plugin Daemon', status: '能用', reason: '已上架、公开、未自动禁用', orgScope: '全局 · 本网段', changedAt: '11-16 18:42' },
  { category: 'plugins', name: 'case-chart', source: '内网插件仓库', status: '能用', reason: '非公开，业务一部已批准安装', orgScope: '业务一部', changedAt: '11-16 17:15' },
  { category: 'plugins', name: 'browser-agent', source: 'Dify Plugin Daemon', status: '不能用', reason: '失败率越线，已自动禁用', orgScope: '全局 · 本网段', changedAt: '11-16 20:38' },
  { category: 'plugins', name: 'legacy-ocr', source: '内网插件仓库', status: '不能用', reason: '插件已下架', orgScope: '全局 · 本网段', changedAt: '11-16 15:20' },
  { category: 'plugins', name: 'private-exporter', source: '内网插件仓库', status: '不能用', reason: '非公开，尚未批准安装', orgScope: '经侦支队', changedAt: '11-16 13:46' },

  { category: 'mcp', name: '档案检索服务', source: '内网 MCP 目录', status: '能用', reason: '已上架、绑定正常', orgScope: '全局 · 本网段', changedAt: '11-16 20:26' },
  { category: 'mcp', name: '企业查询服务', source: '内网 MCP 目录', status: '能用', reason: '已上架、绑定正常', orgScope: '经侦支队 / 业务一部', changedAt: '11-16 18:08' },
  { category: 'mcp', name: '线索查询服务', source: 'Dify MCP 目录', status: '能用', reason: '已上架、绑定正常', orgScope: '网安支队', changedAt: '11-16 16:37' },
  { category: 'mcp', name: '地图服务', source: 'Dify MCP 目录', status: '不能用', reason: '连续调用异常', orgScope: '情指中心', changedAt: '11-16 20:39' },
  { category: 'mcp', name: '旧版警情接口', source: '内网 MCP 目录', status: '不能用', reason: '应用绑定已解绑', orgScope: '情指中心', changedAt: '11-16 15:58' },
  { category: 'mcp', name: '测试文件服务', source: 'Dify MCP 目录', status: '不能用', reason: '尚未上架', orgScope: '平台运营组', changedAt: '11-16 12:10' },

  { category: 'skills', name: 'incident-report', source: '内网 Skill 仓库', status: '能用', reason: '当前版本已上架', orgScope: '全局 · 本网段', changedAt: '11-16 19:55' },
  { category: 'skills', name: 'case-summary', source: 'GitHub Enterprise', status: '能用', reason: '当前版本已上架', orgScope: '业务一部 / 刑侦支队', changedAt: '11-16 18:31' },
  { category: 'skills', name: 'security-review', source: '内网 Skill 仓库', status: '能用', reason: '当前版本已上架', orgScope: '网安支队', changedAt: '11-16 16:22' },
  { category: 'skills', name: 'legacy-export', source: 'GitHub Enterprise', status: '不能用', reason: 'Skill 已下架', orgScope: '全局 · 本网段', changedAt: '11-16 17:48' },
  { category: 'skills', name: 'draft-research', source: '内网 Skill 仓库', status: '不能用', reason: '尚未上架', orgScope: '平台运营组', changedAt: '11-16 14:05' },

  { category: 'agents', name: '案件摘要助手', source: 'Dify 应用广场', status: '能用', reason: '已上架广场', orgScope: '全局 · 本网段', changedAt: '11-16 20:18' },
  { category: 'agents', name: '警情辅助分析', source: 'Dify 应用广场', status: '能用', reason: '已上架广场', orgScope: '情指中心', changedAt: '11-16 19:36' },
  { category: 'agents', name: '线索分析 Agent', source: 'Dify 应用广场', status: '能用', reason: '已上架广场', orgScope: '网安支队', changedAt: '11-16 18:20' },
  { category: 'agents', name: '勤务问答助手', source: 'Dify 应用广场', status: '能用', reason: '已上架广场', orgScope: '治安支队', changedAt: '11-16 17:42' },
  { category: 'agents', name: '旧版文书助手', source: 'Dify 应用广场', status: '不能用', reason: '应用已下架', orgScope: '全局 · 本网段', changedAt: '11-16 16:28' },
  { category: 'agents', name: '资金研判实验版', source: 'Dify 工作区', status: '不能用', reason: '尚未上架广场', orgScope: '经侦支队', changedAt: '11-16 13:15' },
]

const monitorData: Record<string, {
  metrics: [string, string, string][]
  chartTitle: string
  chartSubtitle: string
  barsTitle: string
  tableTitle: string
  columns: string[]
  rows: string[][]
}> = {
  knowledge: {
    metrics: [['已纳管库', '168', '+6'], ['已分享库', '57', '+2'], ['构建中', '12', '实时'], ['异常库', '4', '-2'], ['待确认文档', '23', '需处理']],
    chartTitle: '构建任务趋势', chartSubtitle: '解析 / 切片 / 索引任务', barsTitle: '来源与状态分布',
    tableTitle: '构建任务追踪',
    columns: ['任务 ID', '来源', '知识库', '当前阶段', '进度', '持续时长', '状态', '关联工单'],
    rows: [
      ['JOB-88421', 'RAGFlow', '经侦案例知识库', '索引 / 向量化', '78%', '12分 38秒', '进行中', 'WO-241118'],
      ['JOB-88403', 'Dify', '政策法规语料库', '切片', '46%', '8分 12秒', '进行中', 'WO-241106'],
      ['JOB-88392', 'RAGFlow', '反诈话术资料库', '解析', '—', '31分 05秒', '进度停滞', 'WO-241091'],
      ['JOB-88374', 'Dify', '公共安全知识集', '已完成', '100%', '16分 42秒', '正常', 'WO-241065'],
    ],
  },
  agents: {
    metrics: [['个人应用', '326', '+12'], ['待审核', '18', '+3'], ['已发布', '94', '+5'], ['已下架', '11', '持平'], ['运行异常', '6', '-3'], ['资源告警', '9', '需处理']],
    chartTitle: '调用趋势', chartSubtitle: '总调用 / 成功 / 失败', barsTitle: '发布状态分布',
    tableTitle: '发布资源校验',
    columns: ['应用', '版本', '资源类型', '资源名称', '批准状态', '对外权限', '告警原因', '关联工单'],
    rows: [
      ['警情辅助分析', 'v2.8', '插件', 'web-search-pro', '未批准', '—', '版本指纹变化', 'AG-241122'],
      ['案件摘要助手', 'v1.6', 'MCP', '档案检索服务', '已批准', '允许', '—', 'AG-241098'],
      ['执法文书校验', 'v3.1', '工具', '文书模板填充', '待审', '禁止', '无对外权限', 'AG-241071'],
      ['勤务问答助手', 'v1.2', '知识库', '勤务规范库', '已批准', '允许', '—', 'AG-241042'],
    ],
  },
  plugins: {
    metrics: [['已上架', '42', '+2'], ['已安装', '186', '+8'], ['运行中', '173', '93%'], ['自动禁用', '3', '需确认'], ['待升级', '14', '+4'], ['存在漏洞', '5', '-1']],
    chartTitle: '容器内存趋势', chartSubtitle: '已用内存 / 上限', barsTitle: '插件错误排行',
    tableTitle: '自动禁用记录',
    columns: ['禁用时间', '插件', '版本', 'Workspace', '触发规则', '阈值', '实测值', '恢复状态', '关联工单'],
    rows: [
      ['今天 18:42', 'document-parser', '2.4.1', 'ws_84f2', '失败率', '30%', '46.8%', '待确认', 'PLG-241117'],
      ['今天 15:16', 'browser-agent', '1.8.3', 'ws_291a', '超时率', '20%', '31.2%', '观察中', 'PLG-241083'],
      ['昨天 22:09', 'data-extractor', '3.0.2', 'ws_70ce', '失败率', '30%', '38.5%', '已恢复', 'PLG-241012'],
    ],
  },
  mcp: {
    metrics: [['目录总数', '38', '+3'], ['正常', '34', '89%'], ['隔离', '2', '持平'], ['绑定数', '246', '+18'], ['异常', '4', '-2']],
    chartTitle: '调用趋势', chartSubtitle: '调用 / 成功 / 超时', barsTitle: '异常 MCP 排行',
    tableTitle: 'MCP 调用追踪',
    columns: ['记录 ID', '时间', '调用方式', '组织', '应用', 'MCP', '工具', '耗时', '结果'],
    rows: [
      ['RUN-908821', '20:42:18', '广场 Web', '业务一部', '案件摘要助手', '档案检索服务', 'search_archive', '1.8s', '成功'],
      ['RUN-908790', '20:39:44', '外部 API', '情指中心', '警情辅助分析', '地图服务', 'geo_search', '8.2s', '超时'],
      ['RUN-908742', '20:34:06', '广场 Web', '网安支队', '线索分析 Agent', '线索查询服务', 'get_clue', '2.4s', '成功'],
      ['RUN-908701', '20:28:31', '外部 API', '经侦支队', '资金研判助手', '企业查询服务', 'query_company', '1.2s', '成功'],
    ],
  },
  skills: {
    metrics: [['已上架', '126', '+8'], ['待审核', '17', '+4'], ['已下架', '9', '持平'], ['版本总数', '284', '+15'], ['存储占用', '18.6 GB', '+1.2 GB']],
    chartTitle: '下载趋势', chartSubtitle: '下载次数 / 下载人数', barsTitle: '下载排行',
    tableTitle: '下载明细',
    columns: ['流水号', '时间', '账户名', '姓名', '组织', 'Skill', '版本', '文件指纹', '结果', '工单号'],
    rows: [
      ['DL-241115-8841', '20:41', 'chen.yu', '陈宇', '业务一部', '公文摘要 Skill', '2.1.0', 'a8df…930c', '成功', 'SKL-241120'],
      ['DL-241115-8836', '20:28', 'lin.jie', '林杰', '经侦支队', '表格分析 Skill', '1.8.2', '90be…e12a', '成功', 'SKL-241115'],
      ['DL-241115-8819', '19:56', 'wu.fan', '吴凡', '网安支队', '日志研判 Skill', '3.0.1', '34fc…102e', '成功', 'SKL-241099'],
    ],
  },
  security: {
    metrics: [['未研判', '8', '+2'], ['处理中', '13', '-3'], ['待复核', '5', '+1'], ['紧急', '2', '重点'], ['今日关闭', '21', '+6']],
    chartTitle: '事件趋势', chartSubtitle: '新增 / 关闭 / 重开', barsTitle: '事件级别分布',
    tableTitle: '事件台账',
    columns: ['事件 ID', '首次时间', '对象类型', '对象名称', '原始级别', '研判结论', '状态', '办理人', '关联工单'],
    rows: [
      ['EVT-88421', '今天 18:42', '插件', 'document-parser', '严重', '真实故障', '处理中', '周敏', 'EVT-241117'],
      ['EVT-88408', '今天 17:16', '账号与集成', 'Dify API', '紧急', '真实故障', '待复核', '赵宁', 'EVT-241103'],
      ['EVT-88396', '今天 15:09', '知识库', '反诈话术资料库', '严重', '安全事件', '观察中', '唐雨', 'EVT-241087'],
      ['EVT-88361', '今天 11:22', 'MCP', '地图服务', '一般', '误报', '已关闭', '周敏', 'EVT-241045'],
    ],
  },
  accounts: {
    metrics: [['映射总数', '1,284', '+16'], ['三方一致', '1,242', '96.7%'], ['缺 RAGFlow', '12', '-3'], ['缺 Dify', '19', '+2'], ['账户名冲突', '4', '需处理']],
    chartTitle: '接口健康趋势', chartSubtitle: 'RAGFlow / Dify 成功率', barsTitle: '账号差异分布',
    tableTitle: '账号映射核对',
    columns: ['平台账户名', '姓名', '组织', 'RAGFlow ID', 'Dify ID', 'Workspace', '一致性', '最近核对', '关联工单'],
    rows: [
      ['chen.yu', '陈宇', '业务一部', 'rf_10482', 'df_20873', 'ws_84f2', '一致', '20:45', '—'],
      ['lin.jie', '林杰', '经侦支队', 'rf_10407', '—', '—', '缺 Dify', '20:44', 'EVT-241113'],
      ['wu.fan', '吴凡', '网安支队', 'rf_10391', 'df_20776', 'ws_291a', '角色不一致', '20:42', 'EVT-241109'],
      ['zheng.yi', '郑毅', '情指中心', '—', 'df_20712', 'ws_12bb', '缺 RAGFlow', '20:40', 'EVT-241086'],
    ],
  },
  audit: {
    metrics: [['今日工单动作', '486', '+12%'], ['API 执行', '328', '99.1%'], ['目录变更', '74', '+8'], ['下载', '219', '+22%'], ['访问日志', '18,642', '+6%']],
    chartTitle: '审计事件趋势', chartSubtitle: '工单 / API / 目录 / 访问', barsTitle: '操作类型分布',
    tableTitle: '管理审计',
    columns: ['审计 ID', '时间', '账户名', '角色', '来源 IP', '工单号', '对象类型', '动作', '结果'],
    rows: [
      ['AUD-994820', '20:46:12', 'zhou.min', '运维人员', '10.24.8.16', 'PLG-241117', '插件', '退回补正', '成功'],
      ['AUD-994801', '20:42:39', 'system_event', '后台任务', '—', 'EVT-241113', '账号与集成', '创建事件', '成功'],
      ['AUD-994776', '20:38:05', 'chen.yu', '用户', '10.24.16.72', 'SKL-241120', 'Skill', '提交下载', '成功'],
      ['AUD-994751', '20:31:48', 'zhou.min', '运维人员', '10.24.8.16', 'MCP-241102', 'MCP', '审核通过', '成功'],
    ],
  },
}

const ticketTypes = [
  ['KB-01', '个人知识库纳管同步', '知识库', '即办', '把个人库同步到本平台目录'],
  ['KB-02', '知识库发布 / 分享申请', '知识库', '人工审批', '对外分享或随应用发布'],
  ['KB-03', '知识库使用 / 绑定申请', '知识库', '按条件', '本人库即办，受限库审批'],
  ['KB-05', '知识库下架 / 违规处置', '知识库', '人工审批', '下架、暂停分享或处置文档'],
  ['AG-01', '个人智能体纳管同步', '智能体', '即办', '同步个人应用，不对外分享'],
  ['AG-02', '智能体发布 / 分享申请', '智能体', '人工审批', '审批通过后一次性上架'],
  ['AG-03', '智能体受限使用授权', '智能体', '按条件', '公开应用即办，受限应用审批'],
  ['AG-04', '智能体变更再发布', '智能体', '人工审批', '校验新版本的插件、工具与 MCP'],
  ['AG-05', '智能体下架', '智能体', '人工审批', '下架广场应用及相关授权'],
  ['KEY-01', 'Dify API 密钥创建登记', '凭证', '按条件', '本人调试即办，其他用途审批'],
  ['KEY-02', 'Dify API 密钥轮换 / 撤销', '凭证', '人工审批', '轮换或撤销已登记密钥'],
  ['TOL-01', 'Dify 工具对外使用审批', '工具', '人工审批', '工具批准状态的唯一来源'],
  ['PLG-01', '插件上架申请', '插件', '人工审批', '代码、依赖和权限安全审查'],
  ['PLG-02', '插件版本变更再审', '插件', '人工审批', '版本指纹或权限变化后再审'],
  ['PLG-03', '插件安装 / 卸载', '插件', '按条件', '公开安装即办，受限安装审批'],
  ['SKL-01', 'Skill 上架申请', 'Skill', '人工审批', '文件扫描通过后进入目录'],
  ['SKL-02', 'Skill 版本变更再审', 'Skill', '人工审批', '新文件版本重新审核'],
  ['SKL-03', 'Skill 下载', 'Skill', '即办', '核对权限并记录下载流水'],
  ['SKL-04', 'Skill 下架', 'Skill', '人工审批', '保留审计副本并禁止下载'],
  ['MCP-01', 'MCP 上架登记', 'MCP', '人工审批', '登记模型中心统一 URL'],
  ['MCP-02', 'MCP 使用 / 绑定', 'MCP', '按条件', '本人私有 MCP 即办'],
  ['MCP-03', 'MCP 解绑 / 隔离', 'MCP', '人工审批', '解绑、隔离或目录下架'],
  ['EVT-01', '告警研判与处置', '告警', '人工审批', '人工报告安全与运行事件'],
]

const adminTicketTypes = [
  ['ACC-01', '跨平台账号开通 / 权限变更', '账号', '人工审批', '开通、停用、组织或角色变更'],
  ['ACC-02', '跨平台账户名变更', '账号', '人工审批', '三方预检并按顺序提交'],
]

const workOrders = [
  ['WO-20261115-0128', '知识库发布 / 分享申请', '反诈话术资料库发布', '审核中', '安全复核', '今天 18:42'],
  ['WO-20261115-0119', 'Skill 下载', '下载公文摘要 Skill 2.1.0', '已完成', '执行完成', '今天 17:16'],
  ['WO-20261115-0106', '智能体发布 / 分享申请', '案件摘要助手上架', '待补正', '申请人补正', '今天 15:09'],
  ['WO-20261114-0982', '插件安装 / 卸载', '安装表格分析插件', '已完成', '结果确认', '昨天 16:32'],
  ['WO-20261114-0961', 'MCP 使用 / 绑定', '绑定档案检索 MCP', '执行失败', '等待重试', '昨天 14:48'],
]

function Login({ onLogin }: { onLogin: (role: Role) => void }) {
  return (
    <main className="login-page">
      <div className="login-orb orb-one" />
      <div className="login-orb orb-two" />
      <div className="login-shell">
        <section className="login-brand">
          <div className="brand-mark brand-mark-large"><Layers3 size={28} /></div>
          <span>AI 运营管理平台</span>
        </section>
        <section className="login-copy">
          <span className="login-kicker"><Sparkles size={14} /> 应用治理 · 运行监控 · 工单协同</span>
          <h1>让每一次资源变更<br />都有据可查</h1>
          <p>统一管理知识库、智能体、插件、MCP 与 Skill。所有业务操作通过工单执行，过程清晰，边界明确。</p>
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
          <p className="login-hint">三个身份分别展示对应的完整界面与数据范围。</p>
          <div className="identity-list">
            {identities.map((identity, index) => {
              const Icon = identity.icon
              return (
                <button
                  key={identity.role}
                  className={`identity-card identity-${index + 1}`}
                  onClick={() => onLogin(identity.role)}
                >
                  <div className="identity-icon"><Icon size={21} /></div>
                  <div className="identity-main">
                    <div><strong>{identity.roleName}</strong><span>{identity.name} · {identity.account}</span></div>
                    <small>{identity.note}</small>
                  </div>
                  <ArrowRight size={19} className="identity-arrow" />
                </button>
              )
            })}
          </div>
          <div className="login-security"><ShieldCheck size={15} /> 当前为纯前端演示，所有数据均为模拟数据</div>
        </section>
        <footer className="login-footer">应用中心 · 内部演示环境 · 2026</footer>
      </div>
    </main>
  )
}

function Sidebar({
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
        {identity.role !== 'user' && (
          <NavGroup title="监控" items={monitorNav} view={view} onNavigate={onNavigate} collapsed={collapsed} />
        )}
        <NavGroup title="工单" items={ticketNav} view={view} onNavigate={onNavigate} collapsed={collapsed} />
      </nav>
      <div className="side-status">
        <span className="status-dot" />
        {!collapsed && <div><strong>服务运行正常</strong><small>刚刚完成健康检查</small></div>}
      </div>
    </aside>
  )
}

function NavGroup({
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
            className={`nav-item ${view === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? item.label : undefined}
          >
            <Icon size={18} />
            {!collapsed && <span>{item.label}</span>}
            {item.id === 'security' && !collapsed && <em>8</em>}
            {item.id === 'todo' && !collapsed && <em>12</em>}
          </button>
        )
      })}
    </div>
  )
}

function Topbar({
  identity, onNavigate, onLogout,
}: {
  identity: Identity
  onNavigate: (view: View) => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <header className="topbar">
      <div className="partition"><span /> 用户网络分区 <small>固定</small></div>
      <div className="top-actions">
        {identity.role !== 'user' && (
          <>
            <button className="top-action alert-action" onClick={() => onNavigate('security')}>
              <AlertTriangle size={17} /><span>未关闭告警</span><b>8</b>
            </button>
            <button className="top-action" onClick={() => onNavigate('todo')}>
              <ClipboardCheck size={17} />
              <span>{identity.role === 'admin' ? '运维待办 12 · 账号待办 3' : '待办'}</span>
              {identity.role === 'ops' && <b>12</b>}
            </button>
          </>
        )}
        <button className="icon-button has-dot" aria-label="消息"><Bell size={18} /></button>
        <button className="icon-button" aria-label="帮助"><CircleHelp size={18} /></button>
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

function PageHeader({ view, action }: { view: View; action?: React.ReactNode }) {
  const meta = pageMeta[view]
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">{meta.eyebrow}</span>
        <h1>{meta.title}</h1>
        <p>{meta.desc}</p>
      </div>
      {action}
    </div>
  )
}

function Overview({ role, onWorkOrder }: { role: Role; onWorkOrder: (title: string) => void }) {
  const resources = [
    ['已发布智能体', '94', '+5', Bot],
    ['已分享知识库', '57', '+2', Database],
    ['已批准工具', '68', '+4', WandSparkles],
    ['已上架插件', '42', '+2', PlugZap],
    ['已上架 Skill', '126', '+8', PackageCheck],
    ['正常 MCP', '34', '+3', Network],
    ['有效 Dify 密钥', '89', '-1', KeyRound],
  ] as [string, string, string, LucideIcon][]
  return (
    <>
      <PageHeader
        view="overview"
        action={<div className="time-filter"><button>近 1 小时</button><button className="active">近 24 小时</button><button>近 7 天</button></div>}
      />
      <div className="metric-grid seven">
        {resources.map(([label, value, delta, Icon], i) => (
          <article className="metric-card" key={label}>
            <div className={`metric-icon tone-${(i % 5) + 1}`}><Icon size={19} /></div>
            <span>{label}</span><strong>{value}</strong><small className={delta.startsWith('-') ? 'negative' : ''}>{delta} <em>较昨日</em></small>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <ChartPanel title="调用趋势" subtitle="最近 24 小时 · 5 分钟粒度" wide>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="callFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5b6cf9" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#5b6cf9" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#edf0f5" vertical={false} />
              <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8ebf2', boxShadow: '0 8px 24px rgba(32,45,80,.1)' }} />
              <Area isAnimationActive={false} type="monotone" dataKey="total" name="智能体调用" stroke="#5b6cf9" strokeWidth={2.5} fill="url(#callFill)" />
              <Line isAnimationActive={false} type="monotone" dataKey="success" name="知识库检索" stroke="#22a98a" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="当前告警级别" subtitle="未关闭告警 · 按对象类型">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[
              { name: '提示', value: 12 }, { name: '一般', value: 18 },
              { name: '严重', value: 7 }, { name: '紧急', value: 2 },
            ]} margin={{ top: 8, right: 6, left: -25, bottom: 0 }}>
              <CartesianGrid stroke="#edf0f5" vertical={false} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <Tooltip cursor={{ fill: '#f6f7fb' }} contentStyle={{ borderRadius: 10, border: '1px solid #e8ebf2' }} />
              <Bar isAnimationActive={false} dataKey="value" radius={[5, 5, 0, 0]}>
                {['#8cb7ff', '#f7bd61', '#f0845e', '#e24f65'].map((color) => <Cell key={color} fill={color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="工单待办" subtitle={role === 'admin' ? '业务工单 + 账号类配置工单' : '业务工单与系统事件'}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[
              { name: '待受理', total: 14 }, { name: '审核中', total: 22 },
              { name: '待补正', total: 9 }, { name: '待执行', total: 17 },
              { name: '执行失败', total: 5 },
            ]} margin={{ top: 8, right: 6, left: -25, bottom: 0 }}>
              <CartesianGrid stroke="#edf0f5" vertical={false} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 10 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <Tooltip cursor={{ fill: '#f6f7fb' }} contentStyle={{ borderRadius: 10, border: '1px solid #e8ebf2' }} />
              <Bar isAnimationActive={false} dataKey="total" fill="#7c6df2" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
      <section className="panel service-panel">
        <div className="panel-title"><div><h3>服务健康矩阵</h3><p>最近检查于 20:46:18</p></div><button className="text-button">查看全部 <ArrowRight size={15} /></button></div>
        <div className="health-grid">
          {[
            ['应用中心', 'v2.6.0', '42ms'], ['RAGFlow API', 'v0.22.1', '86ms'],
            ['Dify API', 'v1.14.0', '71ms'], ['plugin daemon', 'v0.5.2', '128ms'],
            ['对象存储', 'MinIO', '35ms'], ['数据库', 'PostgreSQL 16', '18ms'],
          ].map(([name, version, latency], i) => (
            <button key={name} onClick={() => i === 3 && onWorkOrder('plugin daemon 健康异常处置')}>
              <span className={`health-icon ${i === 3 ? 'warning' : ''}`}><ServerCog size={18} /></span>
              <span><strong>{name}</strong><small>{version}</small></span>
              <em>{i === 3 ? '波动' : '正常'} · {latency}</em>
            </button>
          ))}
        </div>
      </section>
      <section className="panel table-panel">
        <div className="panel-title"><div><h3>最近事件</h3><p>资源动作将打开预填工单，不会直接执行</p></div><button className="text-button">进入事件中心 <ArrowRight size={15} /></button></div>
        <DataTable
          columns={['时间', '对象类型', '对象名称', '事件', '级别', '当前状态', '关联工单号', '办理人']}
          rows={[
            ['20:42', '插件', 'document-parser', '失败率超过阈值，已自动禁用', '严重', '待确认', 'PLG-241117', '周敏'],
            ['20:31', '智能体', '案件摘要助手', '发布资源存在未批准插件', '一般', '审核中', 'AG-241122', '赵宁'],
            ['20:16', '知识库', '反诈话术资料库', '构建进度 30 分钟未变化', '严重', '处理中', 'EVT-241087', '唐雨'],
            ...(role === 'admin' ? [['19:58', '账号', 'lin.jie', '三方账号映射不一致', '严重', '待办理', 'ACC-241096', '李强']] : []),
          ]}
          onAction={(row) => onWorkOrder(`${row[2]} · ${row[3]}`)}
        />
      </section>
    </>
  )
}

const availabilityMeta: Record<AvailabilityCategory, { title: string; rule: string }> = {
  knowledge: { title: '知识库可用性', rule: '已分享、审查通过且未暂停，才判定为能用' },
  plugins: { title: '插件可用性', rule: '公开插件须已上架且未自动禁用；非公开插件还须批准安装' },
  mcp: { title: 'MCP 可用性', rule: '已上架且绑定正常，才判定为能用' },
  skills: { title: 'Skill 可用性', rule: '已上架为能用；未上架或已下架为不能用' },
  agents: { title: '智能体可用性', rule: '已上架广场为能用；未上架或已下架为不能用' },
}

function RepositoryAvailability({ defaultCategory }: { defaultCategory: AvailabilityCategory }) {
  const toolRepository = defaultCategory === 'mcp' || defaultCategory === 'skills'
  const [category, setCategory] = useState<AvailabilityCategory>(defaultCategory)
  const [status, setStatus] = useState<'全部' | AvailabilityStatus>('全部')
  const currentRecords = availabilityRecords.filter((record) => record.category === category)
  const visibleRecords = currentRecords.filter((record) => status === '全部' || record.status === status)
  const availableCount = currentRecords.filter((record) => record.status === '能用').length
  const unavailableCount = currentRecords.length - availableCount
  const meta = availabilityMeta[category]

  const changeCategory = (nextCategory: AvailabilityCategory) => {
    setCategory(nextCategory)
    setStatus('全部')
  }

  return (
    <section className="panel availability-panel" data-testid="availability-panel" data-category={category}>
      <div className="availability-head">
        <div>
          <span className="mini-label">本网段资源仓库</span>
          <h3>{toolRepository ? 'MCP 与 Skill 可用性' : meta.title}</h3>
          <p>{meta.rule}。运维人员与系统管理员查看本网段全部资源。</p>
        </div>
        <div className="availability-controls">
          {toolRepository && (
            <div className="repository-tabs" aria-label="资源仓库分栏">
              <button className={category === 'mcp' ? 'active' : ''} onClick={() => changeCategory('mcp')}>MCP</button>
              <button className={category === 'skills' ? 'active' : ''} onClick={() => changeCategory('skills')}>Skill</button>
            </div>
          )}
          <label>
            <span>状态筛选</span>
            <select data-testid="availability-status-filter" value={status} onChange={(event) => setStatus(event.target.value as '全部' | AvailabilityStatus)}>
              <option>全部</option>
              <option>能用</option>
              <option>不能用</option>
            </select>
          </label>
        </div>
      </div>
      <div className="availability-body">
        <div className="availability-summary">
          <button className={status === '能用' ? 'active available' : 'available'} onClick={() => setStatus(status === '能用' ? '全部' : '能用')}>
            <span><Check size={16} /> 能用数</span>
            <strong data-testid="available-count">{availableCount}</strong>
            <small>满足当前仓库判定规则</small>
          </button>
          <button className={status === '不能用' ? 'active unavailable' : 'unavailable'} onClick={() => setStatus(status === '不能用' ? '全部' : '不能用')}>
            <span><X size={16} /> 不能用数</span>
            <strong data-testid="unavailable-count">{unavailableCount}</strong>
            <small>原因已逐项列在右侧</small>
          </button>
        </div>
        <div className="availability-table" data-testid="availability-table" data-count={visibleRecords.length}>
          <div className="availability-table-caption">
            <span>{meta.title}</span>
            <em>{status === '全部' ? `全部 ${visibleRecords.length} 项` : `${status} ${visibleRecords.length} 项`}</em>
          </div>
          <DataTable
            columns={['名称', '来源', '状态', '原因', '组织范围', '最近变化时间']}
            rows={visibleRecords.map((record) => [
              record.name, record.source, record.status, record.reason, record.orgScope, record.changedAt,
            ])}
          />
        </div>
      </div>
    </section>
  )
}

function AgentMonitorPage({ onWorkOrder }: { onWorkOrder: (title: string) => void }) {
  const [organization, setOrganization] = useState('全部组织')
  const [selectedCall, setSelectedCall] = useState<AgentCallRecord | null>(null)
  const data = monitorData.agents
  const organizations = useMemo(() => Array.from(new Set(
    agentCallRecords.map((record) => record.method === '广场 Web' ? record.userOrg : record.callerOrg),
  )).sort((a, b) => a.localeCompare(b, 'zh-CN')), [])
  const filteredCalls = useMemo(() => agentCallRecords.filter((record) => {
    const recordOrg = record.method === '广场 Web' ? record.userOrg : record.callerOrg
    return organization === '全部组织' || recordOrg === organization
  }), [organization])
  const callTrend = useMemo(() => {
    const hourly = new Map<string, { time: string; total: number; success: number; failure: number }>()
    filteredCalls.forEach((record) => {
      const hour = `${record.time.slice(6, 8)}:00`
      const point = hourly.get(hour) ?? { time: hour, total: 0, success: 0, failure: 0 }
      point.total += 1
      if (record.result === '成功') point.success += 1
      else point.failure += 1
      hourly.set(hour, point)
    })
    return Array.from(hourly.values()).sort((a, b) => a.time.localeCompare(b.time))
  }, [filteredCalls])
  const organizationCalls = useMemo(() => {
    const counts = new Map<string, number>()
    filteredCalls.forEach((record) => {
      const recordOrg = record.method === '广场 Web' ? record.userOrg : record.callerOrg
      counts.set(recordOrg, (counts.get(recordOrg) ?? 0) + 1)
    })
    return Array.from(counts, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }, [filteredCalls])
  const resultData = useMemo(() => {
    const success = filteredCalls.filter((record) => record.result === '成功').length
    return [
      { name: '成功', count: success },
      { name: '失败', count: filteredCalls.length - success },
    ]
  }, [filteredCalls])
  return (
    <>
      <PageHeader
        view="agents"
        action={<div className="time-filter"><button>1 小时</button><button className="active">24 小时</button><button>7 天</button></div>}
      />
      <RepositoryAvailability defaultCategory="agents" />
      <div className="metric-grid six">
        {data.metrics.map(([label, value, delta], i) => (
          <article className="metric-card" key={label}>
            <div className={`metric-icon tone-${(i % 5) + 1}`}><Bot size={19} /></div>
            <span>{label}</span><strong>{value}</strong><small>{delta}</small>
          </article>
        ))}
      </div>
      <section className="analysis-toolbar panel">
        <div>
          <span className="analysis-icon"><BarChart3 size={18} /></span>
          <div><strong>全应用调用分析</strong><small>每行对应一次 Dify 应用运行，身份字段按调用方式分开记录</small></div>
        </div>
        <label className="organization-filter">
          <span>组织范围</span>
          <select
            data-testid="organization-filter"
            value={organization}
            onChange={(event) => {
              setOrganization(event.target.value)
              setSelectedCall(null)
            }}
          >
            <option>全部组织</option>
            {organizations.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <div className="analysis-count" data-testid="filtered-call-count">
          <span>{organization}</span>
          <strong>{filteredCalls.length}</strong>
          <small>次运行</small>
        </div>
      </section>
      <div className="call-analysis-grid">
        <ChartPanel title="调用趋势" subtitle={`${organization} · 总调用 / 成功 / 失败`} wide>
          <div className="chart-data" data-testid="call-trend-chart" data-total={filteredCalls.length} data-points={callTrend.length}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={callTrend} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#edf0f5" vertical={false} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8ebf2' }} />
                <Line isAnimationActive={false} type="monotone" dataKey="total" name="总调用" stroke="#5b6cf9" strokeWidth={2.5} dot={{ r: 2 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="success" name="成功" stroke="#22a98a" strokeWidth={2.2} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="failure" name="失败" stroke="#ed795e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>
        <ChartPanel title="调用来源组织" subtitle="调用次数前 10 个组织">
          <div className="chart-data" data-testid="organization-chart" data-bars={organizationCalls.length} data-total={filteredCalls.length}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={organizationCalls} margin={{ top: 8, right: 6, left: -24, bottom: 26 }}>
                <CartesianGrid stroke="#edf0f5" vertical={false} />
                <XAxis dataKey="name" interval={0} angle={-24} textAnchor="end" axisLine={false} tickLine={false} tick={{ fill: '#778196', fontSize: 9 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 10 }} />
                <Tooltip cursor={{ fill: '#f6f7fb' }} contentStyle={{ borderRadius: 10, border: '1px solid #e8ebf2' }} />
                <Bar isAnimationActive={false} dataKey="count" name="调用次数" fill="#6a67e8" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>
        <ChartPanel title="调用结果" subtitle={`${filteredCalls.length ? Math.round(resultData[0].count / filteredCalls.length * 100) : 0}% 成功率`}>
          <div className="chart-data" data-testid="result-chart" data-success={resultData[0].count} data-failure={resultData[1].count}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={resultData} margin={{ top: 8, right: 6, left: -24, bottom: 0 }}>
                <CartesianGrid stroke="#edf0f5" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#778196', fontSize: 10 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 10 }} />
                <Tooltip cursor={{ fill: '#f6f7fb' }} contentStyle={{ borderRadius: 10, border: '1px solid #e8ebf2' }} />
                <Bar isAnimationActive={false} dataKey="count" name="次数" radius={[5, 5, 0, 0]}>
                  <Cell fill="#24aa87" /><Cell fill="#ed795e" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>
      </div>
      <section className="panel table-panel call-trace-panel">
        <div className="panel-title">
          <div><h3>调用追踪</h3><p>一行一次运行 · 当前显示 {filteredCalls.length} 条模拟记录 · 点击记录 ID 查看字段来源</p></div>
          <div className="trace-legend">
            <span><i className="web" />广场 Web：记录用户与用户组织</span>
            <span><i className="api" />外部 API：记录密钥与调用方组织</span>
            <button className="secondary-button"><Download size={15} /> 导出当前</button>
          </div>
        </div>
        <div data-testid="agent-call-table">
          <CallTraceTable records={filteredCalls} onSelect={setSelectedCall} selectedId={selectedCall?.recordId} />
        </div>
        {selectedCall && <CallTraceDetails record={selectedCall} onClose={() => setSelectedCall(null)} />}
      </section>
      <section className="panel table-panel">
        <div className="panel-title">
          <div><h3>发布资源校验</h3><p>未批准的插件、工具或 MCP 仅在发布工单中告警</p></div>
          <button className="text-button">查看发布工单 <ArrowRight size={15} /></button>
        </div>
        <DataTable columns={data.columns} rows={data.rows} onAction={(row) => onWorkOrder(`发布资源校验 · ${row[0]}`)} />
      </section>
    </>
  )
}

function MonitorPage({ view, onWorkOrder }: { view: View; onWorkOrder: (title: string) => void }) {
  const data = monitorData[view]
  if (!data) return null
  if (view === 'agents') return <AgentMonitorPage onWorkOrder={onWorkOrder} />
  return (
    <>
      <PageHeader
        view={view}
        action={<div className="time-filter"><button>1 小时</button><button className="active">24 小时</button><button>7 天</button></div>}
      />
      {(['knowledge', 'plugins', 'mcp', 'skills'] as View[]).includes(view) && (
        <RepositoryAvailability key={view} defaultCategory={view as AvailabilityCategory} />
      )}
      <div className={`metric-grid ${data.metrics.length === 6 ? 'six' : 'five'}`}>
        {data.metrics.map(([label, value, delta], i) => (
          <article className="metric-card" key={label}>
            <div className={`metric-icon tone-${(i % 5) + 1}`}>
              {view === 'security' ? <ShieldAlert size={19} /> : view === 'skills' ? <Download size={19} /> : <Activity size={19} />}
            </div>
            <span>{label}</span><strong>{value}</strong><small>{delta}</small>
          </article>
        ))}
      </div>
      <div className="dashboard-grid two-column">
        <ChartPanel title={data.chartTitle} subtitle={data.chartSubtitle} wide>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#edf0f5" vertical={false} />
              <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8ebf2' }} />
              <Line isAnimationActive={false} type="monotone" dataKey="total" name="总量" stroke="#5b6cf9" strokeWidth={2.5} dot={false} />
              <Line isAnimationActive={false} type="monotone" dataKey="success" name="成功" stroke="#22a98a" strokeWidth={2.2} dot={false} />
              <Line isAnimationActive={false} type="monotone" dataKey="alert" name="异常" stroke="#ed795e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title={data.barsTitle} subtitle="当前统计窗口">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categoryData} layout="vertical" margin={{ top: 5, right: 10, left: 5, bottom: 0 }}>
              <CartesianGrid stroke="#edf0f5" horizontal={false} />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={52} axisLine={false} tickLine={false} tick={{ fill: '#667085', fontSize: 11 }} />
              <Tooltip cursor={{ fill: '#f6f7fb' }} contentStyle={{ borderRadius: 10, border: '1px solid #e8ebf2' }} />
              <Bar isAnimationActive={false} dataKey="value" fill="#7168ed" radius={[0, 5, 5, 0]} barSize={12} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
      <section className="panel table-panel">
        <div className="panel-title">
          <div><h3>{data.tableTitle}</h3><p>点击行尾工单按钮查看预填详情</p></div>
          <div className="panel-actions"><button className="secondary-button"><Filter size={15} /> 筛选</button><button className="secondary-button"><Download size={15} /> 导出当前</button></div>
        </div>
        <DataTable columns={data.columns} rows={data.rows} onAction={(row) => onWorkOrder(`${data.tableTitle} · ${row[2] ?? row[0]}`)} />
      </section>
    </>
  )
}

function ChartPanel({ title, subtitle, wide, children }: { title: string; subtitle: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`panel chart-panel ${wide ? 'wide' : ''}`}>
      <div className="panel-title">
        <div><h3>{title}</h3><p>{subtitle}</p></div>
        <button className="more-button">•••</button>
      </div>
      <div className="chart-body">{children}</div>
    </section>
  )
}

function DataTable({ columns, rows, onAction }: { columns: string[]; rows: string[][]; onAction?: (row: string[]) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}{onAction && <th>操作</th>}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`}>
                  {cell === '能用' ? <span className="status success">{cell}</span>
                    : cell === '不能用' ? <span className="status danger">{cell}</span>
                    : /(正常|成功|已完成|一致|已批准|允许|已恢复|已关闭)/.test(cell) ? <span className="status success">{cell}</span>
                    : /(严重|紧急|失败|异常|冲突|未批准|禁止|停滞)/.test(cell) ? <span className="status danger">{cell}</span>
                    : /(进行中|审核中|待|观察|一般|波动)/.test(cell) ? <span className="status warning">{cell}</span>
                    : cell}
                </td>
              ))}
              {onAction && <td><button className="row-action" onClick={() => onAction(row)}>打开工单 <ArrowRight size={13} /></button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const callTraceColumns = [
  ['平台调用记录ID', '本平台入口记录'],
  ['时间', '本平台入口记录'],
  ['调用方式', '本平台入口记录'],
  ['用户账户名', '广场 Web 由本平台入口记录'],
  ['用户组织', '广场 Web 由本平台入口记录'],
  ['密钥登记ID', '外部 API 由本平台入口记录'],
  ['调用方名称', '外部 API 由本平台入口记录'],
  ['调用方组织', '外部 API 由本平台入口记录'],
  ['来源IP', '本平台入口记录，不来自 Dify 表'],
  ['API路径', '本平台入口记录'],
  ['应用ID', 'Dify messages.app_id 或 workflow_runs.app_id'],
  ['应用名', '按应用 ID 关联 Dify 应用'],
  ['应用模式', 'Dify messages.app_mode 或应用配置'],
  ['Dify消息ID', 'Dify messages.id；纯工作流显示“—”'],
  ['Dify运行ID', 'Dify workflow_runs.id；非工作流消息显示“—”'],
  ['模型调用摘要（多值）', 'messages.model_provider/model_id，或 workflow_node_executions.process_data'],
  ['Token总数', 'workflow_runs.total_tokens，或 messages.message_tokens + answer_tokens'],
  ['知识库检索摘要（多值）', 'dataset_retriever_resources，或知识检索节点执行记录'],
  ['MCP调用摘要（多值）', 'workflow_node_executions + workflow_runs.graph；Agent 兼容 message_agent_thoughts'],
  ['插件调用摘要（多值）', 'workflow_node_executions + workflow_runs.graph；Agent 兼容 message_agent_thoughts'],
  ['耗时', 'workflow_runs.elapsed_time 或 messages.provider_response_latency'],
  ['HTTP响应状态', '本平台入口记录'],
  ['业务结果', 'Dify workflow_runs.status 或 messages.status'],
  ['错误码', '本平台归一化错误码，保留 Dify 原始错误'],
] as const

function TraceSummary({ items, empty = '未使用' }: { items: string[]; empty?: string }) {
  if (!items.length) return <span className="trace-empty">— · {empty}</span>
  return (
    <span className="trace-summary">
      {items.map((item) => <span key={item}>{item}</span>)}
    </span>
  )
}

function CallTraceTable({
  records,
  onSelect,
  selectedId,
}: {
  records: AgentCallRecord[]
  onSelect: (record: AgentCallRecord) => void
  selectedId?: string
}) {
  return (
    <div className="table-wrap call-trace-wrap">
      <table className="call-trace-table">
        <thead>
          <tr>{callTraceColumns.map(([label, source]) => <th key={label} title={source}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.recordId} className={record.recordId === selectedId ? 'selected' : ''}>
              <td><button className="trace-record-link" onClick={() => onSelect(record)}>{record.recordId}</button></td>
              <td>{record.time}</td>
              <td><span className={`method-tag ${record.method === '广场 Web' ? 'web' : 'api'}`}>{record.method}</span></td>
              <td>{record.userAccount}</td>
              <td>{record.userOrg}</td>
              <td>{record.keyId}</td>
              <td>{record.callerName}</td>
              <td>{record.callerOrg}</td>
              <td className="mono-cell">{record.sourceIp}</td>
              <td className="mono-cell">{record.apiPath}</td>
              <td className="mono-cell">{record.appId}</td>
              <td className="strong-cell">{record.appName}</td>
              <td><span className="mode-tag">{record.appMode}</span></td>
              <td className="mono-cell">{record.messageId}</td>
              <td className="mono-cell">{record.runId}</td>
              <td><TraceSummary items={record.models} /></td>
              <td className="token-cell">{record.totalTokens}</td>
              <td><TraceSummary items={record.knowledgeBases} /></td>
              <td><TraceSummary items={record.mcpCalls} empty="未调用 MCP" /></td>
              <td><TraceSummary items={record.pluginCalls} empty="未调用插件" /></td>
              <td>{record.duration}</td>
              <td className="mono-cell">{record.httpStatus}</td>
              <td><span className={`status ${record.result === '成功' ? 'success' : 'danger'}`}>{record.result}</span></td>
              <td className={`mono-cell ${record.errorCode !== '—' ? 'error-code' : ''}`}>{record.errorCode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CallTraceDetails({ record, onClose }: { record: AgentCallRecord; onClose: () => void }) {
  const platformIdentity = record.method === '广场 Web'
    ? `${record.userAccount} · ${record.userOrg}`
    : `${record.keyId} · ${record.callerName} · ${record.callerOrg}`
  return (
    <aside className="trace-details" data-testid="call-trace-details">
      <div className="trace-details-head">
        <div>
          <span className="mini-label">运行证据</span>
          <h4>{record.appName} <em>{record.recordId}</em></h4>
          <p>{record.time} · {record.method} · {platformIdentity}</p>
        </div>
        <div>
          <span className={`status ${record.result === '成功' ? 'success' : 'danger'}`}>{record.result}</span>
          <button aria-label="关闭调用详情" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div className="trace-details-grid">
        <section>
          <h5>平台入口记录</h5>
          <dl>
            <div><dt>身份口径</dt><dd>{platformIdentity}</dd></div>
            <div><dt>来源 IP</dt><dd>{record.sourceIp}</dd></div>
            <div><dt>API 路径</dt><dd>{record.apiPath}</dd></div>
            <div><dt>HTTP / 错误码</dt><dd>{record.httpStatus} / {record.errorCode}</dd></div>
          </dl>
          <small>IP、账户或密钥登记、组织只由平台入口记录，不从 Dify 表反推。</small>
        </section>
        <section>
          <h5>Dify 运行记录</h5>
          <dl>
            <div><dt>应用</dt><dd>{record.appId} · {record.appMode}</dd></div>
            <div><dt>消息 ID</dt><dd>{record.messageId}</dd></div>
            <div><dt>运行 ID</dt><dd>{record.runId}</dd></div>
            <div><dt>耗时 / Token</dt><dd>{record.duration} / {record.totalTokens}</dd></div>
          </dl>
          <small>{record.runId === '—' ? '主记录：messages' : '主记录：workflow_runs；消息型运行同时关联 messages'}</small>
        </section>
        <section className="trace-resource-detail">
          <h5>本次实际使用资源</h5>
          <div><strong>模型</strong><TraceSummary items={record.models} /></div>
          <div><strong>知识库</strong><TraceSummary items={record.knowledgeBases} /></div>
          <div><strong>MCP</strong><TraceSummary items={record.mcpCalls} empty="未调用 MCP" /></div>
          <div><strong>插件</strong><TraceSummary items={record.pluginCalls} empty="未调用插件" /></div>
        </section>
      </div>
      <div className="trace-source-note">
        <Database size={15} />
        <span>模型与节点 Token 来自 <code>workflow_node_executions</code> 或 <code>messages</code>；知识库命中来自 <code>dataset_retriever_resources</code> 或知识检索节点；MCP、插件来自节点执行记录和该次运行的 <code>workflow_runs.graph</code> 快照。</span>
      </div>
    </aside>
  )
}

function ChatApplication({ role, onSubmitted }: { role: Role; onSubmitted: () => void }) {
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const submitMessage = () => {
    if (message.trim()) setSent(true)
  }
  return (
    <>
      <PageHeader view="chat" action={<button className="secondary-button"><Plus size={16} /> 新建会话</button>} />
      <div className="application-split">
        <section className="chat-pane">
          <div className="pane-head">
            <div><span className="assistant-avatar"><Sparkles size={17} /></span><div><strong>申请助手</strong><small><span /> 在线 · 仅匹配和填表，不代替审批</small></div></div>
            <button className="text-button">清空会话</button>
          </div>
          <div className="chat-stream">
            <div className="date-divider">今天 20:46</div>
            <div className="chat-row assistant">
              <span className="assistant-avatar"><Sparkles size={16} /></span>
              <div className="bubble">你好，我可以帮你匹配工单并补全字段。请描述你想做什么，例如“把我的知识库分享给业务一部”。</div>
            </div>
            {sent && (
              <>
                <div className="chat-row me"><div className="bubble">{message}</div><span className={`avatar avatar-${role}`}>{role === 'user' ? '陈' : role === 'ops' ? '周' : '李'}</span></div>
                <div className="chat-row assistant">
                  <span className="assistant-avatar"><Sparkles size={16} /></span>
                  <div className="bubble result-bubble">
                    <div className="match-head"><span>已完成意图识别</span><b>置信度 96%</b></div>
                    <dl>
                      <div><dt>识别目标</dt><dd>发布并分享知识库</dd></div>
                      <div><dt>匹配类型</dt><dd>KB-02 知识库发布 / 分享申请</dd></div>
                      <div><dt>已提取</dt><dd>对象：反诈话术资料库；范围：业务一部</dd></div>
                      <div><dt>仍需回答</dt><dd>业务用途、密级、目录展示名称</dd></div>
                    </dl>
                    <p>右侧草稿已经更新。补充必填项后即可检查并提交。</p>
                  </div>
                </div>
              </>
            )}
            {submitted && (
              <div className="submit-success"><span><Check size={18} /></span><div><strong>工单已提交</strong><small>WO-20261115-0136 · 当前节点：系统校验</small></div></div>
            )}
          </div>
          <div className="chat-composer">
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="描述你想做的事情，尽量说清对象、动作和用途…" />
            <div><button className="attach-button"><Plus size={17} /> 添加附件</button><span>{message.length} / 2000</span><button className="send-button" onClick={submitMessage}><Send size={17} /></button></div>
          </div>
        </section>
        <section className="draft-pane">
          <div className="draft-head">
            <div><span className="mini-label">实时生成</span><h3>工单草稿</h3></div>
            <span className={`draft-state ${sent ? 'ready' : ''}`}>{sent ? '填写中' : '等待描述'}</span>
          </div>
          <div className="match-summary">
            <div><small>匹配工单类型</small><strong>{sent ? 'KB-02 知识库发布 / 分享申请' : '尚未匹配'}</strong></div>
            <div><span><small>审批模式</small><strong>{sent ? '人工审批' : '—'}</strong></span><span><small>预计流程</small><strong>{sent ? '5 个节点' : '—'}</strong></span></div>
          </div>
          {sent ? (
            <div className="form-body">
              <FormField label="工单标题" source="用户" required><input defaultValue="反诈话术资料库发布至业务一部" /></FormField>
              <div className="form-row">
                <FormField label="来源系统" source="用户" required><select defaultValue="RAGFlow"><option>RAGFlow</option><option>Dify</option></select></FormField>
                <FormField label="知识库 ID" source="用户" required><select><option>kb_rf_94820 · 反诈话术资料库</option></select></FormField>
              </div>
              <div className="form-row">
                <FormField label="知识库名称" source="RAGFlow API"><input value="反诈话术资料库" readOnly /></FormField>
                <FormField label="文档数" source="RAGFlow API"><input value="186" readOnly /></FormField>
              </div>
              <div className="form-row">
                <FormField label="分享方式" source="用户" required><select><option>指定组织</option><option>共享目录</option><option>指定人员</option></select></FormField>
                <FormField label="目标组织" source="用户" required><select><option>业务一部</option></select></FormField>
              </div>
              <FormField label="业务用途" source="用户" required><textarea placeholder="说明业务场景与必要性" /></FormField>
              <div className="form-row">
                <FormField label="密级" source="用户" required><select defaultValue=""><option value="" disabled>请选择</option><option>内部</option><option>敏感</option></select></FormField>
                <FormField label="模型目录核对" source="本平台"><input value="一致 · bge-m3" readOnly /></FormField>
              </div>
              <div className="security-check"><ShieldCheck size={17} /><span><strong>文档安全审查</strong><small>已审查 186 · 通过 183 · 未确认 3</small></span><em>提交后由运维确认</em></div>
            </div>
          ) : (
            <div className="draft-empty"><div><WandSparkles size={28} /></div><strong>从一句话开始</strong><p>助手识别意图后，会在这里生成可编辑的工单草稿。</p></div>
          )}
          <div className="draft-actions">
            <button className="secondary-button" disabled={!sent}>保存草稿</button>
            <button className="secondary-button" disabled={!sent}>检查</button>
            <button className="primary-button" disabled={!sent || submitted} onClick={() => { setSubmitted(true); onSubmitted() }}>{submitted ? '已提交' : '提交申请'} <ArrowRight size={16} /></button>
          </div>
        </section>
      </div>
    </>
  )
}

function FormField({ label, source, required, children }: { label: string; source: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="form-field">
      <span>{label}{required && <b>*</b>}<em>{source}</em></span>
      {children}
    </label>
  )
}

function ManualApplication({ role }: { role: Role }) {
  const availableTypes = role === 'admin' ? [...ticketTypes, ...adminTicketTypes] : ticketTypes
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [selected, setSelected] = useState(availableTypes[0])
  const filtered = availableTypes.filter((item) =>
    (category === '全部' || item[2] === category) &&
    (`${item[0]}${item[1]}${item[4]}`.toLowerCase().includes(query.toLowerCase()))
  )
  const categories = ['全部', '知识库', '智能体', '插件', 'MCP', 'Skill', '凭证', '工具', '告警', ...(role === 'admin' ? ['账号'] : [])]
  return (
    <>
      <PageHeader view="manual" />
      <div className="manual-layout">
        <aside className="catalog-pane">
          <div className="catalog-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索类型、编码或场景" /></div>
          <div className="category-tabs">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
          <div className="type-list">
            {filtered.map((item) => (
              <button key={item[0]} className={selected[0] === item[0] ? 'active' : ''} onClick={() => setSelected(item)}>
                <span className="type-code">{item[0]}</span>
                <span><strong>{item[1]}</strong><small>{item[4]}</small></span>
                <em className={item[3] === '即办' ? 'instant' : ''}>{item[3]}</em>
              </button>
            ))}
          </div>
        </aside>
        <section className="manual-form">
          <div className="form-title">
            <div><span className="type-code large">{selected[0]}</span><div><h3>{selected[1]}</h3><p>{selected[4]}</p></div></div>
            <span className={selected[3] === '即办' ? 'approval instant' : 'approval'}>{selected[3] === '即办' ? <Zap size={14} /> : <Clock3 size={14} />}{selected[3]}</span>
          </div>
          <div className="stepper"><span className="active"><b>1</b>申请对象</span><i /><span><b>2</b>业务信息</span><i /><span><b>3</b>检查提交</span></div>
          <div className="form-section">
            <div className="section-heading"><span>01</span><div><h4>基本信息</h4><p>填写工单标题与申请说明</p></div></div>
            <FormField label="工单标题" source="用户" required><input placeholder={`请输入${selected[1]}标题`} /></FormField>
            <div className="form-row">
              <FormField label="申请人" source="本平台"><input value={role === 'user' ? '陈宇 · chen.yu' : role === 'ops' ? '周敏 · zhou.min' : '李强 · li.qiang'} readOnly /></FormField>
              <FormField label="申请组织" source="本平台"><input value={role === 'user' ? '业务一部' : role === 'ops' ? '平台运营组' : '系统管理组'} readOnly /></FormField>
            </div>
            <FormField label="申请说明" source="用户" required><textarea placeholder="请说明申请背景、业务用途和必要性" /></FormField>
          </div>
          <div className="form-section">
            <div className="section-heading"><span>02</span><div><h4>申请对象</h4><p>来源数据将在选择后自动刷新</p></div></div>
            {selected[2] === '账号' ? (
              <div className="form-row">
                <FormField label="目标人员" source="用户" required><select><option>请选择组织目录人员</option></select></FormField>
                <FormField label="操作类型" source="用户" required><select><option>开通</option><option>停用</option><option>组织变更</option><option>角色变更</option></select></FormField>
              </div>
            ) : (
              <div className="form-row">
                <FormField label="来源系统" source="用户" required><select><option>请选择</option><option>RAGFlow</option><option>Dify</option><option>本平台</option></select></FormField>
                <FormField label={`${selected[2]}资源`} source="用户" required><select><option>请选择已同步资源</option></select></FormField>
              </div>
            )}
            <div className="read-source"><Activity size={16} /><span><strong>等待选择资源</strong><small>选择后将读取名称、所有者、状态和版本等只读字段</small></span></div>
          </div>
          <div className="manual-actions"><button className="secondary-button">保存草稿</button><button className="secondary-button"><ClipboardCheck size={15} /> 检查</button><button className="primary-button">提交申请 <ArrowRight size={16} /></button></div>
        </section>
      </div>
    </>
  )
}

function TicketList({ view, role, onWorkOrder }: { view: 'mine' | 'todo' | 'query'; role: Role; onWorkOrder: (title: string) => void }) {
  const isTodo = view === 'todo'
  const isQuery = view === 'query'
  const adminRows = role === 'admin' && (isTodo || isQuery)
    ? [['ACC-20261115-0031', '跨平台账号开通 / 权限变更', '为林杰开通三方账号', '待受理', '账号配置办理', '今天 19:08']]
    : []
  const rows = isTodo
    ? [
      ['EVT-20261115-0088', '告警研判与处置', 'plugin daemon 健康波动', '未研判', '告警研判', '今天 20:42'],
      ['PLG-20261115-0079', '插件上架申请', 'document-parser 2.5.0 上架', '审核中', '安全复核', '今天 18:16'],
      ['KB-20261115-0065', '知识库发布 / 分享申请', '经侦案例知识库发布', '待受理', '运维受理', '今天 16:09'],
      ...adminRows,
    ]
    : isQuery
      ? [...workOrders, ...adminRows]
      : workOrders
  const tabs = isTodo
    ? (role === 'admin' ? ['账号类待办 3', '运维待办 12'] : ['全部待办 12', '待受理 4', '审核中 5', '系统事件 3'])
    : ['全部', '草稿', '办理中', '待补正', '已完成', '已驳回', '执行失败', '已终止']
  return (
    <>
      <PageHeader
        view={view}
        action={isQuery ? <button className="secondary-button"><Download size={15} /> 导出当前筛选</button> : undefined}
      />
      <section className="panel list-panel">
        <div className="list-toolbar">
          <div className="status-tabs">{tabs.map((tab, index) => <button className={index === 0 ? 'active' : ''} key={tab}>{tab}</button>)}</div>
          <div className="list-search"><Search size={16} /><input placeholder="搜索工单号或标题" /></div>
          <button className="secondary-button compact"><Filter size={15} /> 筛选</button>
        </div>
        <DataTable
          columns={['工单号', '工单类型', '工单标题', '当前状态', '当前节点', '最后更新']}
          rows={rows}
          onAction={(row) => onWorkOrder(`${row[0]} · ${row[2]}`)}
        />
        <div className="pagination"><span>共 {rows.length} 条</span><button disabled>上一页</button><button className="active">1</button><button>2</button><button>下一页</button></div>
      </section>
    </>
  )
}

function TicketTypes() {
  const [editing, setEditing] = useState(false)
  const rows = [
    ['KB-02', '知识库发布 / 分享申请', '知识库', '人工审批', 'v3.2', '已发布', '全部组织', '今天 18:20', '李强', '12'],
    ['AG-02', '智能体发布 / 分享申请', '智能体', '人工审批', 'v2.8', '已发布', '全部组织', '今天 15:06', '李强', '18'],
    ['ACC-01', '跨平台账号开通 / 权限变更', '账号', '人工审批', 'v1.6', '已发布', '系统管理组', '昨天 16:42', '王宁', '3'],
    ['PLG-01', '插件上架申请', '插件', '人工审批', 'v2.1', '测试中', '全部组织', '昨天 11:18', '李强', '0'],
    ['SKL-03', 'Skill 下载', 'Skill', '即办', 'v1.3', '已发布', '全部组织', '11-13 09:24', '王宁', '0'],
  ]
  if (editing) {
    return (
      <>
        <PageHeader view="types" action={<button className="secondary-button" onClick={() => setEditing(false)}><X size={15} /> 返回列表</button>} />
        <div className="type-editor">
          <aside>
            {['基本信息', '字段设计器', '流程设计器', '校验与执行', '通知与权限', '版本与测试'].map((item, i) => <button className={i === 0 ? 'active' : ''} key={item}><span>{i + 1}</span>{item}{i === 0 && <Check size={15} />}</button>)}
          </aside>
          <section>
            <div className="editor-head"><div><span className="mini-label">新建草稿</span><h3>定义工单类型</h3><p>发布后编码不可修改，在途工单锁定提交时版本。</p></div><span className="status warning">草稿 v1.0</span></div>
            <div className="editor-section">
              <h4>基本信息</h4>
              <div className="form-row"><FormField label="类型编码" source="系统管理员" required><input placeholder="例如 KB-06" /></FormField><FormField label="类型名称" source="系统管理员" required><input placeholder="请输入清晰的类型名称" /></FormField></div>
              <FormField label="类型说明" source="系统管理员" required><textarea placeholder="说明适用场景、边界和办理结果" /></FormField>
              <div className="form-row"><FormField label="所属对象" source="系统管理员" required><select><option>请选择</option><option>知识库</option><option>智能体</option><option>插件</option><option>MCP</option></select></FormField><FormField label="审批模式" source="系统管理员" required><select><option>人工审批</option><option>即办</option><option>运维确认</option><option>系统事件</option></select></FormField></div>
              <div className="form-row"><FormField label="申请人角色" source="系统管理员" required><div className="choice-box"><span><Check size={13} /> 用户</span><span><Check size={13} /> 运维人员</span></div></FormField><FormField label="启用组织" source="系统管理员" required><select><option>全部组织</option></select></FormField></div>
              <FormField label="匹配意图示例" source="系统管理员"><textarea placeholder="每行一个用户可能的表达，用于对话申请匹配" /></FormField>
            </div>
            <div className="editor-actions"><button className="secondary-button">保存草稿</button><button className="secondary-button">运行测试</button><button className="primary-button">下一步：字段设计 <ArrowRight size={16} /></button></div>
          </section>
        </div>
      </>
    )
  }
  return (
    <>
      <PageHeader view="types" action={<button className="primary-button" onClick={() => setEditing(true)}><Plus size={16} /> 新建工单类型</button>} />
      <section className="panel list-panel">
        <div className="list-toolbar">
          <div className="list-search wide"><Search size={16} /><input placeholder="搜索类型编码或名称" /></div>
          <button className="secondary-button compact"><Filter size={15} /> 所属对象</button>
          <button className="secondary-button compact">状态：全部 <ChevronDown size={14} /></button>
        </div>
        <DataTable columns={['类型编码', '类型名称', '所属对象', '审批模式', '当前版本', '状态', '启用范围', '最近发布', '发布人', '在途']} rows={rows} onAction={() => setEditing(true)} />
      </section>
    </>
  )
}

function WorkOrderDrawer({ title, role, onClose }: { title: string; role: Role; onClose: () => void }) {
  const readonly = role === 'admin' && !title.includes('ACC')
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="work-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head"><div><span className="mini-label">关联工单</span><h3>{title}</h3></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
        <div className="drawer-banner">
          <span className="type-code large">{title.includes('plugin') || title.includes('插件') ? 'PLG-04' : title.includes('账号') || title.includes('ACC') ? 'ACC-01' : 'EVT-01'}</span>
          <div><strong>{readonly ? '只读详情' : '预填工单已就绪'}</strong><small>{readonly ? '系统管理员不能办理业务工单或系统事件' : '资源信息和证据已自动带入'}</small></div>
        </div>
        <div className="drawer-timeline">
          <div className="done"><span><Check size={13} /></span><p><strong>系统创建</strong><small>今天 20:42:18</small></p></div>
          <i />
          <div className="active"><span>2</span><p><strong>{readonly ? '等待运维办理' : '待研判'}</strong><small>当前节点</small></p></div>
          <i />
          <div><span>3</span><p><strong>处置与复核</strong><small>尚未开始</small></p></div>
        </div>
        <div className="drawer-section"><h4>对象信息</h4><dl className="detail-list"><div><dt>对象类型</dt><dd>插件</dd></div><div><dt>对象名称</dt><dd>document-parser</dd></div><div><dt>Workspace</dt><dd>ws_84f2</dd></div><div><dt>关联告警</dt><dd>ALT-20261115-0842</dd></div></dl></div>
        <div className="drawer-section"><h4>触发证据</h4><div className="evidence-box"><AlertTriangle size={18} /><span><strong>5 分钟失败率达到 46.8%</strong><small>阈值 30% · 共 47 次调用 · 22 次失败</small></span></div></div>
        <div className="drawer-section"><h4>办理意见</h4><textarea placeholder={readonly ? '当前角色仅可查看' : '填写研判结论与处置意见'} disabled={readonly} /></div>
        <div className="drawer-actions">
          <button className="secondary-button" onClick={onClose}>{readonly ? '关闭' : '退回补正'}</button>
          {!readonly && <button className="primary-button">进入工单办理 <ArrowRight size={16} /></button>}
        </div>
      </aside>
    </div>
  )
}

function App() {
  const [role, setRole] = useState<Role | null>(null)
  const [view, setView] = useState<View>('overview')
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState('')
  const identity = useMemo(() => identities.find((item) => item.role === role), [role])

  const login = (nextRole: Role) => {
    setRole(nextRole)
    setView(nextRole === 'user' ? 'chat' : 'overview')
  }

  if (!role || !identity) return <Login onLogin={login} />

  const allowedMonitor = role !== 'user'
  const monitorViews: View[] = ['overview', 'knowledge', 'agents', 'plugins', 'mcp', 'skills', 'security', 'accounts', 'audit']
  const safeView = !allowedMonitor && monitorViews.includes(view) ? 'chat' : view

  let content: React.ReactNode
  if (safeView === 'overview') content = <Overview role={role} onWorkOrder={setDrawer} />
  else if (monitorViews.includes(safeView)) content = <MonitorPage view={safeView} onWorkOrder={setDrawer} />
  else if (safeView === 'chat') content = <ChatApplication role={role} onSubmitted={() => undefined} />
  else if (safeView === 'manual') content = <ManualApplication role={role} />
  else if (safeView === 'mine' || safeView === 'todo' || safeView === 'query') content = <TicketList view={safeView} role={role} onWorkOrder={setDrawer} />
  else if (safeView === 'types' && role === 'admin') content = <TicketTypes />
  else content = <ChatApplication role={role} onSubmitted={() => undefined} />

  return (
    <div className="app-shell">
      <Sidebar identity={identity} view={safeView} onNavigate={setView} collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)} />
      <div className={`app-main ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <Topbar identity={identity} onNavigate={setView} onLogout={() => { setRole(null); setView('overview') }} />
        <main className="page-content">{content}</main>
      </div>
      {drawer && <WorkOrderDrawer title={drawer} role={role} onClose={() => setDrawer('')} />}
    </div>
  )
}

export default App
