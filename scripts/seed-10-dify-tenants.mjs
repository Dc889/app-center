import {zipSync, strToU8} from 'fflate'
import {stringify} from 'yaml'

const DIFY_BASE = process.env.DIFY_BASE || 'http://localhost:8080'
const PASSWORD = process.env.TENANT_PASSWORD || 'Kpw@2026!'
const MCP_BASE = process.env.MCP_BASE || 'http://host.docker.internal:4390'

const TENANTS = [
  {email: 'tenant01@kpw.com', user: '张伟', dept: '刑侦一支队', prefix: '刑侦'},
  {email: 'tenant02@kpw.com', user: '王芳', dept: '经侦支队', prefix: '经侦'},
  {email: 'tenant03@kpw.com', user: '刘洋', dept: '网安支队', prefix: '网安'},
  {email: 'tenant04@kpw.com', user: '赵敏', dept: '治安支队', prefix: '治安'},
  {email: 'tenant05@kpw.com', user: '孙强', dept: '交警支队', prefix: '交管'},
  {email: 'tenant06@kpw.com', user: '周磊', dept: '指挥中心', prefix: '指挥'},
  {email: 'tenant07@kpw.com', user: '吴静', dept: '综合法制', prefix: '法制'},
  {email: 'tenant08@kpw.com', user: '郑涛', dept: '科信研发', prefix: '科信'},
  {email: 'tenant09@kpw.com', user: '冯雪', dept: '反诈中心', prefix: '反诈'},
  {email: 'tenant10@kpw.com', user: '褚明', dept: '督察审计', prefix: '督察'}
]

const APP_TEMPLATES = [
  {suffix: '警情智能研判助手', mode: 'chat', icon: '🔍', bg: '#E0F2FE', desc: '辅助一线民警快速研判接处警要素与历史关联警情'},
  {suffix: '笔录要点自动摘录', mode: 'chat', icon: '📝', bg: '#DCFCE7', desc: '从长文本笔录中提炼时间线、涉案人员与核心事实'},
  {suffix: '法条依据速查问答', mode: 'chat', icon: '⚖️', bg: '#FEF3C7', desc: '针对常见办案场景提供现行法律法规条文对照问答'},
  {suffix: '案情卷宗多轮精析', mode: 'advanced-chat', icon: '📚', bg: '#EDE9FE', desc: '支持结合专有知识库开展多轮卷宗分析与证据链梳理'},
  {suffix: '研判报告对话生成', mode: 'advanced-chat', icon: '📊', bg: '#FCE7F3', desc: '通过交互式问答逐步生成规范化研判分析报告'},
  {suffix: '专班线索核查对话', mode: 'advanced-chat', icon: '🕵️', bg: '#E0E7FF', desc: '面向专案组提供线索核查与多维关联问答'},
  {suffix: '线索清洗归集编排', mode: 'workflow', icon: '⚙️', bg: '#FFEDD5', desc: '自动化完成非结构化线索抽取、去重、标签化与入库'},
  {suffix: '周报数据汇总流', mode: 'workflow', icon: '📈', bg: '#CCFBF1', desc: '按固定模板汇总业务台账指标并输出结构化周报'},
  {suffix: '跨库联动研判智能体', mode: 'agent-chat', icon: '🤖', bg: '#F3E8FF', desc: '自主调用工具与知识库完成复杂案件综合研判'},
  {suffix: '风险预警处置智能体', mode: 'agent-chat', icon: '🛡️', bg: '#FEE2E2', desc: '结合实时规则与工具调用输出风险等级与处置建议'}
]

const KB_TEMPLATES = [
  {suffix: '业务规范与制度知识库', desc: '沉淀本部门标准办案规范、操作指引与内控合规制度'},
  {suffix: '典型案例与战法知识库', desc: '收录近三年典型实战案例、复盘总结与可复用研判战法'}
]

const PLUGINS = [
  {
    slug: 'case_extractor',
    name: '案件要素抽取插件',
    version: '1.0.0',
    desc: '从警情文本中提取时间、地点、涉案主体与关键行为要素'
  },
  {
    slug: 'law_checker',
    name: '法规条文核验插件',
    version: '1.0.0',
    desc: '快速比对办案文书引用的法律法规名称与条文序号'
  },
  {
    slug: 'report_formatter',
    name: '规范公文排版插件',
    version: '1.0.0',
    desc: '将研判分析内容转换为符合内网标准的公文与摘要格式'
  }
]

const MCP_SERVERS = [
  {
    server_identifier: 'kpw_local_time_mcp',
    name: '内网标准时间MCP',
    server_url: `${MCP_BASE}/mcp/time`,
    icon: '⏱️',
    icon_background: '#E0F2FE'
  },
  {
    server_identifier: 'kpw_local_docs_mcp',
    name: '平台规范文档MCP',
    server_url: `${MCP_BASE}/mcp/docs`,
    icon: '📖',
    icon_background: '#EDE9FE'
  }
]

function buildPluginPackage({slug, name, version, desc}) {
  const manifest = {
    type: 'plugin',
    author: 'kpw',
    name: slug,
    version,
    label: {en_US: name, zh_Hans: name},
    description: {en_US: desc, zh_Hans: desc},
    icon: 'icon.svg',
    created_at: '2026-01-01T00:00:00Z',
    resource: {memory: 268435456},
    plugins: {tools: [`provider/${slug}.yaml`]},
    meta: {
      version: '0.0.1',
      arch: ['amd64', 'arm64'],
      runner: {language: 'python', version: '3.12', entrypoint: 'main'}
    }
  }
  const providerYaml = {
    identity: {
      author: 'kpw',
      name: slug,
      label: {en_US: name, zh_Hans: name},
      description: {en_US: desc, zh_Hans: desc},
      icon: 'icon.svg'
    },
    tools: [`tools/${slug}.yaml`],
    extra: {python: {source: `provider/${slug}.py`}}
  }
  const toolYaml = {
    identity: {
      name: `${slug}_run`,
      author: 'kpw',
      label: {en_US: name, zh_Hans: name}
    },
    description: {
      human: {en_US: desc, zh_Hans: desc},
      llm: desc
    },
    parameters: [
      {
        name: 'text',
        type: 'string',
        required: true,
        label: {en_US: '输入文本', zh_Hans: '输入文本'},
        human_description: {en_US: '待处理的文本内容', zh_Hans: '待处理的文本内容'},
        llm_description: 'Input text to process',
        form: 'llm'
      }
    ],
    extra: {python: {source: `tools/${slug}.py`}}
  }
  return Buffer.from(zipSync({
    'manifest.yaml': strToU8(stringify(manifest)),
    '_assets/icon.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#2563EB"/></svg>'),
    [`provider/${slug}.yaml`]: strToU8(stringify(providerYaml)),
    [`provider/${slug}.py`]: strToU8('# Local KPW plugin provider stub\n'),
    [`tools/${slug}.yaml`]: strToU8(stringify(toolYaml)),
    [`tools/${slug}.py`]: strToU8('# Local KPW plugin tool stub\n'),
    'main.py': strToU8('# Local KPW plugin entrypoint\n'),
    'requirements.txt': strToU8('')
  }))
}

async function api(token, path, options = {}) {
  const headers = {...(options.headers || {})}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${DIFY_BASE}${path}`, {...options, headers})
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = {raw: text}
  }
  return {ok: res.ok, status: res.status, data: json}
}

async function login(email) {
  const r = await api(null, '/console/api/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email, password: PASSWORD})
  })
  if (!r.ok || !r.data?.data?.access_token) {
    throw new Error(`Login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`)
  }
  return r.data.data.access_token
}

async function provisionTenant(tenant, pluginBuffers) {
  const token = await login(tenant.email)
  const summary = {
    email: tenant.email,
    user: tenant.user,
    dept: tenant.dept,
    appsCreated: 0,
    appsTotal: 0,
    kbsCreated: 0,
    kbsTotal: 0,
    pluginsInstalled: 0,
    pluginsTotal: 0,
    mcpCreated: 0,
    mcpTotal: 0,
    errors: []
  }

  // 1. Apps (10 per tenant)
  const existingAppsRes = await api(token, '/console/api/apps?page=1&limit=100')
  const existingAppNames = new Set((existingAppsRes.data?.data || []).map(a => a.name))
  for (const tpl of APP_TEMPLATES) {
    const name = `${tenant.prefix}-${tpl.suffix}`
    if (existingAppNames.has(name)) continue
    const r = await api(token, '/console/api/apps', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        name,
        mode: tpl.mode,
        icon_type: 'emoji',
        icon: tpl.icon,
        icon_background: tpl.bg,
        description: `${tenant.dept}${tpl.desc}`
      })
    })
    if (r.ok) {
      summary.appsCreated++
    } else {
      summary.errors.push(`app(${name}): ${r.status}`)
    }
  }
  const finalAppsRes = await api(token, '/console/api/apps?page=1&limit=100')
  summary.appsTotal = finalAppsRes.data?.total ?? (finalAppsRes.data?.data?.length || 0)

  // 2. Knowledge Bases (2 per tenant)
  const existingKbRes = await api(token, '/console/api/datasets?page=1&limit=50')
  const existingKbNames = new Set((existingKbRes.data?.data || []).map(k => k.name))
  for (const tpl of KB_TEMPLATES) {
    const name = `${tenant.dept}${tpl.suffix}`
    if (existingKbNames.has(name)) continue
    const r = await api(token, '/console/api/datasets', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        name,
        description: tpl.desc,
        permission: 'only_me'
      })
    })
    if (r.ok) {
      summary.kbsCreated++
    } else {
      summary.errors.push(`kb(${name}): ${r.status}`)
    }
  }
  const finalKbRes = await api(token, '/console/api/datasets?page=1&limit=50')
  summary.kbsTotal = finalKbRes.data?.total ?? (finalKbRes.data?.data?.length || 0)

  // 3. Plugins (3 per tenant)
  const existingPlugRes = await api(token, '/console/api/workspaces/current/plugin/list?page=1&page_size=50')
  const existingPlugIds = new Set((existingPlugRes.data?.plugins || []).map(p => p.plugin_id))
  const toInstall = []
  for (const plug of PLUGINS) {
    if (existingPlugIds.has(`kpw/${plug.slug}`)) continue
    const form = new FormData()
    form.append('pkg', new Blob([pluginBuffers.get(plug.slug)], {type: 'application/octet-stream'}), `${plug.slug}.difypkg`)
    const up = await api(token, '/console/api/workspaces/current/plugin/upload/pkg', {
      method: 'POST',
      body: form
    })
    if (up.ok && up.data?.unique_identifier) {
      toInstall.push(up.data.unique_identifier)
    } else {
      summary.errors.push(`upload(${plug.slug}): ${up.status} ${JSON.stringify(up.data)}`)
    }
  }
  for (const uid of toInstall) {
    const inst = await api(token, '/console/api/workspaces/current/plugin/install/pkg', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({plugin_unique_identifiers: [uid]})
    })
    if (inst.ok) {
      summary.pluginsInstalled++
    } else {
      summary.errors.push(`install(${uid}): ${inst.status} ${JSON.stringify(inst.data)}`)
    }
  }

  // 4. Local MCP Providers (2 per tenant)
  const existingMcpRes = await api(token, '/console/api/workspaces/current/tools/mcp')
  const existingMcpList = Array.isArray(existingMcpRes.data) ? existingMcpRes.data : (existingMcpRes.data?.data || [])
  const existingMcpIds = new Set(existingMcpList.map(m => m.server_identifier || m.name))
  for (const mcp of MCP_SERVERS) {
    if (existingMcpIds.has(mcp.server_identifier) || existingMcpIds.has(mcp.name)) continue
    const r = await api(token, '/console/api/workspaces/current/tool-provider/mcp', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        server_url: mcp.server_url,
        name: mcp.name,
        icon: mcp.icon,
        icon_type: 'emoji',
        icon_background: mcp.icon_background,
        server_identifier: mcp.server_identifier
      })
    })
    if (r.ok) {
      summary.mcpCreated++
      const providerId = r.data?.id
      if (providerId) {
        await api(token, `/console/api/workspaces/current/tool-provider/mcp/update/${providerId}`, {method: 'GET'})
      }
    } else {
      summary.errors.push(`mcp(${mcp.server_identifier}): ${r.status} ${JSON.stringify(r.data)}`)
    }
  }
  const finalMcpRes = await api(token, '/console/api/workspaces/current/tools/mcp')
  const finalMcpList = Array.isArray(finalMcpRes.data) ? finalMcpRes.data : (finalMcpRes.data?.data || [])
  summary.mcpTotal = finalMcpList.length

  return {token, summary}
}

async function main() {
  const pluginBuffers = new Map()
  for (const plug of PLUGINS) {
    pluginBuffers.set(plug.slug, buildPluginPackage(plug))
  }

  const results = []
  for (const tenant of TENANTS) {
    console.log(`Provisioning ${tenant.email} (${tenant.dept} - ${tenant.user})...`)
    const res = await provisionTenant(tenant, pluginBuffers)
    results.push(res)
  }

  // Wait briefly for plugin_daemon async install tasks to settle, then query final plugin counts
  console.log('Waiting 8s for plugin_daemon installation tasks to finish...')
  await new Promise(resolve => setTimeout(resolve, 8000))

  const finalTable = []
  for (const {token, summary} of results) {
    const plugRes = await api(token, '/console/api/workspaces/current/plugin/list?page=1&page_size=50')
    const taskRes = await api(token, '/console/api/workspaces/current/plugin/tasks?page=1&page_size=20')
    summary.pluginsTotal = (plugRes.data?.plugins || []).length
    const pendingTasks = (taskRes.data?.tasks || []).filter(t => t.status !== 'success').map(t => `${t.status}:${t.message || ''}`)
    if (pendingTasks.length > 0) summary.errors.push(`tasks(${pendingTasks.join(',')})`)
    finalTable.push(summary)
  }

  console.log('\n=== PROVISIONING SUMMARY ===')
  console.log(JSON.stringify(finalTable, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
