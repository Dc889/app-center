import {createServer} from 'node:http'

const PORT = Number(process.env.LOCAL_MCP_PORT || 4390)

const SERVERS = {
  '/mcp/time': {
    name: 'mcp-internal-clock',
    version: '1.0.0',
    tools: [
      {
        name: 'get_current_time',
        description: '返回当前内网标准时间（Asia/Shanghai 与 UTC ISO 时间）',
        inputSchema: {type: 'object', properties: {}},
      },
      {
        name: 'check_workday',
        description: '判断指定日期（YYYY-MM-DD）是否为工作日',
        inputSchema: {type: 'object', properties: {date: {type: 'string'}}, required: ['date']},
      },
      {
        name: 'format_iso_range',
        description: '生成近 N 小时的 ISO 时间窗口',
        inputSchema: {type: 'object', properties: {hours: {type: 'number'}}},
      },
    ],
    call(name, args = {}) {
      const now = new Date()
      if (name === 'get_current_time') {
        return {utc: now.toISOString(), shanghai: now.toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}
      }
      if (name === 'check_workday') {
        const d = new Date(`${args.date}T00:00:00+08:00`)
        const day = d.getDay()
        return {date: args.date, isWorkday: day >= 1 && day <= 5, weekday: ['日', '一', '二', '三', '四', '五', '六'][day]}
      }
      const hours = Number(args.hours || 24)
      return {start: new Date(now.getTime() - hours * 3600000).toISOString(), end: now.toISOString(), hours}
    },
  },
  '/mcp/docs': {
    name: 'mcp-platform-docs',
    version: '1.0.0',
    tools: [
      {
        name: 'search_docs',
        description: '按关键字检索 AI 运营管理平台内部治理规范与架构文档',
        inputSchema: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']},
      },
      {
        name: 'list_ticket_types',
        description: '列出平台支持的核心工单类型（APP / KB / PLG / MCP / SKL / ACC）',
        inputSchema: {type: 'object', properties: {}},
      },
      {
        name: 'get_runbook',
        description: '获取指定子系统（dify / ragflow / mysql）的运维排障手册摘要',
        inputSchema: {type: 'object', properties: {service: {type: 'string'}}, required: ['service']},
      },
    ],
    call(name, args = {}) {
      if (name === 'list_ticket_types') {
        return {types: ['APP-01', 'APP-02', 'KB-01', 'KB-02', 'PLG-01', 'PLG-03', 'MCP-01', 'MCP-02', 'SKL-01', 'SKL-03', 'ACC-01', 'ACC-02']}
      }
      if (name === 'get_runbook') {
        return {service: args.service, checklist: ['检查容器 /healthz', '检查 MySQL 连接池', '查看 connector 日志']}
      }
      return {query: args.query ?? '', hits: ['docs/ARCHITECTURE.md', 'docs/app-center-design.md', 'docker/README.md']}
    },
  },
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, {'content-type': 'application/json'})
    return res.end(JSON.stringify({ok: true, endpoints: Object.keys(SERVERS)}))
  }
  const spec = SERVERS[url.pathname]
  if (!spec) {
    res.writeHead(404, {'content-type': 'application/json'})
    return res.end(JSON.stringify({error: 'NOT_FOUND'}))
  }
  if (req.method === 'GET') {
    res.writeHead(200, {'content-type': 'application/json'})
    return res.end(JSON.stringify({name: spec.name, version: spec.version, transport: 'streamable_http', tools: spec.tools.map(t => t.name)}))
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  let rpc = {}
  try { rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* ignore */ }
  const id = rpc.id ?? null
  let result
  if (rpc.method === 'initialize') {
    result = {protocolVersion: '2025-03-26', serverInfo: {name: spec.name, version: spec.version}, capabilities: {tools: {}}}
  } else if (rpc.method === 'tools/list') {
    result = {tools: spec.tools}
  } else if (rpc.method === 'tools/call') {
    const data = spec.call(rpc.params?.name, rpc.params?.arguments)
    result = {content: [{type: 'text', text: JSON.stringify(data)}]}
  } else {
    result = {ok: true}
  }
  res.writeHead(200, {'content-type': 'application/json'})
  res.end(JSON.stringify({jsonrpc: '2.0', id, result}))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Local MCP server ready on http://0.0.0.0:${PORT} (${Object.keys(SERVERS).join(', ')})`)
})
