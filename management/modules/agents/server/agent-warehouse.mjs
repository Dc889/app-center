import { check } from '../../../../runtime/http.mjs'

const MODE_LABELS = {
  'advanced-chat': 'Chatflow',
  workflow: 'Workflow',
  'agent-chat': 'Agent',
  chat: 'Chatbot',
  completion: '文本生成',
}

export function agentWarehouseReport({
  query,
  identity,
  applications = [],
  now = Date.now(),
}) {
  check(identity && identity.account, 403, 'ACCESS_DENIED')
  const isUser = !identity.roles.includes('admin') && !identity.roles.includes('operator')
  const userOrg = identity.org ?? ''

  // 仓库只收录已经办结的发布工单，不预置演示应用。
  const agentMap = new Map()

  // 2. 遍历已完成的相关工单动态更新状态
  for (const app of applications) {
    if (app.status !== '已完成') continue
    const targetAgentId = app.submission?.resourceId ?? app.snapshot?.resourceId
    if (!targetAgentId) continue

    let agent = agentMap.get(targetAgentId)
    if (!agent) {
      // 允许新发布生效的智能体动态进入仓库
      if (app.ticketType === 'AG-01' || app.ticketType === 'AG-02') {
        const fields = app.submission?.fields ?? {}
        const resolvedName = app.snapshot?.name || app.snapshot?.data?.name || fields.name || targetAgentId
        const resolvedDesc = fields.scenario || fields.instructions || fields.description || '已上架发布的智能体。'
        const resolvedTags = [fields.businessLine, fields.classification].filter(Boolean)
        const resolvedMethods = Array.isArray(fields.usages) && fields.usages.length ? fields.usages : ['run', 'api']
        const resolvedVisibleOrgs = fields.scope === 'orgs' && Array.isArray(fields.targetOrgs) ? fields.targetOrgs : []
        const rawMode = app.snapshot?.data?.mode
        agent = {
          id: targetAgentId,
          name: resolvedName,
          emoji: '🤖',
          developer: app.account,
          developerAccount: app.account,
          org: app.org,
          description: resolvedDesc,
          tags: resolvedTags.length ? resolvedTags : ['工单发布'],
          directlyUsable: true,
          methods: resolvedMethods,
          unavailableReason: '',
          visibleOrgs: resolvedVisibleOrgs,
          mode: MODE_LABELS[rawMode] ?? rawMode ?? 'Chatflow',
          baseSuccessCount: 0,
          releases: [
            {
              version: app.snapshot?.data?.publicationVersionId ?? 'v1.0',
              publishedAt: new Date(app.createdAt ?? now).toLocaleDateString('zh-CN'),
              changedAt: new Date(app.updatedAt ?? now).toLocaleDateString('zh-CN'),
              summary: fields.instructions || '通过工单审核发布上架',
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
