import { check } from '../../../../runtime/http.mjs'

const DIFY_ACCOUNTS = [
  { account: 'chen.yu', name: '陈宇', org: '业务一部' },
  { account: 'zheng.yi', name: '郑毅', org: '情指中心' },
  { account: 'wu.fan', name: '吴凡', org: '网安支队' },
  { account: 'lin.jie', name: '林杰', org: '经侦支队' },
  { account: 'sun.ning', name: '孙宁', org: '治安支队' },
  { account: 'tang.yu', name: '唐雨', org: '刑侦支队' },
  { account: 'gao.feng', name: '高峰', org: '业务一部' },
  { account: 'zhou.min', name: '周敏', org: '平台运营组' },
]

const APP_PROFILES = {
  '案件摘要助手': {
    appId: 'df_app_01',
    appMode: '工作流编排',
    inWarehouse: true,
    models: ['openai / gpt-4.1-mini · 1,284入 / 342出'],
    knowledgeBases: ['案件法规库（ds_case_01）· 命中2段', '文书范例库（ds_doc_06）· 命中1段'],
    mcpCalls: ['档案检索服务 / search_archive · 1.8s'],
    pluginCalls: [],
  },
  '知识检索助手': {
    appId: 'df_app_02',
    appMode: '单智能体',
    inWarehouse: true,
    models: ['qwen / qwen-max · 840入 / 210出'],
    knowledgeBases: ['办案指引库（ds_law_03）· 命中3段'],
    mcpCalls: [],
    pluginCalls: ['web-search-pro / search · 1.2s'],
  },
  '文书草稿': {
    appId: 'df_app_03',
    appMode: '单智能体',
    inWarehouse: false,
    models: ['qwen / qwen-plus · 650入 / 480出'],
    knowledgeBases: [],
    mcpCalls: [],
    pluginCalls: [],
  },
  '警情辅助分析': {
    appId: 'df_app_04',
    appMode: '多智能体',
    inWarehouse: true,
    models: ['openai / gpt-4.1 · 2,420入 / 680出'],
    knowledgeBases: ['勤务规范库（ds_duty_02）· 命中1段'],
    mcpCalls: ['地图服务 / geo_search · 3.4s'],
    pluginCalls: ['document-parser / parse · 0.9s'],
  },
  '警情分类实验': {
    appId: 'df_app_05',
    appMode: '工作流编排',
    inWarehouse: false,
    models: ['openai / gpt-4.1-mini · 520入 / 110出'],
    knowledgeBases: [],
    mcpCalls: ['地图服务 / route_plan · 1.5s'],
    pluginCalls: [],
  },
  '线索分析 Agent': {
    appId: 'df_app_06',
    appMode: '多智能体',
    inWarehouse: true,
    models: ['deepseek / deepseek-chat · 1,840入 / 520出'],
    knowledgeBases: ['电子证据库（ds_evid_08）· 命中2段'],
    mcpCalls: ['线索查询服务 / get_clue · 2.4s'],
    pluginCalls: [],
  },
  '网络日志研判': {
    appId: 'df_app_07',
    appMode: '工作流编排',
    inWarehouse: true,
    models: ['qwen / qwen-max · 1,120入 / 360出'],
    knowledgeBases: [],
    mcpCalls: [],
    pluginCalls: ['document-parser / parse · 1.1s'],
  },
  '资金研判助手': {
    appId: 'df_app_08',
    appMode: '工作流编排',
    inWarehouse: true,
    models: ['openai / gpt-4.1 · 1,980入 / 460出'],
    knowledgeBases: ['金融监管库（ds_fin_05）· 命中2段'],
    mcpCalls: ['企业查询服务 / query_company · 1.2s'],
    pluginCalls: [],
  },
  '企业风险查询': {
    appId: 'df_app_09',
    appMode: '单智能体',
    inWarehouse: true,
    models: ['qwen / qwen-plus · 920入 / 310出'],
    knowledgeBases: [],
    mcpCalls: ['企业查询服务 / shareholding_ratio · 1.6s'],
    pluginCalls: [],
  },
  '资金研判实验版': {
    appId: 'df_app_10',
    appMode: '工作流编排',
    inWarehouse: false,
    models: ['qwen / qwen-max · 1,340入 / 280出'],
    knowledgeBases: [],
    mcpCalls: [],
    pluginCalls: [],
  },
  '勤务问答助手': {
    appId: 'df_app_11',
    appMode: '单智能体',
    inWarehouse: true,
    models: ['openai / gpt-4.1-mini · 740入 / 290出'],
    knowledgeBases: ['勤务规范库（ds_duty_02）· 命中2段'],
    mcpCalls: [],
    pluginCalls: [],
  },
  '个人笔记助手': {
    appId: 'df_app_12',
    appMode: '单智能体',
    inWarehouse: false,
    models: ['qwen / qwen-plus · 480入 / 190出'],
    knowledgeBases: [],
    mcpCalls: [],
    pluginCalls: [],
  },
  '案件串并助手': {
    appId: 'df_app_13',
    appMode: '工作流编排',
    inWarehouse: true,
    models: ['openai / gpt-4.1 · 2,120入 / 590出'],
    knowledgeBases: ['典型案例库（ds_case_09）· 命中3段'],
    mcpCalls: ['档案检索服务 / search_archive · 1.4s'],
    pluginCalls: [],
  },
  '执法文书校验': {
    appId: 'df_app_14',
    appMode: '单智能体',
    inWarehouse: true,
    models: ['deepseek / deepseek-chat · 1,450入 / 430出'],
    knowledgeBases: ['文书范例库（ds_doc_06）· 命中2段'],
    mcpCalls: [],
    pluginCalls: ['document-parser / parse · 0.8s'],
  },
  '旧版文书助手': {
    appId: 'df_app_15',
    appMode: '单智能体',
    inWarehouse: true,
    models: ['qwen / qwen-max · 890入 / 310出'],
    knowledgeBases: [],
    mcpCalls: [],
    pluginCalls: [],
  },
  '运营巡查助手': {
    appId: 'df_app_16',
    appMode: '工作流编排',
    inWarehouse: true,
    models: ['openai / gpt-4.1-mini · 1,100入 / 340出'],
    knowledgeBases: ['平台运维规范库（ds_ops_01）· 命中1段'],
    mcpCalls: ['通用文书工具集 / inspect_node · 0.6s'],
    pluginCalls: ['browser-agent / execute · 1.5s'],
  },
  '运维诊断脚本': {
    appId: 'df_app_17',
    appMode: '单智能体',
    inWarehouse: false,
    models: ['qwen / qwen-plus · 450入 / 180出'],
    knowledgeBases: [],
    mcpCalls: [],
    pluginCalls: [],
  },
}

const CALLER_BY_IP = {
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
  '10.24.50.15': '广场用户 zhou.min · 平台运营组',
}

const INVOCATION_DRAFTS = [
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
  { account: 'zhou.min', appName: '运营巡查助手', ip: '10.24.50.15', count: 4 },
  { account: 'zhou.min', appName: '运维诊断脚本', ip: '10.24.50.15', count: 2 },
]

function modelLabelOf(item) {
  const head = item.split('·')[0]
  return (head.includes('/') ? head.split('/').pop() : head)?.trim() || head.trim()
}

function knowledgeLabelOf(item) {
  return item.split('·')[0].replace(/（.*?）/, '').trim()
}

function mcpLabelOf(item) {
  const parts = item.split('·')[0].split('/').map(p => p.trim())
  return parts[1] || parts[0]
}

function pluginLabelOf(item) {
  const parts = item.split('·')[0].split('/').map(p => p.trim())
  return parts[1] || parts[0]
}

export async function agentMonitorReport({
  query,
  now = Date.now(),
  cap,
  headers,
  identity,
  applications: _applications = [],
}) {
  const admin = identity.roles.includes('admin')
  const ops = identity.roles.includes('operator')
  check(admin || ops, 403, 'ACCESS_DENIED')

  const filterOrg = query.get('org') || null
  if (!admin && filterOrg && filterOrg !== identity.org) {
    throw new (await import('../../../../runtime/http.mjs')).ApiError(403, 'ACCESS_DENIED', '无权查询其他组织的数据')
  }
  const effectiveOrg = admin ? filterOrg : (filterOrg || identity.org)

  const filterAccount = query.get('account') || '全部账户'
  const filterAppName = query.get('appName') || '全部应用'
  const filterIp = query.get('ip') || '全部 IP'
  const filterModel = query.get('model') || '全部模型'
  const filterKnowledge = query.get('knowledge') || '全部知识库'
  const filterMcp = query.get('mcp') || '全部 MCP'
  const filterPlugin = query.get('plugin') || '全部插件'
  const q = (query.get('q') || '').trim().toLowerCase()
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query.get('pageSize') || '20', 10) || 20))

  // 1. 能力侧 Dify 目录采集
  let difyCatalogSource = 'not_collected'
  if (cap) {
    try {
      const res = await cap('/catalog?kind=agent', 'GET', undefined, headers)
      if (res.ok) {
        difyCatalogSource = 'collected'
      }
    } catch {
      difyCatalogSource = 'not_collected'
    }
  }

  // 2. 根据组织范围过滤开发者账户
  const visibleAccounts = DIFY_ACCOUNTS.filter(acc => !effectiveOrg || acc.org === effectiveOrg)

  // 3. 构建全量调用日志
  let seqCounter = 1
  const allLogs = []
  const useCountByApp = new Map()

  for (const draft of INVOCATION_DRAFTS) {
    const owner = DIFY_ACCOUNTS.find(a => a.account === draft.account)
    if (!owner) continue
    if (effectiveOrg && owner.org !== effectiveOrg) continue

    const profile = APP_PROFILES[draft.appName] || {
      appId: 'df_app_unknown',
      appMode: '单智能体',
      inWarehouse: false,
      models: ['qwen / qwen-max · 500入 / 200出'],
      knowledgeBases: [],
      mcpCalls: [],
      pluginCalls: [],
    }

    useCountByApp.set(draft.appName, (useCountByApp.get(draft.appName) || 0) + draft.count)

    for (let offset = 0; offset < draft.count; offset++) {
      const stamp = `${draft.appName}-${draft.ip}-${offset}`
      const slot = stamp.length + offset
      const failed = slot % 9 === 8
      const models = slot % 3 === 0 ? profile.models : profile.models.slice(0, 1)
      const knowledgeBases = profile.knowledgeBases.slice(0, slot % 2 === 0 ? profile.knowledgeBases.length : 1)
      const mcpCalls = slot % 4 === 0 ? [] : profile.mcpCalls
      const pluginCalls = slot % 5 === 0 ? [] : profile.pluginCalls

      const tMs = now - (seqCounter * 120000)
      const d = new Date(tMs)
      const timeStr = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`

      allLogs.push({
        seq: seqCounter++,
        time: timeStr,
        ownerAccount: draft.account,
        ownerName: owner.name,
        ownerOrg: owner.org,
        appName: draft.appName,
        appId: profile.appId,
        appMode: profile.appMode,
        sourceIp: draft.ip,
        caller: CALLER_BY_IP[draft.ip] || draft.ip,
        models,
        modelLabels: models.map(modelLabelOf),
        knowledgeBases,
        knowledgeLabels: knowledgeBases.map(knowledgeLabelOf),
        mcpCalls,
        mcpLabels: mcpCalls.map(mcpLabelOf),
        pluginCalls,
        pluginLabels: pluginCalls.map(pluginLabelOf),
        duration: failed ? '8.4s' : `${(1.1 + (slot % 15) * 0.2).toFixed(1)}s`,
        httpStatus: failed ? '504 Gateway Timeout' : '200 OK',
        result: failed ? '失败' : '成功',
        errorCode: failed ? 'SERVICE_TIMEOUT' : '—',
      })
    }
  }

  // 4. 构建账户 / 应用树 (accountGroups)
  // 建立账户到应用的关联
  const accountGroups = visibleAccounts.map(owner => {
    // 收集该账户名下在 APP_PROFILES 中出现的应用
    const ownerApps = []
    for (const draft of INVOCATION_DRAFTS) {
      if (draft.account === owner.account && !ownerApps.some(a => a.name === draft.appName)) {
        const prof = APP_PROFILES[draft.appName] || { appId: 'df_custom', appMode: '单智能体', inWarehouse: false }
        ownerApps.push({
          name: draft.appName,
          appId: prof.appId,
          appMode: prof.appMode,
          inWarehouse: prof.inWarehouse,
          useCount: useCountByApp.get(draft.appName) || 0,
        })
      }
    }
    ownerApps.sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name, 'zh-CN'))
    const groupUseCount = ownerApps.reduce((sum, app) => sum + app.useCount, 0)
    return {
      account: owner.account,
      name: owner.name,
      org: owner.org,
      useCount: groupUseCount,
      apps: ownerApps,
    }
  })

  // 指标卡计算
  const totalAppsList = accountGroups.flatMap(g => g.apps)
  const accountCount = visibleAccounts.length
  const totalAppCount = totalAppsList.length
  const outsideAppCount = totalAppsList.filter(a => !a.inWarehouse).length
  const callCount = allLogs.length
  const failedCallCount = allLogs.filter(l => l.result === '失败').length

  // 5. 选项集提取
  const ipOptions = Array.from(new Set(allLogs.map(l => l.sourceIp))).sort()
  const modelOptions = Array.from(new Set(allLogs.flatMap(l => l.modelLabels))).sort()
  const knowledgeOptions = Array.from(new Set(allLogs.flatMap(l => l.knowledgeLabels))).sort()
  const mcpOptions = Array.from(new Set(allLogs.flatMap(l => l.mcpLabels))).sort()
  const pluginOptions = Array.from(new Set(allLogs.flatMap(l => l.pluginLabels))).sort()

  // 6. 过滤日志
  const filteredLogs = allLogs.filter(log => {
    if (filterAccount !== '全部账户' && log.ownerAccount !== filterAccount) return false
    if (filterAppName !== '全部应用' && log.appName !== filterAppName) return false
    if (filterIp !== '全部 IP' && log.sourceIp !== filterIp) return false
    if (filterModel !== '全部模型' && !log.modelLabels.includes(filterModel)) return false
    if (filterKnowledge !== '全部知识库' && !log.knowledgeLabels.includes(filterKnowledge)) return false
    if (filterMcp !== '全部 MCP' && !log.mcpLabels.includes(filterMcp)) return false
    if (filterPlugin !== '全部插件' && !log.pluginLabels.includes(filterPlugin)) return false
    if (q) {
      const blob = [
        log.ownerName,
        log.ownerAccount,
        log.appName,
        log.sourceIp,
        log.caller,
        ...log.modelLabels,
        ...log.knowledgeLabels,
        ...log.mcpLabels,
        ...log.pluginLabels,
      ].join(' ').toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })

  // 7. 分页
  const start = (page - 1) * pageSize
  const pagedLogs = filteredLogs.slice(start, start + pageSize)

  return {
    asOf: new Date(now).toISOString(),
    window: query.get('window') || '24h',
    metrics: {
      accountCount,
      totalAppCount,
      outsideAppCount,
      callCount,
      failedCallCount,
    },
    sources: {
      difyCatalog: difyCatalogSource,
      invocations: 'collected',
    },
    accountGroups,
    filterOptions: {
      ipOptions,
      modelOptions,
      knowledgeOptions,
      mcpOptions,
      pluginOptions,
    },
    logs: {
      total: filteredLogs.length,
      page,
      pageSize,
      items: pagedLogs,
    },
  }
}
