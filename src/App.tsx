import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowRight, Bell, Bot,
  Check, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck,
  ClipboardList, Clock3, Code2, Copy, Database, Download, FileCheck2, FilePlus2, Filter,
  Gauge, Headphones, History, KeyRound, Layers3, ListChecks, LogOut,
  MessageSquareText, Network, PackageCheck, PanelLeftClose, Play, PlugZap, Plus,
  Radar, Search, Send, ServerCog, ShieldAlert, ShieldCheck, Sparkles, Tag,
  Terminal, Trophy, UserCog, Users, WandSparkles, Workflow, X, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import './App.css'

type Role = 'user' | 'ops' | 'admin'
type View =
  | 'overview' | 'knowledge' | 'agents' | 'agentMonitor'
  | 'pluginWarehouse' | 'mcpWarehouse' | 'skillWarehouse'
  | 'plugins' | 'mcp' | 'skills'
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
    org: '业务一部', initials: '陈', note: '查看可用仓库、跟踪本人申请',
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

const warehouseNav: NavItem[] = [
  { id: 'agents', label: '智能体仓库', icon: Bot },
  { id: 'pluginWarehouse', label: '插件仓库', icon: PlugZap },
  { id: 'mcpWarehouse', label: 'MCP仓库', icon: Network },
  { id: 'skillWarehouse', label: 'Skill仓库', icon: PackageCheck },
]

const monitorNav: NavItem[] = [
  { id: 'overview', label: '统一概览', icon: Gauge },
  { id: 'knowledge', label: '知识库', icon: Database },
  { id: 'agentMonitor', label: '智能体监控', icon: Radar },
  { id: 'plugins', label: '插件监控', icon: PlugZap },
  { id: 'mcp', label: 'MCP监控', icon: Network },
  { id: 'skills', label: 'Skill监控', icon: PackageCheck },
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
  agents: { title: '智能体仓库', eyebrow: '工单应用', desc: '查看已经生效的智能体。普通用户只看到自己能用的应用和成功调用排行；运维人员和管理员还能看到下架项和工单号。' },
  agentMonitor: { title: '智能体监控', eyebrow: 'Dify 全量', desc: '按账户查看 Dify 上的全部智能体、应用数量和调用记录。调用次数含成功和失败，可筛选并逐条溯源。' },
  pluginWarehouse: { title: '插件仓库', eyebrow: '可安装插件', desc: '查看已经生效的插件。能直接安装的生成即办工单，受限的提交安装申请。调用次数只用于排行。' },
  mcpWarehouse: { title: 'MCP仓库', eyebrow: '可绑定目录', desc: '查看已经生效的 MCP。能直接绑定的生成即办工单，受限的提交绑定申请。不展示统一 URL 原文。' },
  skillWarehouse: { title: 'Skill仓库', eyebrow: '可下载文件', desc: '查看已经生效的 Skill。普通用户只看到自己能下载的文件和成功下载排行；运维人员和管理员还能看到下架项。下载只生成 SKL-03，不统计运行。' },
  plugins: { title: '插件监控', eyebrow: '运行明细', desc: '查看全部插件安装、调用明细、daemon 健康、失败率和自动禁用记录。' },
  mcp: { title: 'MCP监控', eyebrow: '调用明细', desc: '按账户查看全部 MCP 绑定和调用明细，包括没有进仓库的 Dify 绑定。' },
  skills: { title: 'Skill监控', eyebrow: '下载明细', desc: '查看下载明细、下载趋势和下载人组织。这里没有运行告警，也不重复仓库里的下载排行。' },
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

type AppMode = 'chatbot' | 'agent-chat' | 'workflow' | 'advanced-chat'
type AppTraceProfile = {
  appId: string
  appMode: AppMode
  models: string[]
  knowledgeBases: string[]
  mcpCalls: string[]
  pluginCalls: string[]
}

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
  '文书草稿': {
    appId: 'app_doc_draft', appMode: 'chatbot',
    models: ['qwen / qwen-plus · 410入 / 96出'],
    knowledgeBases: [],
    mcpCalls: [],
    pluginCalls: [],
  },
  '警情分类实验': {
    appId: 'app_incident_lab', appMode: 'workflow',
    models: ['deepseek / deepseek-chat · 980入 / 210出'],
    knowledgeBases: ['警情处置规范（ds_incident_08）· 命中1段'],
    mcpCalls: [],
    pluginCalls: ['langgenius/json_process / parse · 成功 0.1s'],
  },
  '个人笔记助手': {
    appId: 'app_note', appMode: 'chatbot',
    models: ['qwen / qwen-turbo · 220入 / 80出'],
    knowledgeBases: [],
    mcpCalls: [],
    pluginCalls: [],
  },
  '旧版文书助手': {
    appId: 'app_legacy_doc', appMode: 'chatbot',
    models: ['openai / gpt-4.1-mini · 640入 / 120出'],
    knowledgeBases: ['文书范例库（ds_doc_06）· 命中1段'],
    mcpCalls: [],
    pluginCalls: [],
  },
  '资金研判实验版': {
    appId: 'app_fund_lab', appMode: 'workflow',
    models: ['deepseek / deepseek-chat · 540入 / 130出'],
    knowledgeBases: ['经侦指标库（ds_fund_05）· 命中1段'],
    mcpCalls: [],
    pluginCalls: ['langgenius/code / python · 成功 0.2s'],
  },
}

type UsageMethodId = 'run' | 'embed' | 'api'
type AgentModeLabel = '聊天助手' | 'Agent' | '工作流' | 'Chatflow'

const usageMethodCatalog: { id: UsageMethodId; label: string; hint: string }[] = [
  { id: 'run', label: '运行', hint: '把应用作为 Web 应用打开，直接对话使用。' },
  { id: 'embed', label: '嵌入网站', hint: '把应用嵌进已有业务页面。' },
  { id: 'api', label: '访问 API', hint: '用后端接口按次调用，密钥仍是已登记的 Dify 密钥。' },
]

const modeLabel: Record<AppMode, AgentModeLabel> = {
  chatbot: '聊天助手',
  'agent-chat': 'Agent',
  workflow: '工作流',
  'advanced-chat': 'Chatflow',
}

type AgentRelease = {
  version: string
  publishedAt: string
  changedAt: string
  summary: string
  ticket: string
}

type WarehouseAgent = {
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
  /** 空数组表示全网段可用。非空时，只有列出的组织能在用户仓库里看到。 */
  visibleOrgs: string[]
  releases: AgentRelease[]
}

const warehouseAgents: WarehouseAgent[] = [
  {
    id: 'app_case_summary', name: '案件摘要助手', emoji: '📋',
    developer: '陈宇', developerAccount: 'chen.yu', org: '业务一部',
    description: '读取案件材料、法规和文书范例，生成可复核的案件摘要，并标出引用出处。',
    tags: ['刑侦', '摘要', '文书'], directlyUsable: true, methods: ['run', 'embed', 'api'], unavailableReason: '', visibleOrgs: [],
    releases: [
      { version: 'v1.6', publishedAt: '11-16 20:18', changedAt: '11-16 19:46', summary: '接入档案检索，摘要增加出处标注', ticket: 'AG-20261116-0142' },
      { version: 'v1.5', publishedAt: '11-12 16:40', changedAt: '11-12 16:22', summary: '压缩摘要长度，保留关键事实段', ticket: 'AG-20261112-0098' },
      { version: 'v1.4', publishedAt: '11-08 09:15', changedAt: '11-08 09:02', summary: '首次通过发布工单上架', ticket: 'AG-20261108-0041' },
    ],
  },
  {
    id: 'app_incident_analysis', name: '警情辅助分析', emoji: '🚨',
    developer: '郑毅', developerAccount: 'zheng.yi', org: '情指中心',
    description: '按警情处置规范梳理要素、关联地点和历史警情，输出处置建议。',
    tags: ['情指', '研判'], directlyUsable: true, methods: ['run', 'api'], unavailableReason: '', visibleOrgs: [],
    releases: [
      { version: 'v2.8', publishedAt: '11-16 19:36', changedAt: '11-16 19:12', summary: '增加地点检索，关闭嵌入网站', ticket: 'AG-20261116-0136' },
      { version: 'v2.7', publishedAt: '11-09 11:20', changedAt: '11-09 10:48', summary: '调整警情分类提示词', ticket: 'AG-20261109-0066' },
    ],
  },
  {
    id: 'app_clue_agent', name: '线索分析 Agent', emoji: '🔎',
    developer: '吴凡', developerAccount: 'wu.fan', org: '网安支队',
    description: '面向网安线索的多步研判助手，会查询线索库并整理时间线。',
    tags: ['网安', 'Agent', '线索'], directlyUsable: true, methods: ['run', 'embed', 'api'], unavailableReason: '', visibleOrgs: ['网安支队'],
    releases: [
      { version: 'v3.2', publishedAt: '11-16 18:20', changedAt: '11-16 17:55', summary: '补充线索查询工具和图表输出', ticket: 'AG-20261116-0128' },
      { version: 'v3.1', publishedAt: '11-04 15:06', changedAt: '11-04 14:40', summary: '首次上架到仓库', ticket: 'AG-20261104-0033' },
    ],
  },
  {
    id: 'app_duty_qa', name: '勤务问答助手', emoji: '🗓️',
    developer: '孙宁', developerAccount: 'sun.ning', org: '治安支队',
    description: '根据勤务规范回答排班、备勤和现场处置问题，只引用已审核段落。',
    tags: ['治安', '问答'], directlyUsable: true, methods: ['run', 'embed'], unavailableReason: '', visibleOrgs: [],
    releases: [
      { version: 'v1.2', publishedAt: '11-16 17:42', changedAt: '11-16 17:18', summary: '更新勤务规范库引用范围', ticket: 'AG-20261116-0114' },
      { version: 'v1.1', publishedAt: '10-28 09:30', changedAt: '10-28 09:12', summary: '首次上架，仅开通运行和嵌入', ticket: 'AG-20261028-0020' },
    ],
  },
  {
    id: 'app_company_risk', name: '企业风险查询', emoji: '🏢',
    developer: '林杰', developerAccount: 'lin.jie', org: '经侦支队',
    description: '按企业名称查询风险规则命中项，并给出需要人工复核的点。',
    tags: ['经侦', '查询'], directlyUsable: true, methods: ['run'], unavailableReason: '', visibleOrgs: [],
    releases: [
      { version: 'v1.3', publishedAt: '11-15 14:22', changedAt: '11-15 13:50', summary: '收紧对外方式，仅保留运行', ticket: 'AG-20261115-0102' },
      { version: 'v1.0', publishedAt: '10-21 10:08', changedAt: '10-21 09:40', summary: '首次上架', ticket: 'AG-20261021-0018' },
    ],
  },
  {
    id: 'app_netlog_analysis', name: '网络日志研判', emoji: '🌐',
    developer: '吴凡', developerAccount: 'wu.fan', org: '网安支队',
    description: '对网络日志做规则命中和异常归纳，适合接入已有研判平台。',
    tags: ['网安', '日志'], directlyUsable: true, methods: ['run', 'api'], unavailableReason: '', visibleOrgs: ['网安支队'],
    releases: [
      { version: 'v2.0', publishedAt: '11-14 16:05', changedAt: '11-14 15:28', summary: '开放访问 API，保留运行', ticket: 'AG-20261114-0088' },
      { version: 'v1.4', publishedAt: '10-30 11:16', changedAt: '10-30 10:42', summary: '首次上架', ticket: 'AG-20261030-0026' },
    ],
  },
  {
    id: 'app_doc_check', name: '执法文书校验', emoji: '⚖️',
    developer: '唐雨', developerAccount: 'tang.yu', org: '刑侦支队',
    description: '按执法文书标准检查要素是否齐全，结果通过接口返回给办案系统。',
    tags: ['执法', '文书'], directlyUsable: true, methods: ['api'], unavailableReason: '', visibleOrgs: ['刑侦支队'],
    releases: [
      { version: 'v3.1', publishedAt: '11-13 18:40', changedAt: '11-13 18:06', summary: '只保留访问 API，供办案系统调用', ticket: 'AG-20261113-0074' },
      { version: 'v3.0', publishedAt: '10-18 09:24', changedAt: '10-18 08:55', summary: '首次上架', ticket: 'AG-20261018-0012' },
    ],
  },
  {
    id: 'app_case_link', name: '案件串并助手', emoji: '🔗',
    developer: '唐雨', developerAccount: 'tang.yu', org: '刑侦支队',
    description: '按案件特征查找相似案件，整理串并线索和差异点。',
    tags: ['刑侦', '串并'], directlyUsable: true, methods: ['run', 'embed', 'api'], unavailableReason: '', visibleOrgs: [],
    releases: [
      { version: 'v2.4', publishedAt: '11-16 15:08', changedAt: '11-16 14:36', summary: '串并结果增加图表说明', ticket: 'AG-20261116-0096' },
      { version: 'v2.3', publishedAt: '11-02 13:18', changedAt: '11-02 12:40', summary: '扩大特征库检索范围', ticket: 'AG-20261102-0029' },
    ],
  },
  {
    id: 'app_knowledge_search', name: '知识检索助手', emoji: '📚',
    developer: '陈宇', developerAccount: 'chen.yu', org: '业务一部',
    description: '在政策和办事指南中检索依据，回答时带出命中段落。',
    tags: ['检索', '问答'], directlyUsable: true, methods: ['run', 'embed'], unavailableReason: '', visibleOrgs: [],
    releases: [
      { version: 'v1.1', publishedAt: '11-11 10:26', changedAt: '11-11 09:58', summary: '增加办事指南库', ticket: 'AG-20261111-0052' },
      { version: 'v1.0', publishedAt: '10-25 16:12', changedAt: '10-25 15:40', summary: '首次上架', ticket: 'AG-20261025-0016' },
    ],
  },
  {
    id: 'app_fund_analysis', name: '资金研判助手', emoji: '💰',
    developer: '林杰', developerAccount: 'lin.jie', org: '经侦支队',
    description: '结合经侦指标和企业信息，辅助看资金往来里的异常点。',
    tags: ['经侦', '资金'], directlyUsable: true, methods: ['run', 'api'], unavailableReason: '', visibleOrgs: [],
    releases: [
      { version: 'v1.8', publishedAt: '11-15 09:48', changedAt: '11-15 09:10', summary: '接通企业查询，开通运行和 API', ticket: 'AG-20261115-0081' },
      { version: 'v1.5', publishedAt: '10-19 14:05', changedAt: '10-19 13:22', summary: '首次上架', ticket: 'AG-20261019-0009' },
    ],
  },
  {
    id: 'app_legacy_doc', name: '旧版文书助手', emoji: '📄',
    developer: '高峰', developerAccount: 'gao.feng', org: '业务一部',
    description: '早期文书生成应用。下架工单已经办结，三种使用方式全部关闭。',
    tags: ['文书'], directlyUsable: false, methods: [], unavailableReason: '下架工单已办结，应用已从可使用范围移除。', visibleOrgs: [],
    releases: [
      { version: 'v0.9', publishedAt: '09-18 11:00', changedAt: '11-16 16:28', summary: '执行下架，关闭运行、嵌入和 API', ticket: 'AG-20261116-0084' },
      { version: 'v0.8', publishedAt: '09-02 10:12', changedAt: '09-02 09:40', summary: '最后一次功能发布', ticket: 'AG-20260902-0004' },
    ],
  },
  {
    id: 'app_fund_lab', name: '资金研判实验版', emoji: '🧪',
    developer: '林杰', developerAccount: 'lin.jie', org: '经侦支队',
    description: '资金研判的试验流程。发布工单还在审核，当前不能直接使用。',
    tags: ['经侦', '实验'], directlyUsable: false, methods: [], unavailableReason: '发布工单仍在审核，通过后才会开通使用方式。', visibleOrgs: ['经侦支队'],
    releases: [
      { version: 'v0.3', publishedAt: '—', changedAt: '11-16 13:15', summary: '提交发布申请，等待审核', ticket: 'AG-20261116-0077' },
    ],
  },
]

const difyAccountDirectory = [
  { account: 'chen.yu', name: '陈宇', org: '业务一部' },
  { account: 'zheng.yi', name: '郑毅', org: '情指中心' },
  { account: 'wu.fan', name: '吴凡', org: '网安支队' },
  { account: 'lin.jie', name: '林杰', org: '经侦支队' },
  { account: 'sun.ning', name: '孙宁', org: '治安支队' },
  { account: 'tang.yu', name: '唐雨', org: '刑侦支队' },
  { account: 'gao.feng', name: '高峰', org: '业务一部' },
]

const difyOnlyApps: { ownerAccount: string; name: string }[] = [
  { ownerAccount: 'chen.yu', name: '文书草稿' },
  { ownerAccount: 'zheng.yi', name: '警情分类实验' },
  { ownerAccount: 'sun.ning', name: '个人笔记助手' },
]

const callerByIp: Record<string, string> = {
  '10.24.16.72': '广场用户 chen.yu · 业务一部',
  '10.24.16.93': '广场用户 gao.feng · 业务一部',
  '10.24.16.12': '外部 API · 移动警务门户 · 业务一部',
  '10.24.31.18': '外部 API · 警情数据交换服务 · 情指中心',
  '10.24.31.45': '广场用户 zheng.yi · 情指中心',
  '10.24.22.41': '广场用户 wu.fan · 网安支队',
  '10.24.22.19': '外部 API · 日志分析平台 · 网安支队',
  '10.24.40.26': '外部 API · 资金研判平台 · 经侦支队',
  '10.24.40.81': '广场用户 lin.jie · 经侦支队',
  '10.24.28.61': '广场用户 sun.ning · 治安支队',
  '10.24.36.54': '广场用户 tang.yu · 刑侦支队',
  '10.24.36.20': '外部 API · 案件协同系统 · 刑侦支队',
}

type InvocationLog = {
  seq: number
  time: string
  ownerAccount: string
  ownerName: string
  ownerOrg: string
  appName: string
  appId: string
  appMode: AgentModeLabel
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
}

const invocationDrafts: { account: string; appName: string; ip: string; count: number }[] = [
  { account: 'chen.yu', appName: '案件摘要助手', ip: '10.24.16.72', count: 8 },
  { account: 'chen.yu', appName: '案件摘要助手', ip: '10.24.36.54', count: 4 },
  { account: 'chen.yu', appName: '知识检索助手', ip: '10.24.16.72', count: 5 },
  { account: 'chen.yu', appName: '文书草稿', ip: '10.24.16.72', count: 2 },
  { account: 'zheng.yi', appName: '警情辅助分析', ip: '10.24.31.18', count: 7 },
  { account: 'zheng.yi', appName: '警情辅助分析', ip: '10.24.31.45', count: 3 },
  { account: 'zheng.yi', appName: '警情分类实验', ip: '10.24.31.45', count: 2 },
  { account: 'wu.fan', appName: '线索分析 Agent', ip: '10.24.22.41', count: 6 },
  { account: 'wu.fan', appName: '网络日志研判', ip: '10.24.22.19', count: 5 },
  { account: 'lin.jie', appName: '资金研判助手', ip: '10.24.40.26', count: 4 },
  { account: 'lin.jie', appName: '企业风险查询', ip: '10.24.40.81', count: 3 },
  { account: 'lin.jie', appName: '资金研判实验版', ip: '10.24.40.26', count: 1 },
  { account: 'sun.ning', appName: '勤务问答助手', ip: '10.24.28.61', count: 4 },
  { account: 'sun.ning', appName: '个人笔记助手', ip: '10.24.28.61', count: 1 },
  { account: 'tang.yu', appName: '案件串并助手', ip: '10.24.36.20', count: 6 },
  { account: 'tang.yu', appName: '执法文书校验', ip: '10.24.16.12', count: 3 },
  { account: 'gao.feng', appName: '旧版文书助手', ip: '10.24.16.93', count: 2 },
]

function modelLabelOf(item: string) {
  const head = item.split('·')[0]
  return (head.includes('/') ? head.split('/').pop() : head)?.trim() || head.trim()
}

function knowledgeLabelOf(item: string) {
  return item.split('·')[0].replace(/（.*?）/, '').trim()
}

function toolLabelOf(item: string) {
  return item.split('·')[0].split('/')[0].trim()
}

function pluginLabelOf(item: string) {
  const parts = item.split('·')[0].split('/').map((part) => part.trim())
  return parts[1] || parts[0]
}

function callClock(index: number) {
  const total = 20 * 60 + 48 - index * 7
  const hh = String(Math.floor(total / 60)).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  const ss = String((index * 13) % 60).padStart(2, '0')
  return `11-16 ${hh}:${mm}:${ss}`
}

const invocationLogs: InvocationLog[] = invocationDrafts.flatMap((draft) => {
  const owner = difyAccountDirectory.find((item) => item.account === draft.account)
  const profile = appTraceProfiles[draft.appName]
  return Array.from({ length: draft.count }, (_, offset) => {
    const stamp = `${draft.appName}-${draft.ip}-${offset}`
    const slot = stamp.length + offset
    const failed = slot % 9 === 8
    const models = slot % 3 === 0 ? profile.models : profile.models.slice(0, 1)
    const knowledgeBases = profile.knowledgeBases.slice(0, slot % 2 === 0 ? profile.knowledgeBases.length : 1)
    const mcpCalls = slot % 4 === 0 ? [] : profile.mcpCalls
    const pluginCalls = slot % 5 === 0 ? [] : profile.pluginCalls
    return {
      ownerAccount: draft.account,
      ownerName: owner?.name ?? draft.account,
      ownerOrg: owner?.org ?? '—',
      appName: draft.appName,
      appId: profile.appId,
      appMode: modeLabel[profile.appMode],
      sourceIp: draft.ip,
      caller: callerByIp[draft.ip] ?? draft.ip,
      models,
      modelLabels: models.map(modelLabelOf),
      knowledgeBases,
      knowledgeLabels: knowledgeBases.map(knowledgeLabelOf),
      mcpCalls,
      mcpLabels: mcpCalls.map(toolLabelOf),
      pluginCalls,
      pluginLabels: pluginCalls.map(pluginLabelOf),
      duration: failed ? `${(6 + (slot % 4)).toFixed(1)}s` : `${(1.2 + (slot % 5) * 0.4).toFixed(1)}s`,
      httpStatus: failed ? (slot % 2 === 0 ? '504' : '429') : '200',
      result: failed ? '失败' as const : '成功' as const,
      errorCode: failed ? (['DIFY_MODEL_TIMEOUT', 'MCP_UPSTREAM_TIMEOUT', 'MODEL_RATE_LIMIT', 'PLUGIN_EXECUTION_ERROR'][slot % 4]) : '—',
    }
  })
}).map((row, index) => ({ ...row, seq: index + 1, time: callClock(index) }))

const useCountByApp = invocationLogs.reduce((map, log) => {
  map.set(log.appName, (map.get(log.appName) ?? 0) + 1)
  return map
}, new Map<string, number>())

const successCountByApp = invocationLogs.reduce((map, log) => {
  if (log.result === '成功') map.set(log.appName, (map.get(log.appName) ?? 0) + 1)
  return map
}, new Map<string, number>())

function displayList(labels: string[], empty: string) {
  if (!labels.length) return empty
  return labels.length === 1 ? labels[0] : `${labels[0]} 等${labels.length}项`
}

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
  { category: 'skills', name: 'case-summary', source: '内网 Skill 仓库', status: '能用', reason: '当前版本已上架', orgScope: '业务一部 / 刑侦支队', changedAt: '11-16 18:31' },
  { category: 'skills', name: 'security-review', source: '内网 Skill 仓库', status: '能用', reason: '当前版本已上架', orgScope: '网安支队', changedAt: '11-16 16:22' },
  { category: 'skills', name: 'legacy-export', source: '内网 Skill 仓库', status: '不能用', reason: 'Skill 已下架', orgScope: '全局 · 本网段', changedAt: '11-16 17:48' },
  { category: 'skills', name: 'draft-research', source: '内网 Skill 仓库', status: '不能用', reason: '尚未上架', orgScope: '平台运营组', changedAt: '11-16 14:05' },

  { category: 'agents', name: '案件摘要助手', source: '智能体仓库', status: '能用', reason: '发布已生效，运行、嵌入和 API 已开通', orgScope: '全网段', changedAt: '11-16 20:18' },
  { category: 'agents', name: '警情辅助分析', source: '智能体仓库', status: '能用', reason: '发布已生效，运行和 API 已开通', orgScope: '全网段', changedAt: '11-16 19:36' },
  { category: 'agents', name: '线索分析 Agent', source: '智能体仓库', status: '能用', reason: '发布已生效，只向网安支队开放', orgScope: '网安支队', changedAt: '11-16 18:20' },
  { category: 'agents', name: '勤务问答助手', source: '智能体仓库', status: '能用', reason: '发布已生效，运行和嵌入已开通', orgScope: '全网段', changedAt: '11-16 17:42' },
  { category: 'agents', name: '旧版文书助手', source: '智能体仓库', status: '不能用', reason: '下架工单已生效，三种方式关闭', orgScope: '全网段', changedAt: '11-16 16:28' },
  { category: 'agents', name: '资金研判实验版', source: 'Dify', status: '不能用', reason: '发布工单尚未生效，未进仓库', orgScope: '经侦支队', changedAt: '11-16 13:15' },
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
    chartTitle: '下载趋势', chartSubtitle: '成功下载 / 失败下载', barsTitle: '下载人组织分布',
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
  ['KB-03', '知识库使用 / 绑定申请', '知识库', '即办', '范围内使用即办，不另开审批'],
  ['KB-05', '知识库下架 / 违规处置', '知识库', '人工审批', '下架、暂停分享或处置文档'],
  ['AG-01', '个人智能体纳管同步', '智能体', '即办', '同步个人应用，不对外分享'],
  ['AG-02', '智能体发布 / 分享申请', '智能体', '人工审批', '审批通过后一次性上架'],
  ['AG-03', '智能体受限使用授权', '智能体', '即办', '范围内使用即办，不另开审批'],
  ['AG-04', '智能体变更再发布', '智能体', '人工审批', '校验新版本的插件、工具与 MCP'],
  ['AG-05', '智能体下架', '智能体', '人工审批', '从仓库下架，并撤销相关授权'],
  ['KEY-01', 'Dify API 密钥创建登记', '凭证', '按条件', '本人调试即办，其他用途审批'],
  ['KEY-02', 'Dify API 密钥轮换 / 撤销', '凭证', '人工审批', '轮换或撤销已登记密钥'],
  ['TOL-01', 'Dify 工具对外使用审批', '工具', '人工审批', '工具批准状态的唯一来源'],
  ['PLG-01', '插件上架申请', '插件', '按条件', '只给自己用即办，分享给他人再审批'],
  ['PLG-02', '插件版本变更再审', '插件', '人工审批', '版本指纹或权限变化后再审'],
  ['PLG-03', '插件安装 / 卸载', '插件', '按条件', '公开安装即办，受限安装审批'],
  ['SKL-01', 'Skill 上架申请', 'Skill', '按条件', '只给自己用即办，分享给他人再审批'],
  ['SKL-02', 'Skill 版本变更再审', 'Skill', '人工审批', '新文件版本重新审核'],
  ['SKL-03', 'Skill 下载', 'Skill', '即办', '核对权限并记录下载流水'],
  ['SKL-04', 'Skill 下架', 'Skill', '人工审批', '保留审计副本并禁止下载'],
  ['MCP-01', 'MCP 上架登记', 'MCP', '按条件', '只给自己用即办，分享给他人再审批'],
  ['MCP-02', 'MCP 使用 / 绑定', 'MCP', '即办', '范围内绑定即办，地址来自内网目录'],
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
        <NavGroup title="仓库" items={warehouseNav} view={view} onNavigate={onNavigate} collapsed={collapsed} />
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
  agents: { title: '智能体可用性', rule: '发布工单已生效且使用方式已开通为能用；未生效或已下架为不能用' },
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

function accessText(agent: WarehouseAgent, method: UsageMethodId) {
  const origin = 'https://dify.local'
  if (method === 'run') return `${origin}/chat/${agent.id}`
  if (method === 'embed') {
    return `<iframe src="${origin}/chatbot/${agent.id}" style="width: 100%; height: 100%; min-height: 700px" frameborder="0" allow="microphone"></iframe>`
  }
  const path = appTraceProfiles[agent.name].appMode === 'workflow' ? '/v1/workflows/run' : '/v1/chat-messages'
  return `POST ${origin}${path}`
}

function modeOf(name: string) {
  return modeLabel[appTraceProfiles[name].appMode]
}

function agentPublished(agent: WarehouseAgent) {
  return agent.releases[0].publishedAt !== '—'
}

function agentVisibleTo(agent: WarehouseAgent, role: Role) {
  if (!agentPublished(agent)) return false
  if (role !== 'user') return true
  if (!agent.directlyUsable) return false
  return agent.visibleOrgs.length === 0 || agent.visibleOrgs.includes('业务一部')
}

function AgentWarehousePage({ role }: { role: Role }) {
  const catalog = useMemo(() => warehouseAgents.filter((agent) => agentVisibleTo(agent, role)), [role])
  const [keyword, setKeyword] = useState('')
  const [tag, setTag] = useState('全部标签')
  const [method, setMethod] = useState<'全部方式' | UsageMethodId>('全部方式')
  const [usable, setUsable] = useState<'全部' | '可直接使用' | '暂不可用' | '三种方式齐全'>('全部')
  const [selectedId, setSelectedId] = useState(catalog[0]?.id ?? '')
  const [copied, setCopied] = useState('')
  const tags = useMemo(() => Array.from(new Set(catalog.flatMap((agent) => agent.tags))), [catalog])
  const usableCount = catalog.filter((agent) => agent.directlyUsable).length
  const fullMethodCount = catalog.filter((agent) => agent.methods.length === 3).length
  const runCount = catalog.filter((agent) => agent.methods.includes('run')).length
  const apiCount = catalog.filter((agent) => agent.methods.includes('api')).length
  const ranking = useMemo(() => [...catalog].sort((a, b) =>
    (successCountByApp.get(b.name) ?? 0) - (successCountByApp.get(a.name) ?? 0) || a.name.localeCompare(b.name, 'zh-CN'),
  ), [catalog])
  const maxUse = Math.max(...ranking.map((agent) => successCountByApp.get(agent.name) ?? 0), 1)
  const filtered = useMemo(() => catalog.filter((agent) => {
    const current = agent.releases[0]
    const haystack = [agent.name, agent.developer, agent.developerAccount, agent.org, agent.description, current.version, ...agent.tags].join(' ').toLowerCase()
    if (keyword.trim() && !haystack.includes(keyword.trim().toLowerCase())) return false
    if (tag !== '全部标签' && !agent.tags.includes(tag)) return false
    if (method !== '全部方式' && !agent.methods.includes(method)) return false
    if (usable === '可直接使用' && !agent.directlyUsable) return false
    if (usable === '暂不可用' && agent.directlyUsable) return false
    if (usable === '三种方式齐全' && agent.methods.length !== 3) return false
    return true
  }), [catalog, keyword, tag, method, usable])
  const selected = filtered.find((agent) => agent.id === selectedId) ?? filtered[0]
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(''), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

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

  return (
    <div data-testid="warehouse-page">
      <PageHeader view="agents" />
      <div className="metric-grid four">
        {role === 'user' ? (
          <>
            <article className="metric-card"><div className="metric-icon tone-1"><Bot size={19} /></div><span>可用应用</span><strong>{catalog.length}</strong><small>当前账号有权使用</small></article>
            <article className="metric-card"><div className="metric-icon tone-2"><Check size={19} /></div><span>三种方式齐全</span><strong>{fullMethodCount}</strong><small>运行、嵌入、API 都已开通</small></article>
            <article className="metric-card"><div className="metric-icon tone-5"><Play size={19} /></div><span>可运行</span><strong>{runCount}</strong><small>已开通运行</small></article>
            <article className="metric-card"><div className="metric-icon tone-3"><Terminal size={19} /></div><span>可访问 API</span><strong>{apiCount}</strong><small>已开通访问 API</small></article>
          </>
        ) : (
          <>
            <article className="metric-card"><div className="metric-icon tone-1"><Bot size={19} /></div><span>已生效应用</span><strong>{catalog.length}</strong><small>不含尚未通过的首次发布</small></article>
            <article className="metric-card"><div className="metric-icon tone-2"><Check size={19} /></div><span>可直接使用</span><strong>{usableCount}</strong><small>至少开通一种使用方式</small></article>
            <article className="metric-card"><div className="metric-icon tone-5"><Play size={19} /></div><span>三种方式齐全</span><strong>{fullMethodCount}</strong><small>运行、嵌入、API 都已开通</small></article>
            <article className="metric-card"><div className="metric-icon tone-4"><X size={19} /></div><span>暂不可用</span><strong>{catalog.length - usableCount}</strong><small>已下架或方式全部关闭</small></article>
          </>
        )}
      </div>
      <section className="panel ranking-panel" data-testid="usage-ranking">
        <div className="panel-title">
          <div><h3><Trophy size={15} /> {role === 'user' ? '可用条目使用排行' : '使用排行榜'}</h3><p>只按成功调用次数排列。点击一行，定位到对应智能体。</p></div>
        </div>
        <div className="ranking-list">
          {ranking.map((agent, index) => {
            const count = successCountByApp.get(agent.name) ?? 0
            return (
              <button key={agent.id} className={selected?.id === agent.id ? 'active' : ''} onClick={() => focusAgent(agent.id)}>
                <b>{index + 1}</b>
                <span><strong>{agent.name}</strong><small>{agent.developer} · {agent.org}</small></span>
                <i><em style={{ width: `${Math.max(8, Math.round(count / maxUse * 100))}%` }} /></i>
                <em>{count} 次</em>
                <ChevronRight size={14} />
              </button>
            )
          })}
        </div>
      </section>
      <div className="warehouse-toolbar">
        <label className="catalog-search warehouse-search"><Search size={16} /><input data-testid="warehouse-search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索名称、开发人员、简介或标签" /></label>
        <div className="usable-switch" data-testid="warehouse-usable">
          {(role === 'user' ? ['全部', '三种方式齐全'] as const : ['全部', '可直接使用', '暂不可用'] as const).map((item) => (
            <button key={item} className={usable === item ? 'active' : ''} onClick={() => setUsable(item)}>{item}</button>
          ))}
        </div>
        <label className="log-filter">
          <span>使用方式</span>
          <select data-testid="warehouse-method" value={method} onChange={(event) => setMethod(event.target.value as '全部方式' | UsageMethodId)}>
            <option>全部方式</option>
            {usageMethodCatalog.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <div className="tag-row">
        <Tag size={14} />
        <button className={tag === '全部标签' ? 'active' : ''} onClick={() => setTag('全部标签')}>全部标签</button>
        {tags.map((item) => <button key={item} className={tag === item ? 'active' : ''} onClick={() => setTag(item)}>{item}</button>)}
        <em>当前 {filtered.length} 个</em>
      </div>
      <div className="warehouse-layout">
        <div className="agent-grid">
          {filtered.length === 0 && <div className="agent-empty">没有符合当前筛选的智能体。</div>}
          {filtered.map((agent) => {
            const current = agent.releases[0]
            const count = successCountByApp.get(agent.name) ?? 0
            return (
              <article
                key={agent.id}
                role="button"
                tabIndex={0}
                data-testid={`agent-card-${agent.id}`}
                className={`agent-card ${selected?.id === agent.id ? 'active' : ''} ${agent.directlyUsable ? 'usable' : 'blocked'}`}
                onClick={() => setSelectedId(agent.id)}
                onKeyDown={(event) => { if (event.key === 'Enter') setSelectedId(agent.id) }}
              >
                <div className="agent-card-top">
                  <span className="agent-emoji">{agent.emoji}</span>
                  <div>
                    <strong>{agent.name}</strong>
                    <small className={`agent-mode mode-${modeOf(agent.name)}`}>{modeOf(agent.name)}</small>
                  </div>
                  <em className={agent.directlyUsable ? 'yes' : 'no'}>{agent.directlyUsable ? '可直接使用' : '暂不可用'}</em>
                </div>
                <p>{agent.description}</p>
                <div className="agent-tags">{agent.tags.map((item) => <span key={item}>{item}</span>)}</div>
                <div className="agent-author"><span>{agent.developer.slice(0, 1)}</span><div><b>{agent.developer}</b><small>{agent.developerAccount} · {agent.org}</small></div></div>
                <div className="agent-methods">
                  {usageMethodCatalog.map((item) => {
                    const Icon = item.id === 'run' ? Play : item.id === 'embed' ? Code2 : Terminal
                    const opened = agent.methods.includes(item.id)
                    return <span key={item.id} className={opened ? 'on' : 'off'}><Icon size={12} />{item.label}</span>
                  })}
                </div>
                <div className="agent-version">
                  <span>{current.version}</span>
                  <small>发布 {current.publishedAt}</small>
                  <small>更改 {current.changedAt}</small>
                  <b>{count} 次</b>
                </div>
              </article>
            )
          })}
        </div>
        {selected && (
          <aside className="panel agent-detail" data-testid="agent-detail">
            <div className="agent-detail-head">
              <span className="agent-emoji">{selected.emoji}</span>
              <div>
                <span className="mini-label">{modeOf(selected.name)} · {selected.developer}</span>
                <h3>{selected.name}</h3>
                <p>{selected.description}</p>
              </div>
            </div>
            <div className="agent-tags">{selected.tags.map((item) => <span key={item}>{item}</span>)}</div>
            <div className="detail-block">
              <h4>使用方式</h4>
              <p>与 Dify 发布菜单一致，一共三种：运行、嵌入网站、访问 API。</p>
              {!selected.directlyUsable && <div className="method-block-note">{selected.unavailableReason}</div>}
              {usageMethodCatalog.map((item) => {
                const opened = selected.methods.includes(item.id)
                const text = accessText(selected, item.id)
                const Icon = item.id === 'run' ? Play : item.id === 'embed' ? Code2 : Terminal
                const copyKey = `${selected.id}-${item.id}`
                return (
                  <div key={item.id} className={`method-block ${opened ? 'on' : 'off'}`} data-testid={`method-${item.id}`}>
                    <div><Icon size={15} /><strong>{item.label}</strong><em>{opened ? '已开通' : '未开通'}</em></div>
                    <p>{item.hint}</p>
                    {opened ? <code>{text}</code> : <small>{selected.unavailableReason || '发布工单没有开通这一方式。'}</small>}
                    <button className="secondary-button compact" disabled={!opened} onClick={() => copyAccess(copyKey, text)}>
                      <Copy size={13} /> {copied === copyKey ? '已复制' : '复制地址'}
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="detail-block">
              <h4><History size={14} /> 迭代记录</h4>
              <p>每次再发布保留版本号、发布时间和更改时间。</p>
              <div className="table-wrap">
                <table className="release-table" data-testid="release-table">
                  <thead><tr><th>版本号</th><th>发布时间</th><th>更改时间</th><th>变更说明</th>{role !== 'user' && <th>工单</th>}</tr></thead>
                  <tbody>
                    {selected.releases.map((release, index) => (
                      <tr key={release.version} data-testid="release-row">
                        <td>{release.version}{index === 0 && <i>当前</i>}</td>
                        <td>{release.publishedAt}</td>
                        <td>{release.changedAt}</td>
                        <td>{release.summary}</td>
                        {role !== 'user' && <td>{release.ticket}</td>}
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

function DifyAgentMonitorPage() {
  const [account, setAccount] = useState('全部账户')
  const [appName, setAppName] = useState('全部应用')
  const [ip, setIp] = useState('全部 IP')
  const [model, setModel] = useState('全部模型')
  const [knowledge, setKnowledge] = useState('全部知识库')
  const [mcp, setMcp] = useState('全部 MCP')
  const [plugin, setPlugin] = useState('全部插件')
  const [keyword, setKeyword] = useState('')
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const groups = useMemo(() => difyAccountDirectory.map((owner) => {
    const apps = [
      ...warehouseAgents.filter((agent) => agent.developerAccount === owner.account).map((agent) => ({
        name: agent.name, inWarehouse: agent.releases[0].publishedAt !== '—', useCount: useCountByApp.get(agent.name) ?? 0,
      })),
      ...difyOnlyApps.filter((agent) => agent.ownerAccount === owner.account).map((agent) => ({
        name: agent.name, inWarehouse: false, useCount: useCountByApp.get(agent.name) ?? 0,
      })),
    ].sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name, 'zh-CN'))
    return { ...owner, apps, useCount: apps.reduce((sum, app) => sum + app.useCount, 0) }
  }), [])
  const appTotal = groups.reduce((sum, group) => sum + group.apps.length, 0)
  const outsideCount = groups.reduce((sum, group) => sum + group.apps.filter((app) => !app.inWarehouse).length, 0)
  const accountApps = account === '全部账户'
    ? groups.flatMap((group) => group.apps.map((app) => app.name))
    : groups.find((group) => group.account === account)?.apps.map((app) => app.name) ?? []
  const scoped = invocationLogs.filter((log) =>
    (account === '全部账户' || log.ownerAccount === account) &&
    (appName === '全部应用' || log.appName === appName)
  )
  const keep = (value: string, all: string, options: string[]) => value === all || options.includes(value) ? value : all
  const ipOptions = Array.from(new Set(scoped.map((log) => log.sourceIp))).sort()
  const modelOptions = Array.from(new Set(scoped.flatMap((log) => log.modelLabels))).sort()
  const knowledgeOptions = Array.from(new Set(scoped.flatMap((log) => log.knowledgeLabels))).sort()
  const mcpOptions = Array.from(new Set(scoped.flatMap((log) => log.mcpLabels))).sort()
  const pluginOptions = Array.from(new Set(scoped.flatMap((log) => log.pluginLabels))).sort()
  const ipValue = keep(ip, '全部 IP', ipOptions)
  const modelValue = keep(model, '全部模型', modelOptions)
  const knowledgeValue = keep(knowledge, '全部知识库', knowledgeOptions)
  const mcpValue = keep(mcp, '全部 MCP', mcpOptions)
  const pluginValue = keep(plugin, '全部插件', pluginOptions)
  const filteredLogs = scoped.filter((log) => {
    if (ipValue !== '全部 IP' && log.sourceIp !== ipValue) return false
    if (modelValue !== '全部模型' && !log.modelLabels.includes(modelValue)) return false
    if (knowledgeValue !== '全部知识库' && !log.knowledgeLabels.includes(knowledgeValue)) return false
    if (mcpValue !== '全部 MCP' && !log.mcpLabels.includes(mcpValue)) return false
    if (pluginValue !== '全部插件' && !log.pluginLabels.includes(pluginValue)) return false
    if (keyword.trim()) {
      const blob = [log.ownerName, log.ownerAccount, log.appName, log.sourceIp, ...log.modelLabels, ...log.knowledgeLabels, ...log.mcpLabels, ...log.pluginLabels].join(' ').toLowerCase()
      if (!blob.includes(keyword.trim().toLowerCase())) return false
    }
    return true
  })
  const selectedLog = filteredLogs.find((log) => log.seq === selectedSeq) ?? null
  const chooseAccount = (next: string) => {
    setAccount(next)
    setAppName('全部应用')
    setSelectedSeq(null)
  }
  const chooseApp = (owner: string, name: string) => {
    setAccount(owner)
    setAppName(name)
    setSelectedSeq(null)
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
  }

  return (
    <div data-testid="agent-monitor">
      <PageHeader view="agentMonitor" />
      <div className="metric-grid four">
        <article className="metric-card"><div className="metric-icon tone-1"><Users size={19} /></div><span>Dify 账户</span><strong>{groups.length}</strong><small>有应用的开发账户</small></article>
        <article className="metric-card"><div className="metric-icon tone-2"><Bot size={19} /></div><span>全部应用</span><strong>{appTotal}</strong><small>含未走工单的应用</small></article>
        <article className="metric-card"><div className="metric-icon tone-3"><Layers3 size={19} /></div><span>未进仓库</span><strong>{outsideCount}</strong><small>只存在于 Dify</small></article>
        <article className="metric-card"><div className="metric-icon tone-5"><Activity size={19} /></div><span>调用记录</span><strong>{invocationLogs.length}</strong><small>当前样本可逐条溯源</small></article>
      </div>
      <div className="monitor-layout">
        <aside className="panel account-tree" data-testid="account-tree">
          <div className="panel-title"><div><h3>账户 / 应用</h3><p>先看账户下有几个应用，再看每个应用用了多少次。</p></div></div>
          <button className={`account-all ${account === '全部账户' ? 'active' : ''}`} onClick={() => chooseAccount('全部账户')}>
            <strong>全部账户</strong><em>{appTotal} 个应用</em>
          </button>
          {groups.map((group) => (
            <div key={group.account} className="account-block">
              <button className={account === group.account && appName === '全部应用' ? 'active' : ''} onClick={() => chooseAccount(group.account)}>
                <span>{group.name.slice(0, 1)}</span>
                <span><strong>{group.name}</strong><small>{group.account} · {group.org}</small></span>
                <em>{group.apps.length} 个应用</em>
              </button>
              {group.apps.map((app) => (
                <button key={app.name} className={`app-node ${account === group.account && appName === app.name ? 'active' : ''}`} onClick={() => chooseApp(group.account, app.name)}>
                  <strong>{app.name}</strong>
                  <small>{app.inWarehouse ? '工单应用' : '仅 Dify'}</small>
                  <em>{app.useCount} 次</em>
                </button>
              ))}
            </div>
          ))}
        </aside>
        <section className="panel table-panel log-panel">
          <div className="panel-title">
            <div><h3>调用记录</h3><p>一行一次调用。筛选后仍保留原来的序号，点「溯源」查看这次用了什么。</p></div>
            <button className="secondary-button compact" onClick={clearFilters}>清空筛选</button>
          </div>
          <div className="log-filters">
            <label className="catalog-search log-search"><Search size={16} /><input data-testid="log-search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索账户、应用、IP、模型、知识库、MCP 或插件" /></label>
            <label className="log-filter"><span>账户</span><select data-testid="log-account" value={account} onChange={(event) => chooseAccount(event.target.value)}><option>全部账户</option>{groups.map((group) => <option key={group.account} value={group.account}>{group.name} · {group.account}</option>)}</select></label>
            <label className="log-filter"><span>智能体应用</span><select data-testid="log-app" value={appName} onChange={(event) => { setAppName(event.target.value); setSelectedSeq(null) }}><option>全部应用</option>{Array.from(new Set(accountApps)).map((name) => <option key={name}>{name}</option>)}</select></label>
            <label className="log-filter"><span>调用 IP</span><select value={ipValue} onChange={(event) => setIp(event.target.value)}><option>全部 IP</option>{ipOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="log-filter"><span>模型</span><select value={modelValue} onChange={(event) => setModel(event.target.value)}><option>全部模型</option>{modelOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="log-filter"><span>知识库</span><select value={knowledgeValue} onChange={(event) => setKnowledge(event.target.value)}><option>全部知识库</option>{knowledgeOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="log-filter"><span>MCP</span><select value={mcpValue} onChange={(event) => setMcp(event.target.value)}><option>全部 MCP</option>{mcpOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="log-filter"><span>插件</span><select value={pluginValue} onChange={(event) => setPlugin(event.target.value)}><option>全部插件</option>{pluginOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <div className="log-count" data-testid="log-count">当前 {filteredLogs.length} 条{account !== '全部账户' ? ` · ${groups.find((group) => group.account === account)?.name}` : ''}{appName !== '全部应用' ? ` · ${appName}` : ''}</div>
          <div className="table-wrap log-wrap" data-testid="invocation-log">
            <table className="log-table">
              <thead><tr><th>序号</th><th>账户</th><th>智能体应用</th><th>调用 IP</th><th>模型</th><th>知识库</th><th>MCP</th><th>插件</th><th>操作</th></tr></thead>
              <tbody>
                {filteredLogs.length === 0 && <tr><td className="log-empty" colSpan={9}>没有符合筛选条件的调用。</td></tr>}
                {filteredLogs.map((log) => (
                  <tr key={log.seq} className={`${log.seq === selectedSeq ? 'selected' : ''} ${log.result === '失败' ? 'failed' : ''}`} onClick={() => setSelectedSeq(log.seq)}>
                    <td className="nowrap">{log.seq}</td>
                    <td><b>{log.ownerName}</b><small>{log.ownerAccount}</small></td>
                    <td className="strong-cell">{log.appName}</td>
                    <td className="mono-cell nowrap">{log.sourceIp}</td>
                    <td>{displayList(log.modelLabels, '未使用')}</td>
                    <td>{displayList(log.knowledgeLabels, '未使用')}</td>
                    <td>{displayList(log.mcpLabels, '未使用')}</td>
                    <td>{displayList(log.pluginLabels, '未使用')}</td>
                    <td><button className="row-action" onClick={(event) => { event.stopPropagation(); setSelectedSeq(log.seq) }}>溯源</button></td>
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

type CatalogView = 'pluginWarehouse' | 'mcpWarehouse' | 'skillWarehouse'
type CatalogEntry = {
  id: string
  kind: CatalogView
  name: string
  emoji: string
  owner: string
  org: string
  summary: string
  tags: string[]
  userVisible: boolean
  status: string
  unavailable: boolean
  reason: string
  successCount: number | null
  meta: string
  action: string
  ticket: string
  releases: { mark: string; publishedAt: string; changedAt: string; summary: string; ticket: string }[]
}

const catalogEntries: CatalogEntry[] = [
  {
    id: 'plg_parser', kind: 'pluginWarehouse', name: 'document-parser', emoji: '📎', owner: '周敏', org: '平台运营组',
    summary: '解析 PDF 和 Office 文书，供智能体抽取字段。公开免审安装。', tags: ['文书', '公开'],
    userVisible: true, status: '可直接安装', unavailable: false, reason: '', successCount: 46, meta: 'v2.4.1 · 当前安装 18',
    action: '安装', ticket: 'PLG-03',
    releases: [
      { mark: 'v2.4.1', publishedAt: '11-16 20:11', changedAt: '11-16 19:40', summary: '修复扫描件分页', ticket: 'PLG-20261116-0044' },
      { mark: 'v2.3.0', publishedAt: '10-22 09:18', changedAt: '10-22 09:02', summary: '首次上架', ticket: 'PLG-20261022-0012' },
    ],
  },
  {
    id: 'plg_json', kind: 'pluginWarehouse', name: 'json-process', emoji: '🧩', owner: '赵宁', org: '平台运营组',
    summary: '整理 JSON 字段。现有运行记录还不能把调用准确归到这个插件。', tags: ['数据', '公开'],
    userVisible: true, status: '可直接安装', unavailable: false, reason: '', successCount: null, meta: 'v1.6.0 · 当前安装 9',
    action: '安装', ticket: 'PLG-03',
    releases: [
      { mark: 'v1.6.0', publishedAt: '11-16 18:42', changedAt: '11-16 18:10', summary: '增加数组展开', ticket: 'PLG-20261116-0038' },
    ],
  },
  {
    id: 'plg_chart', kind: 'pluginWarehouse', name: 'case-chart', emoji: '📊', owner: '陈宇', org: '业务一部',
    summary: '把案件要素画成关系图。业务一部可见，安装需要审批。', tags: ['刑侦', '受限'],
    userVisible: true, status: '需申请安装', unavailable: false, reason: '', successCount: 12, meta: 'v0.9.2 · 当前安装 2',
    action: '申请安装', ticket: 'PLG-03',
    releases: [
      { mark: 'v0.9.2', publishedAt: '11-16 17:15', changedAt: '11-16 16:48', summary: '限定业务一部可见', ticket: 'PLG-20261116-0031' },
    ],
  },
  {
    id: 'plg_search', kind: 'pluginWarehouse', name: 'web-search', emoji: '🔎', owner: '吴凡', org: '网安支队',
    summary: '检索公开网页。陈宇的 workspace 已经安装。', tags: ['检索', '公开'],
    userVisible: true, status: '已安装', unavailable: false, reason: '', successCount: 33, meta: 'v3.1.0 · 当前安装 11',
    action: '卸载', ticket: 'PLG-03',
    releases: [
      { mark: 'v3.1.0', publishedAt: '11-10 11:20', changedAt: '11-10 10:46', summary: '升级检索超时', ticket: 'PLG-20261110-0022' },
    ],
  },
  {
    id: 'plg_browser', kind: 'pluginWarehouse', name: 'browser-agent', emoji: '🌐', owner: '赵宁', org: '平台运营组',
    summary: '浏览器操作插件。失败率越线后已自动禁用。', tags: ['自动化'],
    userVisible: false, status: '暂不可用', unavailable: true, reason: '已自动禁用', successCount: 4, meta: 'v1.8.3 · PLG-241083',
    action: '安装', ticket: 'PLG-04',
    releases: [
      { mark: 'v1.8.3', publishedAt: '11-02 14:08', changedAt: '11-16 15:16', summary: '自动禁用，等待恢复确认', ticket: 'PLG-241083' },
    ],
  },
  {
    id: 'plg_ocr', kind: 'pluginWarehouse', name: 'legacy-ocr', emoji: '🔤', owner: '高峰', org: '业务一部',
    summary: '旧版文字识别。下架工单已办结。', tags: ['文书'],
    userVisible: false, status: '已下架', unavailable: true, reason: '插件已下架', successCount: 2, meta: 'v0.4.0',
    action: '安装', ticket: 'PLG-03',
    releases: [
      { mark: 'v0.4.0', publishedAt: '08-12 09:00', changedAt: '11-16 15:20', summary: '执行下架', ticket: 'PLG-20261116-0026' },
    ],
  },
  {
    id: 'mcp_archive', kind: 'mcpWarehouse', name: '档案检索服务', emoji: '🗄️', owner: '陈宇', org: '业务一部',
    summary: '按档案号检索已授权卷宗。目录正常，陈宇可直接绑定。', tags: ['档案', 'SSE'],
    userVisible: true, status: '可直接绑定', unavailable: false, reason: '', successCount: 18, meta: '工具 search_archive',
    action: '绑定', ticket: 'MCP-02',
    releases: [
      { mark: '上架登记', publishedAt: '11-08 09:15', changedAt: '11-16 19:46', summary: '补充 search_archive 入参说明', ticket: 'MCP-20261116-0018' },
    ],
  },
  {
    id: 'mcp_map', kind: 'mcpWarehouse', name: '地图服务', emoji: '🗺️', owner: '郑毅', org: '情指中心',
    summary: '查询地点和辖区。全网段可见，绑定需要审批。', tags: ['地图', 'HTTP'],
    userVisible: true, status: '需申请绑定', unavailable: false, reason: '', successCount: 9, meta: '工具 geo_search',
    action: '申请绑定', ticket: 'MCP-02',
    releases: [
      { mark: '上架登记', publishedAt: '10-30 16:12', changedAt: '11-12 11:04', summary: '收紧组织边界为全网段可读', ticket: 'MCP-20261112-0009' },
    ],
  },
  {
    id: 'mcp_clue', kind: 'mcpWarehouse', name: '线索查询服务', emoji: '🕵️', owner: '吴凡', org: '网安支队',
    summary: '查询网安线索。只对网安支队开放。', tags: ['网安'],
    userVisible: false, status: '可直接绑定', unavailable: false, reason: '', successCount: 7, meta: '工具 get_clue',
    action: '绑定', ticket: 'MCP-02',
    releases: [
      { mark: '上架登记', publishedAt: '11-04 15:06', changedAt: '11-16 17:55', summary: '限定网安支队', ticket: 'MCP-20261104-0006' },
    ],
  },
  {
    id: 'mcp_company', kind: 'mcpWarehouse', name: '企业查询服务', emoji: '🏢', owner: '林杰', org: '经侦支队',
    summary: '查询企业登记信息。目录已隔离，不能再绑定。', tags: ['经侦'],
    userVisible: false, status: '隔离', unavailable: true, reason: '目录已隔离', successCount: 3, meta: '工具 query_company',
    action: '解绑', ticket: 'MCP-03',
    releases: [
      { mark: '隔离', publishedAt: '10-19 14:05', changedAt: '11-15 18:22', summary: '异常调用后隔离目录', ticket: 'MCP-20261115-0014' },
    ],
  },
  {
    id: 'skl_doc', kind: 'skillWarehouse', name: '公文摘要 Skill', emoji: '📝', owner: '陈宇', org: '业务一部',
    summary: '把公文压缩成要点。全网段可下载，文件已经扫描通过。', tags: ['公文', '全网段'],
    userVisible: true, status: '可下载', unavailable: false, reason: '', successCount: 21, meta: 'v2.1.0 · 1.2 MB',
    action: '下载', ticket: 'SKL-03',
    releases: [
      { mark: 'v2.1.0', publishedAt: '11-16 18:31', changedAt: '11-16 18:05', summary: '当前版本可下载', ticket: 'SKL-20261116-0021' },
      { mark: 'v2.0.0', publishedAt: '10-18 10:12', changedAt: '10-18 09:40', summary: '历史版本仍可下载', ticket: 'SKL-20261018-0008' },
    ],
  },
  {
    id: 'skl_sheet', kind: 'skillWarehouse', name: '表格分析 Skill', emoji: '📗', owner: '林杰', org: '经侦支队',
    summary: '分析表格里的异常行。业务一部在授权范围内。', tags: ['表格', '业务一部'],
    userVisible: true, status: '可下载', unavailable: false, reason: '', successCount: 14, meta: 'v1.8.2 · 860 KB',
    action: '下载', ticket: 'SKL-03',
    releases: [
      { mark: 'v1.8.2', publishedAt: '11-11 14:26', changedAt: '11-11 13:58', summary: '增加金额列校验', ticket: 'SKL-20261111-0015' },
    ],
  },
  {
    id: 'skl_log', kind: 'skillWarehouse', name: '日志研判 Skill', emoji: '📜', owner: '吴凡', org: '网安支队',
    summary: '整理网络日志模板。只授权给网安支队。', tags: ['日志', '网安支队'],
    userVisible: false, status: '可下载', unavailable: false, reason: '', successCount: 9, meta: 'v3.0.1 · 2.4 MB',
    action: '下载', ticket: 'SKL-03',
    releases: [
      { mark: 'v3.0.1', publishedAt: '11-09 16:40', changedAt: '11-09 16:12', summary: '限定网安支队下载', ticket: 'SKL-20261109-0011' },
    ],
  },
  {
    id: 'skl_legacy', kind: 'skillWarehouse', name: '旧版导出 Skill', emoji: '📦', owner: '高峰', org: '业务一部',
    summary: '旧的导出模板。整体下架后，所有版本都不能下载。', tags: ['导出'],
    userVisible: false, status: '已下架', unavailable: true, reason: 'Skill 已下架，历史版本停止下载', successCount: 6, meta: 'v0.7.0',
    action: '下载', ticket: 'SKL-04',
    releases: [
      { mark: 'v0.7.0', publishedAt: '07-02 11:00', changedAt: '11-16 17:48', summary: '整体下架', ticket: 'SKL-20261116-0007' },
    ],
  },
]

function CatalogWarehouse({ view, role, onWorkOrder }: { view: CatalogView; role: Role; onWorkOrder: (title: string) => void }) {
  const staff = role !== 'user'
  const catalog = useMemo(() => catalogEntries.filter((item) => item.kind === view && (staff || item.userVisible)), [view, staff])
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('全部')
  const [selectedId, setSelectedId] = useState('')
  const [notice, setNotice] = useState('')
  const statuses = ['全部', ...Array.from(new Set(catalog.map((item) => item.status)))]
  const filtered = catalog.filter((item) => {
    const haystack = [item.name, item.owner, item.org, item.summary, item.meta, ...item.tags].join(' ').toLowerCase()
    if (keyword.trim() && !haystack.includes(keyword.trim().toLowerCase())) return false
    if (status !== '全部' && item.status !== status) return false
    return true
  })
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0]
  const ranked = catalog.filter((item) => item.successCount !== null).sort((a, b) => (b.successCount ?? 0) - (a.successCount ?? 0))
  const maxCount = Math.max(...ranked.map((item) => item.successCount ?? 0), 1)
  const countOf = (value: string) => catalog.filter((item) => item.status === value).length
  const metricSet = view === 'pluginWarehouse'
    ? (staff
      ? [['已生效', catalog.length], ['可安装', countOf('可直接安装') + countOf('需申请安装') + countOf('已安装')], ['暂不可用', countOf('暂不可用')], ['已下架', countOf('已下架')]]
      : [['可直接安装', countOf('可直接安装')], ['需申请安装', countOf('需申请安装')], ['已安装', countOf('已安装')], ['可见插件', catalog.length]])
    : view === 'mcpWarehouse'
      ? (staff
        ? [['已生效', catalog.length], ['正常', catalog.filter((item) => !item.unavailable).length], ['隔离', countOf('隔离')], ['下架', countOf('已下架')]]
        : [['可直接绑定', countOf('可直接绑定')], ['需申请绑定', countOf('需申请绑定')], ['可见目录', catalog.length], ['成功调用', catalog.reduce((sum, item) => sum + (item.successCount ?? 0), 0)]])
      : (staff
        ? [['已上架', catalog.filter((item) => item.status === '可下载').length], ['已下架', countOf('已下架')], ['版本', catalog.reduce((sum, item) => sum + item.releases.length, 0)], ['可见 Skill', catalog.length]]
        : [['可下载', countOf('可下载')], ['可下载版本', catalog.reduce((sum, item) => sum + item.releases.length, 0)], ['可见 Skill', catalog.length], ['成功下载', catalog.reduce((sum, item) => sum + (item.successCount ?? 0), 0)]])

  useEffect(() => {
    setKeyword('')
    setStatus('全部')
    setSelectedId('')
    setNotice('')
  }, [view, role])

  const choose = (id: string) => {
    setKeyword('')
    setStatus('全部')
    setSelectedId(id)
  }

  return (
    <div data-testid="catalog-warehouse">
      <PageHeader view={view} />
      <div className="metric-grid four">
        {metricSet.map(([label, value], index) => (
          <article className="metric-card" key={label}>
            <div className={`metric-icon tone-${(index % 5) + 1}`}><PackageCheck size={19} /></div>
            <span>{label}</span><strong>{value}</strong><small>{staff ? '全部已生效条目' : '只统计当前账号可见范围'}</small>
          </article>
        ))}
      </div>
      <section className="panel ranking-panel" data-testid="usage-ranking">
        <div className="panel-title">
          <div><h3><Trophy size={15} /> {staff ? '使用排行榜' : '可用条目使用排行'}</h3><p>{view === 'skillWarehouse' ? '只按成功交付的下载次数排列。' : '只按能够归属的成功调用次数排列。'}</p></div>
        </div>
        {ranked.length === 0 ? <div className="agent-empty">未采集</div> : (
          <div className="ranking-list">
            {ranked.map((item, index) => (
              <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => choose(item.id)}>
                <b>{index + 1}</b>
                <span><strong>{item.name}</strong><small>{item.owner} · {item.org}</small></span>
                <i><em style={{ width: `${Math.max(8, Math.round((item.successCount ?? 0) / maxCount * 100))}%` }} /></i>
                <em>{item.successCount} 次</em>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        )}
      </section>
      <div className="warehouse-toolbar">
        <label className="catalog-search warehouse-search"><Search size={16} /><input data-testid="catalog-search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索名称、说明、作者或标签" /></label>
        <div className="usable-switch" data-testid="catalog-status">
          {statuses.map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item}</button>)}
        </div>
      </div>
      <div className="warehouse-layout">
        <div className="agent-grid">
          {filtered.length === 0 && <div className="agent-empty">没有符合当前筛选的条目。</div>}
          {filtered.map((item) => (
            <article key={item.id} role="button" tabIndex={0} className={`agent-card ${selected?.id === item.id ? 'active' : ''} ${item.unavailable ? 'blocked' : 'usable'}`} data-testid={`catalog-card-${item.id}`} onClick={() => setSelectedId(item.id)}>
              <div className="agent-card-top">
                <span className="agent-emoji">{item.emoji}</span>
                <div><strong>{item.name}</strong><small>{item.meta}</small></div>
                <em className={item.unavailable ? 'no' : 'yes'}>{item.status}</em>
              </div>
              <p>{item.summary}</p>
              <div className="agent-tags">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <div className="agent-author"><span>{item.owner.slice(0, 1)}</span><div><b>{item.owner}</b><small>{item.org}</small></div></div>
              <div className="agent-version"><span>{item.successCount === null ? '未采集' : `${item.successCount} 次`}</span><small>{view === 'skillWarehouse' ? '成功下载' : '成功调用'}</small></div>
            </article>
          ))}
        </div>
        {selected && (
          <aside className="panel agent-detail" data-testid="catalog-detail">
            <div className="agent-detail-head">
              <span className="agent-emoji">{selected.emoji}</span>
              <div>
                <span className="mini-label">{selected.status} · {selected.owner}</span>
                <h3>{selected.name}</h3>
                <p>{selected.summary}</p>
              </div>
            </div>
            <div className="detail-block">
              <h4>{view === 'skillWarehouse' ? '下载' : view === 'mcpWarehouse' ? '绑定' : '安装'}</h4>
              <p>这个动作只生成 {selected.ticket}，不直接改 Dify 或对象存储。</p>
              {selected.unavailable && <div className="method-block-note">{selected.reason}{staff ? ` · ${selected.releases[0]?.ticket}` : ''}</div>}
              <button className="primary-button" disabled={selected.unavailable} onClick={() => setNotice(`已生成 ${selected.ticket}。${selected.action}申请已记入我的申请；公开或本人私有的即办单由系统自动执行。`)}>
                {selected.action}
              </button>
              {notice && <div className="method-block-note" data-testid="catalog-notice">{notice}</div>}
            </div>
            <div className="detail-block">
              <h4><History size={14} /> {view === 'mcpWarehouse' ? '变更记录' : '迭代记录'}</h4>
              <div className="table-wrap">
                <table className="release-table">
                  <thead><tr><th>{view === 'mcpWarehouse' ? '记录' : '版本号'}</th><th>{view === 'skillWarehouse' ? '上架时间' : '发布时间'}</th><th>更改时间</th><th>变更说明</th>{staff && <th>工单</th>}</tr></thead>
                  <tbody>
                    {selected.releases.map((release, index) => (
                      <tr key={release.mark}>
                        <td>{release.mark}{index === 0 && <i>当前</i>}</td>
                        <td>{release.publishedAt}</td>
                        <td>{release.changedAt}</td>
                        <td>{release.summary}</td>
                        {staff && <td><button className="row-action" onClick={() => onWorkOrder(`${selected.name} · ${release.ticket}`)}>{release.ticket}</button></td>}
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

function MonitorPage({ view, onWorkOrder }: { view: View; onWorkOrder: (title: string) => void }) {
  if (view === 'agentMonitor') return <DifyAgentMonitorPage />
  const data = monitorData[view]
  if (!data) return null
  const barData = view === 'skills'
    ? [{ name: '业务一部', value: 22, secondary: 0 }, { name: '刑侦支队', value: 15, secondary: 0 }, { name: '网安支队', value: 9, secondary: 0 }, { name: '情指中心', value: 6, secondary: 0 }]
    : categoryData
  return (
    <>
      <PageHeader
        view={view}
        action={<div className="time-filter"><button>1 小时</button><button className="active">24 小时</button><button>7 天</button></div>}
      />
      {view === 'knowledge' && <RepositoryAvailability defaultCategory="knowledge" />}
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
            <BarChart data={barData} layout="vertical" margin={{ top: 5, right: 10, left: 5, bottom: 0 }}>
              <CartesianGrid stroke="#edf0f5" horizontal={false} />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#8b94a7', fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={view === 'skills' ? 72 : 52} axisLine={false} tickLine={false} tick={{ fill: '#667085', fontSize: 11 }} />
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

function TraceSummary({ items, empty = '未使用' }: { items: string[]; empty?: string }) {
  if (!items.length) return <span className="trace-empty">— · {empty}</span>
  return (
    <span className="trace-summary">
      {items.map((item) => <span key={item}>{item}</span>)}
    </span>
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
                      <div><dt>仍需回答</dt><dd>一句申请说明</dd></div>
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
            <div><span>{message.length} / 2000</span><button className="send-button" onClick={submitMessage}><Send size={17} /></button></div>
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
              <FormField label="工单标题" source="本平台"><input value="知识库发布 / 分享申请 · 反诈话术资料库" readOnly /></FormField>
              <div className="form-row">
                <FormField label="来源系统" source="用户" required><select defaultValue="RAGFlow"><option>RAGFlow</option><option>Dify</option></select></FormField>
                <FormField label="知识库 ID" source="用户" required><select><option>kb_rf_94820 · 反诈话术资料库</option></select></FormField>
              </div>
              <div className="form-row">
                <FormField label="知识库名称" source="RAGFlow API"><input value="反诈话术资料库" readOnly /></FormField>
                <FormField label="文档数" source="RAGFlow API"><input value="186" readOnly /></FormField>
              </div>
              <div className="form-row">
                <FormField label="分享方式" source="用户" required><select><option>指定组织</option><option>全网段</option><option>指定人员</option></select></FormField>
                <FormField label="目标组织" source="用户" required><select><option>业务一部</option></select></FormField>
              </div>
              <RecordedBoundary role={role} resourceLevel="内部" resourceLine="刑侦" choose={false} />
              <FormField label="申请说明" source="用户" required><textarea placeholder="写一句申请原因" /></FormField>
              <FormField label="模型目录核对" source="本平台"><input value="一致 · bge-m3" readOnly /></FormField>
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

function personOf(role: Role) {
  if (role === 'ops') return { name: '周敏', account: 'zhou.min', org: '平台运营组', line: '', level: '' }
  if (role === 'admin') return { name: '李强', account: 'li.qiang', org: '系统管理组', line: '', level: '' }
  return { name: '陈宇', account: 'chen.yu', org: '业务一部', line: '刑侦', level: '内部' }
}

type ResourceStamp = { name: string; level: string; line: string }

function defaultPath(code: string) {
  if (code === 'MCP-03') return '解绑'
  return '本人'
}

function needsApplicationNote(code: string, path: string) {
  if (code === 'EVT-01') return false
  if (code === 'KEY-01') return path === '对外'
  if (code === 'PLG-01' || code === 'SKL-01' || code === 'MCP-01') return path === '分享'
  if (code === 'MCP-03') return path === '隔离' || path === '下架'
  if (['KB-01', 'KB-03', 'AG-01', 'AG-03', 'PLG-03', 'SKL-03', 'MCP-02'].includes(code)) return false
  return ['KB-02', 'KB-05', 'AG-02', 'AG-04', 'AG-05', 'KEY-02', 'TOL-01', 'PLG-02', 'SKL-02', 'SKL-04', 'ACC-01', 'ACC-02'].includes(code)
}

function needsLevelPick(code: string, path: string) {
  if (code === 'KEY-01') return path === '对外'
  if (code === 'PLG-01' || code === 'SKL-01' || code === 'MCP-01') return path === '分享'
  if (code === 'MCP-03') return path === '下架'
  return ['KB-02', 'KB-05', 'AG-02', 'AG-04', 'AG-05', 'TOL-01', 'PLG-02', 'SKL-02', 'SKL-04'].includes(code)
}

function shownMode(code: string, catalogMode: string, path: string) {
  if (['KEY-01', 'PLG-01', 'SKL-01', 'MCP-01', 'MCP-03'].includes(code)) {
    return needsApplicationNote(code, path) ? '人工审批' : '即办'
  }
  return catalogMode
}

function resourceChoices(code: string): ResourceStamp[] {
  if (code.startsWith('KB')) return [
    { name: '反诈话术资料库', level: '内部', line: '刑侦' },
    { name: '个人测试语料库', level: '', line: '' },
  ]
  if (code.startsWith('KEY') || code === 'TOL-01') return [{ name: '调试密钥', level: '', line: '' }]
  if (code.startsWith('PLG')) return [
    { name: 'document-parser', level: '内部', line: '刑侦' },
    { name: 'private-exporter', level: '', line: '' },
  ]
  if (code.startsWith('SKL')) return [
    { name: '公文摘要 Skill', level: '内部', line: '刑侦' },
    { name: '表格分析 Skill', level: '', line: '' },
  ]
  if (code.startsWith('MCP')) return [
    { name: '档案检索服务', level: '内部', line: '刑侦' },
    { name: '测试文件服务', level: '', line: '' },
  ]
  if (code === 'EVT-01') return [{ name: 'plugin daemon 健康波动', level: '', line: '' }]
  if (code.startsWith('ACC')) return [{ name: '林杰', level: '', line: '' }]
  return [{ name: '未命名资源', level: '', line: '' }]
}

const specializedCodes = ['AG-01', 'AG-02', 'AG-03', 'AG-04', 'AG-05', 'PLG-03', 'MCP-02', 'SKL-03']

function RecordedBoundary({ role, resourceLevel, resourceLine, choose }: { role: Role; resourceLevel: string; resourceLine: string; choose: boolean }) {
  const person = personOf(role)
  const level = resourceLevel || person.level
  const line = resourceLine || person.line
  return (
    <div className="form-row">
      {level ? (
        <FormField label="密级" source={resourceLevel ? '资源' : '本平台'}><input value={level} readOnly /></FormField>
      ) : choose ? (
        <FormField label="密级" source="用户" required>
          <select defaultValue=""><option value="" disabled>请选择</option><option>公开</option><option>内部</option><option>敏感</option><option>机密</option></select>
        </FormField>
      ) : (
        <FormField label="密级" source="本平台"><input value="未登记" readOnly /></FormField>
      )}
      {line ? (
        <FormField label="业务线" source={resourceLine ? '资源' : '本平台'}><input value={line} readOnly /></FormField>
      ) : choose ? (
        <FormField label="业务线" source="用户" required>
          <select defaultValue=""><option value="" disabled>请选择</option><option>刑侦</option><option>网安</option><option>经侦</option><option>治安</option></select>
        </FormField>
      ) : (
        <FormField label="业务线" source="本平台"><input value="未登记" readOnly /></FormField>
      )}
    </div>
  )
}

function methodLabel(id: UsageMethodId) {
  return usageMethodCatalog.find((item) => item.id === id)?.label ?? id
}

function MiniTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  if (!rows.length) return <div className="read-source"><span><strong>无</strong><small>这次没有读到对应资源</small></span></div>
  return (
    <div className="table-wrap form-table">
      <table className="release-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={`${row.join('-')}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

const publishCandidates = [
  {
    id: 'app_fund_lab', name: '资金研判实验版', mode: '工作流', workspace: 'ws_lin',
    summary: '资金研判的试验流程。发布工单还在审核，当前不能直接使用。', tags: '经侦、实验',
    kb: [['ds_fund', '经侦指标库', '已授权']],
    plugins: [['document-parser', 'document-parser', 'v2.4.1', '已批准', '允许']],
    tools: [['tool_company', '企业信息查询', '未批准', '禁止']],
    mcp: [] as string[][],
    alert: '工具「企业信息查询」未批准，且没有对外使用权限。',
  },
  {
    id: 'app_doc_draft', name: '文书草稿', mode: '聊天助手', workspace: 'ws_chen',
    summary: '个人文书草稿，只存在于 Dify，还没有生效的发布工单。', tags: '文书',
    kb: [], plugins: [], tools: [], mcp: [],
    alert: '',
  },
]

function AgentTicketBody({ code, role, onMeta }: { code: string; role: Role; onMeta: (meta: ResourceStamp) => void }) {
  const person = personOf(role)
  const published = warehouseAgents.filter((agent) => agent.directlyUsable && agent.releases[0]?.publishedAt !== '—')
  const [publishId, setPublishId] = useState(publishCandidates[0].id)
  const [audience, setAudience] = useState('指定组织')
  const [useId, setUseId] = useState('app_clue_agent')
  const [useMethods, setUseMethods] = useState<UsageMethodId[]>(['run', 'embed', 'api'])
  const [changeId, setChangeId] = useState('app_case_summary')
  const [retireId, setRetireId] = useState('app_case_summary')
  const [intakeId, setIntakeId] = useState('app_doc_draft')
  const publishing = publishCandidates.find((item) => item.id === publishId) ?? publishCandidates[0]
  const using = published.find((item) => item.id === useId) ?? published[0]
  const changing = published.find((item) => item.id === changeId) ?? published[0]
  const retiring = published.find((item) => item.id === retireId) ?? published[0]
  const useScope = using.visibleOrgs.length ? '指定组织' : '全网段'
  const useMatched = using.visibleOrgs.length === 0 || using.visibleOrgs.includes(person.org)

  useEffect(() => {
    setUseMethods(using.methods)
  }, [using.id])

  useEffect(() => {
    if (code === 'AG-01') onMeta({ name: intakeId === 'app_note' ? '个人笔记助手' : '文书草稿', level: '', line: '' })
    else if (code === 'AG-02') onMeta({ name: publishing.name, level: '', line: '' })
    else if (code === 'AG-03') onMeta({ name: using.name, level: using.id === 'app_clue_agent' ? '敏感' : '内部', line: using.tags[0] || '' })
    else if (code === 'AG-04') onMeta({ name: changing.name, level: changing.id === 'app_clue_agent' ? '敏感' : '内部', line: changing.tags[0] || '' })
    else onMeta({ name: retiring.name, level: retiring.id === 'app_clue_agent' ? '敏感' : '内部', line: retiring.tags[0] || '' })
  }, [code, intakeId, publishing.name, using.id, using.name, using.tags, changing.id, changing.name, changing.tags, retiring.id, retiring.name, retiring.tags, onMeta])

  if (code === 'AG-01') {
    return (
      <div className="form-section">
        <div className="section-heading"><span>02</span><div><h4>纳管对象</h4><p>把本人已经在 Dify 创建的应用同步到个人目录。不公开、不授权他人，Web 站点保持关闭。</p></div></div>
        <FormField label="Dify应用" source="用户" required>
          <select value={intakeId} onChange={(event) => setIntakeId(event.target.value)}>
            <option value="app_doc_draft">文书草稿</option>
            <option value="app_note">个人笔记助手</option>
          </select>
        </FormField>
        <div className="form-row">
          <FormField label="应用名称" source="Dify API"><input value={intakeId === 'app_note' ? '个人笔记助手' : '文书草稿'} readOnly /></FormField>
          <FormField label="应用模式" source="Dify API"><input value="聊天助手" readOnly /></FormField>
        </div>
        <div className="form-row">
          <FormField label="所有者账户名" source="Dify API"><input value={`${person.name} · ${person.account}`} readOnly /></FormField>
          <FormField label="workspace ID" source="Dify API"><input value="ws_chen" readOnly /></FormField>
        </div>
        <FormField label="当前发布版本ID" source="Dify API"><input value="未发布" readOnly /></FormField>
        <div className="form-row">
          <FormField label="个人目录状态" source="本平台"><input value="仅本人" readOnly /></FormField>
          <FormField label="Web站点状态" source="Dify API"><input value="关闭" readOnly /></FormField>
        </div>
        <FormField label="外部分享状态" source="本平台"><input value="禁止" readOnly /></FormField>
      </div>
    )
  }

  if (code === 'AG-02') {
    return (
      <>
        <div className="form-section">
          <div className="section-heading"><span>02</span><div><h4>发布对象</h4><p>把尚未进入仓库的 Dify 应用发布进智能体仓库。来源固定是 Dify，不含 RAGFlow。</p></div></div>
          <FormField label="Dify应用" source="用户" required>
            <select value={publishId} onChange={(event) => setPublishId(event.target.value)}>
              {publishCandidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </FormField>
          <div className="form-row">
            <FormField label="应用名称" source="Dify API"><input value={publishing.name} readOnly /></FormField>
            <FormField label="应用模式" source="Dify API"><input value={publishing.mode} readOnly /></FormField>
          </div>
          <div className="form-row">
            <FormField label="workspace ID" source="Dify API"><input value={publishing.workspace} readOnly /></FormField>
            <FormField label="发布版本ID" source="Dify API"><input value="未生效" readOnly /></FormField>
          </div>
          <FormField label="工作流快照ID" source="本平台"><input value="审批通过后保存" readOnly /></FormField>
        </div>
        <div className="form-section">
          <div className="section-heading"><span>03</span><div><h4>发布范围</h4><p>审批通过后一次性上架。这里决定仓库里谁能看见、能用。</p></div></div>
          <FormField label="目标用户范围" source="用户" required>
            <select value={audience} onChange={(event) => setAudience(event.target.value)}>
              <option>全网段</option><option>指定组织</option><option>指定人员</option>
            </select>
          </FormField>
          {audience === '指定组织' && <FormField label="目标组织" source="用户" required><select><option>业务一部</option><option>网安支队</option><option>刑侦支队</option><option>经侦支队</option></select></FormField>}
          {audience === '指定人员' && <FormField label="目标人员" source="用户" required><select><option>陈宇 · chen.yu</option><option>吴凡 · wu.fan</option></select></FormField>}
        </div>
        <div className="form-section">
          <div className="section-heading"><span>04</span><div><h4>仓库展示</h4><p>名称、简介、图标和标签从 Dify 应用读取，申请人不能改。</p></div></div>
          <div className="form-row">
            <FormField label="仓库展示名称" source="Dify API"><input value={publishing.name} readOnly /></FormField>
            <FormField label="仓库标签" source="Dify API"><input value={publishing.tags} readOnly /></FormField>
          </div>
          <FormField label="仓库简介" source="Dify API"><textarea value={publishing.summary} readOnly /></FormField>
          <FormField label="仓库图标" source="Dify API"><input value="沿用 Dify 应用图标" readOnly /></FormField>
        </div>
        <div className="form-section">
          <div className="section-heading"><span>05</span><div><h4>发布资源校验</h4><p>系统核对工作流里的知识库、插件、工具和 MCP。有未批准资源时，运维办理时必须选择驳回或确认风险。</p></div></div>
          <FormField label="关联知识库" source="Dify API和本平台"><MiniTable columns={['ID', '名称', '授权状态']} rows={publishing.kb} /></FormField>
          <FormField label="插件清单" source="Dify API和本平台"><MiniTable columns={['ID', '名称', '版本', '批准状态', '对外权限']} rows={publishing.plugins} /></FormField>
          <FormField label="工具清单" source="Dify API和本平台"><MiniTable columns={['ID', '名称', '批准状态', '对外权限']} rows={publishing.tools} /></FormField>
          <FormField label="MCP清单" source="Dify API和本平台"><MiniTable columns={['ID', '名称', 'URL指纹', '批准状态', '对外权限']} rows={publishing.mcp} /></FormField>
          <div className="form-row">
            <FormField label="未批准资源数" source="本平台"><input value={String(publishing.tools.filter((row) => row[2] === '未批准').length + publishing.plugins.filter((row) => row[3] === '未批准').length)} readOnly /></FormField>
            <FormField label="发布资源告警状态" source="本平台"><input value={publishing.alert ? '有告警' : '无告警'} readOnly /></FormField>
          </div>
          <FormField label="发布告警" source="本平台"><textarea value={publishing.alert || '无'} readOnly /></FormField>
          {publishing.alert && (
            <>
              <div className="form-row">
                <FormField label="告警处理决定" source="运维办理"><select disabled><option>驳回整改</option><option>确认风险并继续审批</option></select></FormField>
                <FormField label="告警处理说明" source="运维办理"><input value="有告警时，由运维人员在办理节点填写" readOnly /></FormField>
              </div>
            </>
          )}
          <div className="form-row">
            <FormField label="Dify Web站点状态" source="Dify API"><input value="关闭" readOnly /></FormField>
            <FormField label="开通使用方式" source="Dify API和本平台"><input value="审批通过后写入运行、嵌入网站、访问 API" readOnly /></FormField>
          </div>
          <FormField label="上架时间" source="本平台"><input value="上架成功后记录" readOnly /></FormField>
        </div>
      </>
    )
  }

  if (code === 'AG-03') {
    const boundary = using.visibleOrgs.length ? using.visibleOrgs.join('、') : '全网段'
    const notice = useMatched
      ? '申请人落在发布范围内。提交后即办，不进入待办。'
      : `这个应用只向 ${boundary} 开放。${person.name} 属于 ${person.org}，不在范围内。这张单不能把范围扩大。`
    return (
      <>
        <div className="form-section">
          <div className="section-heading"><span>02</span><div><h4>使用对象</h4><p>向已经在仓库里的应用申请使用资格。这里不发布、不改版本、不下架。</p></div></div>
          <FormField label="仓库应用" source="用户" required>
            <select value={using.id} onChange={(event) => setUseId(event.target.value)}>
              {published.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </FormField>
          <div className="form-row">
            <FormField label="Dify应用ID" source="本平台"><input value={using.id} readOnly /></FormField>
            <FormField label="应用名称" source="本平台"><input value={using.name} readOnly /></FormField>
          </div>
          <FormField label="使用者账户名" source="本平台"><input value={`${person.name} · ${person.account}`} readOnly /></FormField>
          <div className={`read-source ${useMatched ? '' : 'warn'}`}><span><strong>{useMatched ? '范围内 · 即办' : '范围不符 · 不能提交'}</strong><small>{notice}</small></span></div>
        </div>
        <div className="form-section">
          <div className="section-heading"><span>03</span><div><h4>使用申请</h4><p>只能申请该应用在仓库里已经开通的方式。未开通的方式不会出现。</p></div></div>
          <div className="form-field">
            <span>申请访问方式<b>*</b><em>用户</em></span>
            <div className="form-checks">
              {using.methods.map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={useMethods.includes(id)}
                    onChange={() => setUseMethods((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
                  />
                  {methodLabel(id)}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="form-section">
          <div className="section-heading"><span>04</span><div><h4>发布边界</h4><p>这些值来自当时的发布工单。系统拿申请人的组织、密级和业务线与它们比较。</p></div></div>
          <div className="form-row">
            <FormField label="目标用户范围" source="本平台"><input value={useScope} readOnly /></FormField>
            <FormField label="目标组织边界" source="本平台"><input value={boundary} readOnly /></FormField>
          </div>
          <div className="form-row">
            <FormField label="目标密级" source="本平台"><input value={using.id === 'app_clue_agent' ? '敏感' : '内部'} readOnly /></FormField>
            <FormField label="目标业务线" source="本平台"><input value={using.tags[0] || using.org} readOnly /></FormField>
          </div>
          <div className="form-row">
            <FormField label="边界匹配结果" source="本平台"><input value={useMatched ? '符合' : '不符合'} readOnly /></FormField>
            <FormField label="授权状态" source="本平台"><input value="待授权" readOnly /></FormField>
          </div>
        </div>
      </>
    )
  }

  if (code === 'AG-04') {
    const current = changing.releases[0]
    return (
      <>
        <div className="form-section">
          <div className="section-heading"><span>02</span><div><h4>变更对象</h4><p>仓库里的应用在 Dify 上有了新版本。这张单申请用新版本整版替换当前版本。</p></div></div>
          <FormField label="仓库应用" source="用户" required>
            <select value={changing.id} onChange={(event) => setChangeId(event.target.value)}>
              {published.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </FormField>
          <div className="form-row">
            <FormField label="Dify应用ID" source="本平台"><input value={changing.id} readOnly /></FormField>
            <FormField label="切换方式" source="本平台"><input value="审批通过后全量切换" readOnly /></FormField>
          </div>
          <div className="form-row">
            <FormField label="原发布版本ID" source="本平台"><input value={current?.version ?? '—'} readOnly /></FormField>
            <FormField label="新发布版本ID" source="Dify API"><input value="v1.7" readOnly /></FormField>
          </div>
          <div className="form-row">
            <FormField label="原工作流快照ID" source="本平台"><input value={`${changing.id}-snap-current`} readOnly /></FormField>
            <FormField label="新工作流快照ID" source="本平台"><input value={`${changing.id}-snap-next`} readOnly /></FormField>
          </div>
          <FormField label="变更说明" source="本平台"><textarea value="系统比对新旧版本和应用内知识库。" readOnly /></FormField>
        </div>
        <div className="form-section">
          <div className="section-heading"><span>03</span><div><h4>资源差异</h4><p>系统比较新旧工作流。新增且未批准的插件、工具或 MCP 会形成发布告警。</p></div></div>
          <FormField label="资源差异" source="Dify API和本平台"><MiniTable columns={['类型', '资源ID', '资源名称', '新增或删除', '批准状态', '对外使用权限']} rows={[['插件', 'case-chart', 'case-chart', '新增', '未批准', '禁止']]} /></FormField>
          <FormField label="新插件清单" source="Dify API和本平台"><MiniTable columns={['ID', '名称', '版本', '批准状态', '对外权限']} rows={[['case-chart', 'case-chart', 'v0.9.2', '未批准', '禁止']]} /></FormField>
          <FormField label="新工具清单" source="Dify API和本平台"><MiniTable columns={['工具ID', '名称', '配置指纹', '批准状态', '对外使用权限']} rows={[]} /></FormField>
          <FormField label="新MCP清单" source="Dify API和本平台"><MiniTable columns={['ID', '名称', 'URL指纹', '批准状态', '对外权限']} rows={[]} /></FormField>
          <div className="form-row">
            <FormField label="未批准资源数" source="本平台"><input value="1" readOnly /></FormField>
            <FormField label="发布资源告警状态" source="本平台"><input value="有告警" readOnly /></FormField>
          </div>
          <FormField label="发布告警" source="本平台"><textarea value="插件 case-chart 未批准，且没有对外使用权限。" readOnly /></FormField>
          <div className="form-row">
            <FormField label="告警处理决定" source="运维办理"><select disabled><option>驳回整改</option><option>确认风险并继续审批</option></select></FormField>
            <FormField label="告警处理说明" source="运维办理"><input value="有告警时，由运维人员在办理节点填写" readOnly /></FormField>
          </div>
        </div>
      </>
    )
  }

  const grants = retiring.id === 'app_clue_agent' ? ['3', '1'] : ['6', '2']
  return (
    <>
      <div className="form-section">
        <div className="section-heading"><span>02</span><div><h4>下架对象</h4><p>申请把仓库里的应用下架。申请人说明原因和时间，运维人员在办理时决定撤哪些授权和密钥。</p></div></div>
        <FormField label="仓库应用" source="用户" required>
          <select value={retiring.id} onChange={(event) => setRetireId(event.target.value)}>
            {published.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </FormField>
        <div className="form-row">
          <FormField label="Dify应用ID" source="本平台"><input value={retiring.id} readOnly /></FormField>
          <FormField label="应用名称" source="本平台"><input value={retiring.name} readOnly /></FormField>
        </div>
        <div className="form-row">
          <FormField label="下架原因" source="用户" required>
            <select><option>主动下架</option><option>版本替换</option><option>安全事件</option><option>长期故障</option><option>其他</option></select>
          </FormField>
          <FormField label="生效时间" source="本平台"><input value="审批通过后生效" readOnly /></FormField>
        </div>
        <FormField label="替代应用" source="用户">
          <select><option>不指定</option>{published.filter((item) => item.id !== retiring.id).map((item) => <option key={item.id}>{item.name}</option>)}</select>
        </FormField>
      </div>
      <div className="form-section">
        <div className="section-heading"><span>03</span><div><h4>影响与处置</h4><p>授权数和密钥数由系统统计。处置范围不在申请时勾选。</p></div></div>
        <div className="form-row">
          <FormField label="当前有效授权数" source="本平台"><input value={grants[0]} readOnly /></FormField>
          <FormField label="当前有效密钥数" source="本平台"><input value={grants[1]} readOnly /></FormField>
        </div>
        <div className="form-field">
          <span>处置范围<em>运维办理</em></span>
          <div className="form-checks">
            {['仓库下架', '撤销访问授权', '撤销登记密钥'].map((item) => (
              <label key={item}><input type="checkbox" disabled />{item}</label>
            ))}
          </div>
        </div>
        <FormField label="下架动作明细" source="本平台和Dify API"><input value="执行后写入动作、对象和结果" readOnly /></FormField>
      </div>
    </>
  )
}

function CatalogActionBody({ code, role, onMeta }: { code: string; role: Role; onMeta: (meta: ResourceStamp) => void }) {
  const person = personOf(role)
  const [pick, setPick] = useState(code === 'PLG-03' ? 'document-parser' : code === 'MCP-02' ? '档案检索服务' : '公文摘要 Skill')
  useEffect(() => {
    const table: Record<string, ResourceStamp> = {
      'document-parser': { name: 'document-parser', level: '内部', line: '刑侦' },
      'case-chart': { name: 'case-chart', level: '', line: '' },
      'web-search': { name: 'web-search', level: '内部', line: '' },
      '档案检索服务': { name: '档案检索服务', level: '内部', line: '刑侦' },
      '地图服务': { name: '地图服务', level: '', line: '' },
      '公文摘要 Skill': { name: '公文摘要 Skill', level: '内部', line: '刑侦' },
      '表格分析 Skill': { name: '表格分析 Skill', level: '', line: '' },
    }
    onMeta(table[pick] ?? { name: pick, level: '', line: '' })
  }, [pick, onMeta])
  if (code === 'PLG-03') {
    return (
      <div className="form-section">
        <div className="section-heading"><span>02</span><div><h4>安装对象</h4><p>安装、升级或卸载只生成这张单，不直接改 Dify。公开免审走即办，受限安装进入审批。</p></div></div>
        <FormField label="目录插件" source="用户" required>
          <select value={pick} onChange={(event) => setPick(event.target.value)}>
            <option>document-parser</option>
            <option>case-chart</option>
            <option>web-search</option>
          </select>
        </FormField>
        <div className="form-row">
          <FormField label="插件名称" source="本平台"><input value={pick} readOnly /></FormField>
          <FormField label="批准版本号" source="本平台"><input value="v2.4.1" readOnly /></FormField>
        </div>
        <FormField label="版本指纹" source="本平台"><input value="plg_fp_2f91" readOnly /></FormField>
        <div className="form-row">
          <FormField label="操作类型" source="用户" required><select><option>安装</option><option>升级</option><option>卸载</option></select></FormField>
          <FormField label="公开方式" source="本平台"><input value="公开免审" readOnly /></FormField>
        </div>
        <div className="form-row">
          <FormField label="目标账户名" source="本平台"><input value={`${person.name} · ${person.account}`} readOnly /></FormField>
          <FormField label="目标Dify workspace ID" source="本平台"><input value="ws_chen" readOnly /></FormField>
        </div>
        <div className="form-row">
          <FormField label="权限匹配结果" source="本平台"><input value="免审" readOnly /></FormField>
          <FormField label="Dify安装结果" source="Dify API"><input value="执行后写入成功或失败" readOnly /></FormField>
        </div>
      </div>
    )
  }
  if (code === 'MCP-02') {
    return (
      <div className="form-section">
        <div className="section-heading"><span>02</span><div><h4>绑定对象</h4><p>从内网目录选择 MCP，不手填地址。范围内绑定即办。页面不展示带凭据的 URL。</p></div></div>
        <FormField label="MCP目录" source="用户" required>
          <select value={pick} onChange={(event) => setPick(event.target.value)}>
            <option>档案检索服务</option>
            <option>地图服务</option>
          </select>
        </FormField>
        <div className="form-row">
          <FormField label="MCP名称" source="本平台"><input value={pick} readOnly /></FormField>
          <FormField label="URL指纹" source="本平台"><input value="mcp_fp_91ac" readOnly /></FormField>
        </div>
        <div className="form-row">
          <FormField label="使用者账户名" source="本平台"><input value={`${person.name} · ${person.account}`} readOnly /></FormField>
          <FormField label="目标Dify workspace ID" source="本平台"><input value="ws_chen" readOnly /></FormField>
        </div>
        <FormField label="Dify调用身份登记ID" source="本平台"><input value="key_chen_04" readOnly /></FormField>
        <FormField label="目标智能体" source="用户"><select><option>不指定</option><option>案件摘要助手</option><option>知识检索助手</option></select></FormField>
        <FormField label="边界匹配结果" source="本平台"><input value={pick === '地图服务' ? (person.org === '情指中心' ? '符合' : '不符合') : '符合'} readOnly /></FormField>
        <FormField label="Dify绑定结果" source="Dify API"><input value="执行后写入成功或失败" readOnly /></FormField>
      </div>
    )
  }
  return (
    <div className="form-section">
      <div className="section-heading"><span>02</span><div><h4>下载对象</h4><p>下载即办。成功指文件已经交付并记下流水。点击、生成链接或只生成工单都不算成功。</p></div></div>
      <FormField label="Skill目录" source="用户" required>
        <select value={pick} onChange={(event) => setPick(event.target.value)}>
          <option>公文摘要 Skill</option>
          <option>表格分析 Skill</option>
        </select>
      </FormField>
      <div className="form-row">
        <FormField label="Skill名称" source="本平台"><input value={pick} readOnly /></FormField>
        <FormField label="版本号" source="本平台"><input value={pick === '表格分析 Skill' ? 'v1.8.2' : 'v2.1.0'} readOnly /></FormField>
      </div>
      <FormField label="文件SHA-256" source="本平台"><input value="a8df…930c" readOnly /></FormField>
      <div className="form-row">
        <FormField label="下载人账户名" source="本平台"><input value={`${person.name} · ${person.account}`} readOnly /></FormField>
        <FormField label="下载人组织" source="本平台"><input value={person.org} readOnly /></FormField>
      </div>
      <div className="form-row">
        <FormField label="权限核对结果" source="本平台"><input value="允许" readOnly /></FormField>
        <FormField label="下载结果" source="本平台"><input value="交付后写入成功或失败" readOnly /></FormField>
      </div>
      <FormField label="下载流水号" source="本平台"><input value="交付成功后生成" readOnly /></FormField>
    </div>
  )
}

function manualSources(code: string, category: string) {
  if (code === 'KB-01' || code === 'KB-02') return ['RAGFlow', 'Dify']
  if (category === '知识库' || category === 'Skill' || category === '告警') return ['本平台']
  if (category === '凭证' || category === '工具' || category === '智能体') return ['Dify']
  return ['Dify', '本平台']
}

function ManualApplication({ role }: { role: Role }) {
  const availableTypes = role === 'admin' ? [...ticketTypes, ...adminTicketTypes] : ticketTypes
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [selected, setSelected] = useState(availableTypes[0])
  const [path, setPath] = useState(defaultPath(availableTypes[0][0]))
  const opening = resourceChoices(availableTypes[0][0])[0]
  const [resourceName, setResourceName] = useState(opening.name)
  const [resourceLevel, setResourceLevel] = useState(opening.level)
  const [resourceLine, setResourceLine] = useState(opening.line)
  const onMeta = useCallback((meta: ResourceStamp) => {
    setResourceName(meta.name)
    setResourceLevel(meta.level)
    setResourceLine(meta.line)
  }, [])
  const chooseType = (item: typeof availableTypes[number]) => {
    setSelected(item)
    setExecution(null)
    setPath(defaultPath(item[0]))
    if (specializedCodes.includes(item[0])) {
      setResourceName('')
      setResourceLevel('')
      setResourceLine('')
      return
    }
    const first = resourceChoices(item[0])[0]
    setResourceName(first.name)
    setResourceLevel(first.level)
    setResourceLine(first.line)
    setExecution(null)
  }
  const applyResource = (name: string) => {
    const found = resourceChoices(selected[0]).find((item) => item.name === name)
    if (!found) return
    setResourceName(found.name)
    setResourceLevel(found.level)
    setResourceLine(found.line)
  }
  const person = personOf(role)
  const [execution, setExecution] = useState<null | { ok: boolean; failureReason: string; resultId: string; ticketNo?: string }>(null)
  const [submitting, setSubmitting] = useState(false)
  const note = needsApplicationNote(selected[0], path)
  const chooseLevel = needsLevelPick(selected[0], path)
  const mode = shownMode(selected[0], selected[3], path)
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
              <button key={item[0]} className={selected[0] === item[0] ? 'active' : ''} onClick={() => chooseType(item)}>
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
            <span className={mode === '即办' ? 'approval instant' : 'approval'}>{mode === '即办' ? <Zap size={14} /> : <Clock3 size={14} />}{mode}</span>
          </div>
          <div className="stepper"><span className="active"><b>1</b>申请对象</span><i /><span><b>2</b>业务信息</span><i /><span><b>3</b>检查提交</span></div>
          <div className="form-section">
            <div className="section-heading"><span>01</span><div><h4>基本信息</h4><p>{note ? '标题由系统生成。这张单要人审批，请写一句申请说明。' : selected[0] === 'EVT-01' ? '标题由系统生成。这里写一句人工事实说明。' : '标题由系统生成。这张单即办，不收集申请说明。'}</p></div></div>
            <FormField label="工单标题" source="本平台"><input value={`${selected[1]} · ${resourceName || '未选择资源'}`} readOnly /></FormField>
            <div className="form-row">
              <FormField label="申请人" source="本平台"><input value={`${person.name} · ${person.account}`} readOnly /></FormField>
              <FormField label="申请组织" source="本平台"><input value={person.org} readOnly /></FormField>
            </div>
            <RecordedBoundary key={`${selected[0]}-${path}-${resourceName}`} role={role} resourceLevel={resourceLevel} resourceLine={resourceLine} choose={chooseLevel} />
            {selected[0] === 'EVT-01' ? (
              <FormField label="人工事实说明" source="用户" required><textarea placeholder="写一句看到的事实" /></FormField>
            ) : note ? (
              <FormField label="申请说明" source="用户" required><textarea placeholder="写一句申请原因" /></FormField>
            ) : null}
          </div>
          {['AG-01', 'AG-02', 'AG-03', 'AG-04', 'AG-05'].includes(selected[0]) ? <AgentTicketBody key={selected[0]} code={selected[0]} role={role} onMeta={onMeta} /> : ['PLG-03', 'MCP-02', 'SKL-03'].includes(selected[0]) ? <CatalogActionBody key={selected[0]} code={selected[0]} role={role} onMeta={onMeta} /> : (
          <div className="form-section">
            <div className="section-heading"><span>02</span><div><h4>申请对象</h4><p>{selected[2] === '知识库' && (selected[0] === 'KB-01' || selected[0] === 'KB-02') ? '知识库来自 RAGFlow 或 Dify。' : '来源按这张工单的设计读取，选中后刷新只读字段。'}</p></div></div>
            {selected[0] === 'KEY-01' && (
              <FormField label="调用方" source="用户" required>
                <select value={path} onChange={(event) => setPath(event.target.value)}><option>本人</option><option>对外</option></select>
              </FormField>
            )}
            {(selected[0] === 'PLG-01' || selected[0] === 'SKL-01' || selected[0] === 'MCP-01') && (
              <FormField label="给谁用" source="用户" required>
                <select value={path} onChange={(event) => setPath(event.target.value)}><option>本人</option><option>分享</option></select>
              </FormField>
            )}
            {selected[0] === 'MCP-03' && (
              <FormField label="处置类型" source="用户" required>
                <select value={path} onChange={(event) => setPath(event.target.value)}><option>解绑</option><option>隔离</option><option>下架</option></select>
              </FormField>
            )}
            {selected[2] === '账号' ? (
              <div className="form-row">
                <FormField label="目标人员" source="用户" required>
                  <select value={resourceName} onChange={(event) => applyResource(event.target.value)}>
                    {resourceChoices(selected[0]).map((item) => <option key={item.name}>{item.name}</option>)}
                  </select>
                </FormField>
                <FormField label="操作类型" source="用户" required><select><option>开通</option><option>停用</option><option>组织变更</option><option>角色变更</option></select></FormField>
              </div>
            ) : (
              <div className="form-row">
                <FormField label="来源系统" source={manualSources(selected[0], selected[2]).length === 1 ? manualSources(selected[0], selected[2])[0] : '用户'} required>
                  <select key={selected[0]} disabled={manualSources(selected[0], selected[2]).length === 1} defaultValue={manualSources(selected[0], selected[2])[0] === '本平台' ? '本平台' : '请选择'}>
                    {manualSources(selected[0], selected[2]).length > 1 && <option>请选择</option>}
                    {manualSources(selected[0], selected[2]).map((item) => <option key={item}>{item}</option>)}
                  </select>
                </FormField>
                <FormField label={`${selected[2]}资源`} source="用户" required>
                  <select value={resourceName} onChange={(event) => applyResource(event.target.value)}>
                    {resourceChoices(selected[0]).map((item) => <option key={item.name}>{item.name}</option>)}
                  </select>
                </FormField>
              </div>
            )}
            <div className="read-source"><Activity size={16} /><span><strong>{resourceName || '等待选择资源'}</strong><small>名称、所有者和版本由系统读取。密级和业务线优先用资源上的值。</small></span></div>
          </div>
          )}
          {execution && (
            <div className={`read-source ${execution.ok ? '' : 'warn'}`}>
              <span>
                <strong>{execution.ok ? `执行完成 · ${execution.resultId}` : '执行失败'}</strong>
                <small>{execution.ok ? `${execution.ticketNo} 已写入下载流水` : execution.failureReason}</small>
              </span>
            </div>
          )}
          <div className="manual-actions">
            <button className="secondary-button">保存草稿</button>
            <button className="secondary-button"><ClipboardCheck size={15} /> 检查</button>
            <button className="primary-button" disabled={submitting} onClick={async () => {
              const ticketNo = `${selected[0]}-${Date.now()}`
              setSubmitting(true)
              try {
                const response = await fetch('/api/execute', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    ticketNo,
                    ticketType: selected[0],
                    action: selected[0] === 'SKL-03' ? 'download' : selected[0] === 'PLG-03' ? 'install' : '',
                    resourceId: resourceName,
                    account: person.account,
                    org: person.org,
                  }),
                })
                const result = await response.json()
                setExecution({ ...result, ticketNo })
              } catch {
                setExecution({ ok: false, failureReason: '执行服务没有响应', resultId: '', ticketNo })
              } finally {
                setSubmitting(false)
              }
            }}>提交申请 <ArrowRight size={16} /></button>
          </div>
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
    setView(nextRole === 'user' ? 'agents' : 'overview')
  }

  if (!role || !identity) return <Login onLogin={login} />

  const monitorViews: View[] = ['overview', 'knowledge', 'agentMonitor', 'plugins', 'mcp', 'skills', 'security', 'accounts', 'audit']
  const safeView = role === 'user' && monitorViews.includes(view) ? 'agents' : view

  let content: React.ReactNode
  if (safeView === 'overview') content = <Overview role={role} onWorkOrder={setDrawer} />
  else if (safeView === 'agents') content = <AgentWarehousePage role={role} />
  else if (safeView === 'pluginWarehouse' || safeView === 'mcpWarehouse' || safeView === 'skillWarehouse') content = <CatalogWarehouse view={safeView} role={role} onWorkOrder={setDrawer} />
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
