import { check } from '../../../../runtime/http.mjs'

const BASELINE_WAREHOUSE_AGENTS = [
  {
    id: 'app_case_summary',
    name: '案件摘要助手',
    emoji: '📋',
    developer: '陈宇',
    developerAccount: 'chen.yu',
    org: '业务一部',
    description: '读取案件材料、法规和文书范例，生成可复核的案件摘要，并标出引用出处。',
    tags: ['刑侦', '摘要', '文书'],
    directlyUsable: true,
    methods: ['run', 'embed', 'api'],
    unavailableReason: '',
    visibleOrgs: [],
    mode: 'Chatflow',
    baseSuccessCount: 18,
    releases: [
      { version: 'v1.6', publishedAt: '11-16 20:18', changedAt: '11-16 19:46', summary: '接入档案检索，摘要增加出处标注', ticket: 'AG-20261116-0142' },
      { version: 'v1.5', publishedAt: '11-12 16:40', changedAt: '11-12 16:22', summary: '压缩摘要长度，保留关键事实段', ticket: 'AG-20261112-0098' },
      { version: 'v1.4', publishedAt: '11-08 09:15', changedAt: '11-08 09:02', summary: '首次通过发布工单上架', ticket: 'AG-20261108-0041' },
    ],
  },
  {
    id: 'app_incident_analysis',
    name: '警情辅助分析',
    emoji: '🚨',
    developer: '郑毅',
    developerAccount: 'zheng.yi',
    org: '情指中心',
    description: '按警情处置规范梳理要素、关联地点和历史警情，输出处置建议。',
    tags: ['情指', '研判'],
    directlyUsable: true,
    methods: ['run', 'api'],
    unavailableReason: '',
    visibleOrgs: [],
    mode: 'Workflow',
    baseSuccessCount: 14,
    releases: [
      { version: 'v2.8', publishedAt: '11-16 19:36', changedAt: '11-16 19:12', summary: '增加地点检索，关闭嵌入网站', ticket: 'AG-20261116-0136' },
      { version: 'v2.7', publishedAt: '11-09 11:20', changedAt: '11-09 10:48', summary: '调整警情分类提示词', ticket: 'AG-20261109-0066' },
    ],
  },
  {
    id: 'app_clue_agent',
    name: '线索分析 Agent',
    emoji: '🔎',
    developer: '吴凡',
    developerAccount: 'wu.fan',
    org: '网安支队',
    description: '面向网安线索的多步研判助手，会查询线索库并整理时间线。',
    tags: ['网安', 'Agent', '线索'],
    directlyUsable: true,
    methods: ['run', 'embed', 'api'],
    unavailableReason: '',
    visibleOrgs: ['网安支队'],
    mode: 'Agent',
    baseSuccessCount: 11,
    releases: [
      { version: 'v3.2', publishedAt: '11-16 18:20', changedAt: '11-16 17:55', summary: '补充线索查询工具和图表输出', ticket: 'AG-20261116-0128' },
      { version: 'v3.1', publishedAt: '11-04 15:06', changedAt: '11-04 14:40', summary: '首次上架到仓库', ticket: 'AG-20261104-0033' },
    ],
  },
  {
    id: 'app_duty_qa',
    name: '勤务问答助手',
    emoji: '🗓️',
    developer: '孙宁',
    developerAccount: 'sun.ning',
    org: '治安支队',
    description: '根据勤务规范回答排班、备勤和现场处置问题，只引用已审核段落。',
    tags: ['治安', '问答'],
    directlyUsable: true,
    methods: ['run', 'embed'],
    unavailableReason: '',
    visibleOrgs: [],
    mode: 'Chatflow',
    baseSuccessCount: 9,
    releases: [
      { version: 'v1.2', publishedAt: '11-16 17:42', changedAt: '11-16 17:18', summary: '更新勤务规范库引用范围', ticket: 'AG-20261116-0114' },
      { version: 'v1.1', publishedAt: '10-28 09:30', changedAt: '10-28 09:12', summary: '首次上架，仅开通运行和嵌入', ticket: 'AG-20261028-0020' },
    ],
  },
  {
    id: 'app_company_risk',
    name: '企业风险查询',
    emoji: '🏢',
    developer: '林杰',
    developerAccount: 'lin.jie',
    org: '经侦支队',
    description: '按企业名称查询风险规则命中项，并给出需要人工复核的点。',
    tags: ['经侦', '查询'],
    directlyUsable: true,
    methods: ['run'],
    unavailableReason: '',
    visibleOrgs: [],
    mode: 'Workflow',
    baseSuccessCount: 8,
    releases: [
      { version: 'v1.3', publishedAt: '11-15 14:22', changedAt: '11-15 13:50', summary: '收紧对外方式，仅保留运行', ticket: 'AG-20261115-0102' },
      { version: 'v1.0', publishedAt: '10-21 10:08', changedAt: '10-21 09:40', summary: '首次上架', ticket: 'AG-20261021-0018' },
    ],
  },
  {
    id: 'app_netlog_analysis',
    name: '网络日志研判',
    emoji: '🌐',
    developer: '吴凡',
    developerAccount: 'wu.fan',
    org: '网安支队',
    description: '对网络日志做规则命中和异常归纳，适合接入已有研判平台。',
    tags: ['网安', '日志'],
    directlyUsable: true,
    methods: ['run', 'api'],
    unavailableReason: '',
    visibleOrgs: ['网安支队'],
    mode: 'Workflow',
    baseSuccessCount: 7,
    releases: [
      { version: 'v2.0', publishedAt: '11-14 16:05', changedAt: '11-14 15:28', summary: '开放访问 API，保留运行', ticket: 'AG-20261114-0088' },
      { version: 'v1.4', publishedAt: '10-30 11:16', changedAt: '10-30 10:42', summary: '首次上架', ticket: 'AG-20261030-0026' },
    ],
  },
  {
    id: 'app_doc_check',
    name: '执法文书校验',
    emoji: '⚖️',
    developer: '唐雨',
    developerAccount: 'tang.yu',
    org: '刑侦支队',
    description: '按执法文书标准检查要素是否齐全，结果通过接口返回给办案系统。',
    tags: ['执法', '文书'],
    directlyUsable: true,
    methods: ['api'],
    unavailableReason: '',
    visibleOrgs: ['刑侦支队'],
    mode: 'Workflow',
    baseSuccessCount: 6,
    releases: [
      { version: 'v3.1', publishedAt: '11-13 18:40', changedAt: '11-13 18:06', summary: '只保留访问 API，供办案系统调用', ticket: 'AG-20261113-0074' },
      { version: 'v3.0', publishedAt: '10-18 09:24', changedAt: '10-18 08:55', summary: '首次上架', ticket: 'AG-20261018-0012' },
    ],
  },
  {
    id: 'app_case_link',
    name: '案件串并助手',
    emoji: '🔗',
    developer: '唐雨',
    developerAccount: 'tang.yu',
    org: '刑侦支队',
    description: '按案件特征查找相似案件，整理串并线索和差异点。',
    tags: ['刑侦', '串并'],
    directlyUsable: true,
    methods: ['run', 'embed', 'api'],
    unavailableReason: '',
    visibleOrgs: [],
    mode: 'Agent',
    baseSuccessCount: 5,
    releases: [
      { version: 'v2.4', publishedAt: '11-16 15:08', changedAt: '11-16 14:36', summary: '串并结果增加图表说明', ticket: 'AG-20261116-0096' },
      { version: 'v2.3', publishedAt: '11-02 13:18', changedAt: '11-02 12:40', summary: '扩大特征库检索范围', ticket: 'AG-20261102-0029' },
    ],
  },
  {
    id: 'app_knowledge_search',
    name: '知识检索助手',
    emoji: '📚',
    developer: '陈宇',
    developerAccount: 'chen.yu',
    org: '业务一部',
    description: '在政策和办事指南中检索依据，回答时带出命中段落。',
    tags: ['检索', '问答'],
    directlyUsable: true,
    methods: ['run', 'embed'],
    unavailableReason: '',
    visibleOrgs: [],
    mode: 'Chatflow',
    baseSuccessCount: 5,
    releases: [
      { version: 'v1.1', publishedAt: '11-11 10:26', changedAt: '11-11 09:58', summary: '增加办事指南库', ticket: 'AG-20261111-0052' },
      { version: 'v1.0', publishedAt: '10-25 16:12', changedAt: '10-25 15:40', summary: '首次上架', ticket: 'AG-20261025-0016' },
    ],
  },
  {
    id: 'app_fund_analysis',
    name: '资金研判助手',
    emoji: '💰',
    developer: '林杰',
    developerAccount: 'lin.jie',
    org: '经侦支队',
    description: '结合经侦指标和企业信息，辅助看资金往来里的异常点。',
    tags: ['经侦', '资金'],
    directlyUsable: true,
    methods: ['run', 'api'],
    unavailableReason: '',
    visibleOrgs: [],
    mode: 'Workflow',
    baseSuccessCount: 4,
    releases: [
      { version: 'v1.8', publishedAt: '11-15 09:48', changedAt: '11-15 09:10', summary: '接通企业查询，开通运行和 API', ticket: 'AG-20261115-0081' },
      { version: 'v1.5', publishedAt: '10-19 14:05', changedAt: '10-19 13:22', summary: '首次上架', ticket: 'AG-20261019-0009' },
    ],
  },
  {
    id: 'app_legacy_doc',
    name: '旧版文书助手',
    emoji: '📄',
    developer: '高峰',
    developerAccount: 'gao.feng',
    org: '业务一部',
    description: '早期文书生成应用。下架工单已经办结，三种使用方式全部关闭。',
    tags: ['文书'],
    directlyUsable: false,
    methods: [],
    unavailableReason: '下架工单已办结，应用已从可使用范围移除。',
    visibleOrgs: [],
    mode: 'Chatflow',
    baseSuccessCount: 2,
    releases: [
      { version: 'v0.9', publishedAt: '09-18 11:00', changedAt: '11-16 16:28', summary: '执行下架，关闭运行、嵌入和 API', ticket: 'AG-20261116-0084' },
      { version: 'v0.8', publishedAt: '09-02 10:12', changedAt: '09-02 09:40', summary: '最后一次功能发布', ticket: 'AG-20260902-0004' },
    ],
  },
  {
    id: 'app_fund_lab',
    name: '资金研判实验版',
    emoji: '🧪',
    developer: '林杰',
    developerAccount: 'lin.jie',
    org: '经侦支队',
    description: '资金研判的试验流程。发布工单还在审核，当前不能直接使用。',
    tags: ['经侦', '实验'],
    directlyUsable: false,
    methods: [],
    unavailableReason: '发布工单仍在审核，通过后才会开通使用方式。',
    visibleOrgs: ['经侦支队'],
    mode: 'Workflow',
    baseSuccessCount: 0,
    releases: [],
  },
]

export function agentWarehouseReport({
  query,
  identity,
  applications = [],
  now = Date.now(),
}) {
  check(identity && identity.account, 403, 'ACCESS_DENIED')
  const isUser = !identity.roles.includes('admin') && !identity.roles.includes('operator')
  const userOrg = identity.org ?? ''

  // 1. 构建智能体资产目录副本并融入工单变更
  const agentMap = new Map()
  for (const item of BASELINE_WAREHOUSE_AGENTS) {
    agentMap.set(item.id, JSON.parse(JSON.stringify(item)))
  }

  // 2. 遍历已完成的相关工单动态更新状态
  for (const app of applications) {
    if (app.status !== '已完成') continue
    const targetAgentId = app.submission?.resourceId ?? app.snapshot?.resourceId
    if (!targetAgentId) continue

    let agent = agentMap.get(targetAgentId)
    if (!agent) {
      // 允许新发布生效的智能体动态进入仓库
      if (app.ticketType === 'AG-01' || app.ticketType === 'AG-02') {
        agent = {
          id: targetAgentId,
          name: app.submission?.fields?.name ?? targetAgentId,
          emoji: '🤖',
          developer: app.account,
          developerAccount: app.account,
          org: app.org,
          description: app.submission?.fields?.description ?? '已上架发布的新智能体。',
          tags: ['工单发布'],
          directlyUsable: true,
          methods: ['run', 'api'],
          unavailableReason: '',
          visibleOrgs: [],
          mode: 'Chatflow',
          baseSuccessCount: 0,
          releases: [
            {
              version: app.snapshot?.data?.publicationVersionId ?? 'v1.0',
              publishedAt: new Date(app.createdAt ?? now).toLocaleDateString('zh-CN'),
              changedAt: new Date(app.updatedAt ?? now).toLocaleDateString('zh-CN'),
              summary: '通过工单审核发布上架',
              ticket: app.ticketNo,
            },
          ],
        }
        agentMap.set(targetAgentId, agent)
      }
      continue
    }

    // 处理下架工单 (AG-05)
    if (app.ticketType === 'AG-05') {
      agent.directlyUsable = false
      agent.methods = []
      agent.unavailableReason = `下架工单 (${app.ticketNo}) 已办结，应用已关闭。`
      agent.releases.unshift({
        version: agent.releases[0] ? `v${(parseFloat(agent.releases[0].version.replace('v', '')) + 0.1).toFixed(1)}` : 'v0.9',
        publishedAt: new Date(app.createdAt ?? now).toLocaleDateString('zh-CN'),
        changedAt: new Date(app.updatedAt ?? now).toLocaleDateString('zh-CN'),
        summary: `执行下架：${app.submission?.fields?.reason ?? '业务申请下架'}`,
        ticket: app.ticketNo,
      })
    }

    // 处理再发布工单 (AG-04)
    if (app.ticketType === 'AG-04') {
      agent.directlyUsable = true
      agent.methods = ['run', 'embed', 'api']
      agent.unavailableReason = ''
      agent.releases.unshift({
        version: app.snapshot?.data?.publicationVersionId ?? 'v2.0',
        publishedAt: new Date(app.createdAt ?? now).toLocaleDateString('zh-CN'),
        changedAt: new Date(app.updatedAt ?? now).toLocaleDateString('zh-CN'),
        summary: `版本更新再发布：${app.submission?.fields?.summary ?? '功能升级迭代'}`,
        ticket: app.ticketNo,
      })
    }
  }

  // 3. 角色可见性与组织隔离规则
  let visibleAgents = Array.from(agentMap.values())
  if (isUser) {
    visibleAgents = visibleAgents.filter((agent) => {
      if (!agent.directlyUsable) return false
      if (!agent.visibleOrgs || agent.visibleOrgs.length === 0) return true
      return agent.visibleOrgs.includes(userOrg)
    })
    // 用户隐藏 ticket 工单号防越权
    for (const agent of visibleAgents) {
      for (const rel of agent.releases) {
        rel.ticket = ''
      }
    }
  }

  // 4. 计算指标与使用排行（全集）
  const total = visibleAgents.length
  const usableCount = visibleAgents.filter((a) => a.directlyUsable).length
  const fullMethodCount = visibleAgents.filter((a) => a.methods && a.methods.length === 3).length
  const runCount = visibleAgents.filter((a) => a.methods && a.methods.includes('run')).length
  const apiCount = visibleAgents.filter((a) => a.methods && a.methods.includes('api')).length
  const unavailableCount = total - usableCount

  const ranking = [...visibleAgents]
    .sort((a, b) => (b.baseSuccessCount ?? 0) - (a.baseSuccessCount ?? 0) || a.name.localeCompare(b.name, 'zh-CN'))
    .map((a) => ({
      id: a.id,
      name: a.name,
      developer: a.developer,
      org: a.org,
      count: a.baseSuccessCount ?? 0,
    }))

  const allTags = Array.from(new Set(visibleAgents.flatMap((a) => a.tags ?? [])))

  // 5. 应用查询参数筛选
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const tagFilter = query.get('tag') ?? '全部标签'
  const methodFilter = query.get('method') ?? '全部方式'
  const usableFilter = query.get('usable') ?? '全部'

  let filtered = visibleAgents.filter((agent) => {
    if (q) {
      const currentVer = agent.releases[0]?.version ?? ''
      const haystack = [
        agent.name,
        agent.developer,
        agent.developerAccount,
        agent.org,
        agent.description,
        currentVer,
        ...(agent.tags ?? []),
      ].join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }

    if (tagFilter !== '全部标签' && (!agent.tags || !agent.tags.includes(tagFilter))) {
      return false
    }

    if (methodFilter !== '全部方式' && (!agent.methods || !agent.methods.includes(methodFilter))) {
      return false
    }

    if (usableFilter === '可直接使用' && !agent.directlyUsable) return false
    if (usableFilter === '暂不可用' && agent.directlyUsable) return false
    if (usableFilter === '三种方式齐全' && (!agent.methods || agent.methods.length !== 3)) return false

    return true
  })

  return {
    asOf: new Date(now).toISOString(),
    role: isUser ? 'user' : identity.roles.includes('admin') ? 'admin' : 'ops',
    org: identity.org,
    metrics: {
      total,
      usableCount,
      fullMethodCount,
      runCount,
      apiCount,
      unavailableCount,
    },
    tags: allTags,
    ranking,
    items: filtered.map((a) => ({
      ...a,
      successCount: a.baseSuccessCount,
    })),
  }
}
