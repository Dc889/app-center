import type {LucideIcon} from 'lucide-react'
import {Users} from 'lucide-react'
import {Headphones} from 'lucide-react'
import {UserCog} from 'lucide-react'
import {Bot} from 'lucide-react'
import {PlugZap} from 'lucide-react'
import {Network} from 'lucide-react'
import {PackageCheck} from 'lucide-react'
import {Gauge} from 'lucide-react'
import {Database} from 'lucide-react'
import {Radar} from 'lucide-react'
import {ShieldAlert} from 'lucide-react'
import {FileCheck2} from 'lucide-react'
import {MessageSquareText} from 'lucide-react'
import {FilePlus2} from 'lucide-react'
import {ClipboardList} from 'lucide-react'
import {ListChecks} from 'lucide-react'
import {Search} from 'lucide-react'

export type Role = 'user' | 'ops' | 'admin'

export type View =
  | 'overview' | 'knowledge' | 'agents' | 'agentMonitor'
  | 'pluginWarehouse' | 'mcpWarehouse' | 'skillWarehouse'
  | 'plugins' | 'mcp' | 'skills'
  | 'security' | 'accounts' | 'audit'
  | 'chat' | 'manual' | 'mine' | 'todo' | 'query' | 'types'

export type Identity = {
  role: Role
  roleName: string
  name: string
  account: string
  org: string
  initials: string
  note: string
  icon: LucideIcon
}

export type NavItem = { id: View; label: string; icon: LucideIcon }

export const identities: Identity[] = [
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

export const warehouseNav: NavItem[] = [
  { id: 'agents', label: '智能体仓库', icon: Bot },
  { id: 'pluginWarehouse', label: '插件仓库', icon: PlugZap },
  { id: 'mcpWarehouse', label: 'MCP仓库', icon: Network },
  { id: 'skillWarehouse', label: 'Skill仓库', icon: PackageCheck },
]

export const monitorNav: NavItem[] = [
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

export const baseTicketNav: NavItem[] = [
  { id: 'chat', label: '对话申请', icon: MessageSquareText },
  { id: 'manual', label: '手工申请', icon: FilePlus2 },
  { id: 'mine', label: '我的申请', icon: ClipboardList },
]

export const operationTicketNav: NavItem[] = [
  ...baseTicketNav,
  { id: 'todo', label: '我的待办', icon: ListChecks },
  { id: 'query', label: '工单查询', icon: Search },
]

export const pageMeta: Record<View, { title: string; eyebrow: string; desc: string }> = {
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



export function personOf(role: Role) {
  try {const p=JSON.parse(sessionStorage.getItem('session-person') ?? 'null');if(p?.role===role)return {name:p.name as string,account:p.account as string,org:p.org as string,line:p.businessLine as string,level:''}} catch {}
  if (role === 'ops') return { name: sessionStorage.getItem('operator')==='wang.ning'?'王宁':'周敏', account: sessionStorage.getItem('operator')==='wang.ning'?'wang.ning':'zhou.min', org: '平台运营组', line: '', level: '' }
  if (role === 'admin') return { name: '李强', account: 'li.qiang', org: '系统管理组', line: '', level: '' }
  return { name: '陈宇', account: 'chen.yu', org: '业务一部', line: '刑侦', level: '内部' }
}
