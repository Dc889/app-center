import {createHash} from 'node:crypto'
import {mkdirSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {strToU8, zipSync} from 'fflate'
import mysql from 'mysql2/promise'

const sha256 = buf => createHash('sha256').update(buf).digest('hex')
const localDataDir = resolve(process.env.APP_DATA_DIR ?? '.local-data')
const skillObjDir = join(localDataDir, 'skill-objects')
const pluginObjDir = join(localDataDir, 'plugin-objects')
mkdirSync(skillObjDir, {recursive: true})
mkdirSync(pluginObjDir, {recursive: true})

function copyToDocker(container, localFile, remotePath) {
  try {
    execFileSync('docker', ['cp', localFile, `${container}:${remotePath}`], {stdio: 'pipe'})
  } catch {
    // Container might not be running in some environments
  }
}

const conn = await mysql.createConnection(
  process.env.MYSQL_REPO_URL || 'mysql://ac_repo:ac_repo_change_me@127.0.0.1:13306/app_center_repo',
)

async function upsertLedger(ledgerName, recordId, doc) {
  await conn.execute(
    `INSERT INTO ledger_records (ledger_name, record_id, body)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE body = VALUES(body)`,
    [ledgerName, recordId, JSON.stringify(doc)],
  )
}

// 1. Seed 3 real downloadable Skill packages (.zip with SKILL.md + templates)
const skills = [
  {
    resourceId: 'skill-case-report',
    name: '案情研判报告生成 Skill',
    version: '1.2.0',
    description: '标准案情要素抽取、时间线梳理与研判报告结构化生成技能包，内置模板与核查清单。',
    orgs: ['业务一部', '平台运营组', '系统管理组'],
    ownerAccount: 'zhou.min',
    files: {
      'SKILL.md': '# 案情研判报告生成 Skill\n\n## 适用场景\n- 依据笔录与线索材料抽取时间、人物、地点与关键事实。\n- 输出标准研判报告结构与待核查事项。\n',
      'templates/report.md': '# 案情研判报告\n\n## 一、基本情况\n## 二、关键时间线\n## 三、风险与核查建议\n',
    },
  },
  {
    resourceId: 'skill-doc-summary',
    name: '公文要点提炼与合规校对 Skill',
    version: '1.0.3',
    description: '面向内部通知、纪要与制度文件的结构化摘要与格式合规校对技能包。',
    orgs: ['业务一部', '平台运营组', '系统管理组'],
    ownerAccount: 'zhou.min',
    files: {
      'SKILL.md': '# 公文要点提炼与合规校对 Skill\n\n## 能力说明\n- 自动提炼主旨、责任部门与截止时间。\n- 检查敏感词、文号格式与引用一致性。\n',
      'rules/checklist.md': '- 核对标题与主送机关\n- 核对落款日期与附件清单\n',
    },
  },
  {
    resourceId: 'skill-sql-audit',
    name: '只读数据巡检与异常排查 Skill',
    version: '1.1.0',
    description: '面向运营与系统管理员的只读数据库健康巡检、慢查询归因与台账一致性核对技能包。',
    orgs: ['业务一部', '平台运营组', '系统管理组'],
    ownerAccount: 'li.qiang',
    files: {
      'SKILL.md': '# 只读数据巡检与异常排查 Skill\n\n## 安全红线\n- 仅允许 SELECT / EXPLAIN / SHOW STATUS 只读语句。\n- 严禁执行写操作与全表无条件扫描。\n',
      'queries/health.sql': 'SHOW GLOBAL STATUS LIKE \'Threads_connected\';\n',
    },
  },
]

for (const s of skills) {
  const zipBytes = Buffer.from(
    zipSync(Object.fromEntries(Object.entries(s.files).map(([k, v]) => [k, strToU8(v)]))),
  )
  const hash = sha256(zipBytes)
  const blobName = `${s.resourceId}_${s.version}_${hash.slice(0, 12)}.bin`
  const localPath = join(skillObjDir, blobName)
  writeFileSync(localPath, zipBytes)
  copyToDocker('app-center-repo-skill', localPath, `/data/skill-objects/${blobName}`)

  const filename = `${s.resourceId}-${s.version}.zip`
  const versionEntry = {
    version: s.version,
    sha256: hash,
    sizeBytes: zipBytes.length,
    filename,
    contentType: 'application/zip',
    blobName,
    status: 'available',
    publishedAt: new Date().toISOString(),
  }
  await upsertLedger('skill-catalog', s.resourceId, {
    resourceId: s.resourceId,
    name: s.name,
    description: s.description,
    version: s.version,
    sha256: hash,
    sizeBytes: zipBytes.length,
    filename,
    contentType: 'application/zip',
    orgs: s.orgs,
    ownerAccount: s.ownerAccount,
    status: 'available',
    revision: 1,
    versions: [versionEntry],
  })
  console.log('Seeded Skill:', s.resourceId, filename, `${zipBytes.length}B`)
}

// 2. Seed 3 real Dify plugin packages (.difypkg)
const plugins = [
  {
    resourceId: 'plugin-openai-compat',
    uniqueIdentifier: 'langgenius/openai_api_compatible:0.0.18',
    name: 'OpenAI 兼容模型接入插件',
    version: '0.0.18',
    description: '对接内网 OpenAI 协议兼容大模型推理网关（vLLM / Ollama / OneAPI），支持对话与向量模型。',
    installAccess: 'instant',
    ownerAccount: 'zhou.min',
  },
  {
    resourceId: 'plugin-tavily-search',
    uniqueIdentifier: 'langgenius/tavily:0.0.5',
    name: 'Tavily 智能检索插件',
    version: '0.0.5',
    description: '为智能体工作流提供结构化网页/内网搜索引擎检索与摘要提取工具。',
    installAccess: 'approval',
    ownerAccount: 'zhou.min',
  },
  {
    resourceId: 'plugin-echarts-render',
    uniqueIdentifier: 'kpw/echarts_renderer:1.0.0',
    name: 'ECharts 数据图表渲染插件',
    version: '1.0.0',
    description: '将分析结果自动渲染为柱状图、折线图、饼图等可视化图表供智能体直接返回。',
    installAccess: 'instant',
    ownerAccount: 'li.qiang',
  },
]

for (const p of plugins) {
  const manifest = `version: ${p.version}\ntype: plugin\nauthor: ${p.uniqueIdentifier.split('/')[0]}\nname: ${p.resourceId}\ndescription:\n  zh_Hans: ${p.description}\n`
  const pkgBytes = Buffer.from(zipSync({'manifest.yaml': strToU8(manifest)}))
  const hash = sha256(pkgBytes)
  const blobName = `${p.resourceId}_${p.version}_${hash.slice(0, 12)}.bin`
  const localPath = join(pluginObjDir, blobName)
  writeFileSync(localPath, pkgBytes)
  copyToDocker('app-center-repo-plugin', localPath, `/data/plugin-objects/${blobName}`)

  const ver = {
    version: p.version,
    sha256: hash,
    sizeBytes: pkgBytes.length,
    blobName,
    status: 'approved',
    publishedAt: new Date().toISOString(),
  }
  await upsertLedger('plugin-catalog', p.resourceId, {
    resourceId: p.resourceId,
    uniqueIdentifier: p.uniqueIdentifier,
    name: p.name,
    description: p.description,
    status: 'approved',
    revision: 1,
    version: p.version,
    sha256: hash,
    sizeBytes: pkgBytes.length,
    upgradePolicy: '逐个工单升级',
    installAccess: p.installAccess,
    ownerAccount: p.ownerAccount,
    versions: [ver],
  })
  console.log('Seeded Plugin:', p.resourceId, p.uniqueIdentifier, `${pkgBytes.length}B`)
}

// 3. Seed 2 real MCP servers backed by dev/local-mcp-server.mjs (127.0.0.1:4390)
const mcps = [
  {
    resourceId: 'mcp-internal-clock',
    name: '内网标准时间与工作日历 MCP',
    description: '提供内网标准时间查询、法定工作日判定与 ISO 时间窗口计算工具（运行于本地 MCP 服务 4390）。',
    endpointUrl: 'http://127.0.0.1:4390/mcp/time',
    transport: 'streamable_http',
    toolNames: ['get_current_time', 'check_workday', 'format_iso_range'],
    bindingAccess: 'instant',
    ownerAccount: 'zhou.min',
  },
  {
    resourceId: 'mcp-platform-docs',
    name: '平台规范与工单知识检索 MCP',
    description: '提供平台治理规范检索、工单类型目录查询与子系统排障手册工具（运行于本地 MCP 服务 4390）。',
    endpointUrl: 'http://127.0.0.1:4390/mcp/docs',
    transport: 'streamable_http',
    toolNames: ['search_docs', 'list_ticket_types', 'get_runbook'],
    bindingAccess: 'approval',
    ownerAccount: 'li.qiang',
  },
]

for (const m of mcps) {
  await upsertLedger('mcps', m.resourceId, {
    resourceId: m.resourceId,
    name: m.name,
    description: m.description,
    status: 'active',
    revision: 1,
    transport: m.transport,
    toolNames: m.toolNames,
    urlFingerprint: sha256(Buffer.from(m.endpointUrl)),
    registrationId: `reg-${m.resourceId}`,
    bindingAccess: m.bindingAccess,
    provider: m.resourceId,
    ownerAccount: m.ownerAccount,
    createdAt: new Date().toISOString(),
  })
  console.log('Seeded MCP:', m.resourceId, m.endpointUrl, `tools=${m.toolNames.length}`)
}

await conn.end()
console.log('All real warehouse records seeded into MySQL app_center_repo.')
