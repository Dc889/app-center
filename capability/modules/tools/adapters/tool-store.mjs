import {check, digest} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'

const SEED_TOOLS = Object.freeze([
  {
    toolId: 'tool-web-search',
    providerId: 'builtin-search',
    name: '联网搜索工具',
    providerName: '内置搜索提供者',
    version: '1.0.0',
    inputSchema: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']},
    outputDescription: '返回搜索结果列表与摘要',
  },
  {
    toolId: 'tool-case-lookup',
    providerId: 'api-police-gw',
    name: '案情检索工具',
    providerName: '警务网关接口',
    version: '2.1.0',
    inputSchema: {type: 'object', properties: {caseNo: {type: 'string'}}, required: ['caseNo']},
    outputDescription: '返回标准化案情结构化 JSON',
  },
])

export function computeToolFingerprint(tool) {
  return digest(
    Buffer.from(
      JSON.stringify({
        toolId: tool.toolId,
        providerId: tool.providerId,
        version: tool.version,
        inputSchema: tool.inputSchema,
        outputDescription: tool.outputDescription,
      }),
    ),
  )
}

export async function listWorkspaceTools({workspaceId, openLedger}) {
  const {base, token, isReal} = getDifyConfig()
  const map = new Map()
  if (isReal) {
    const response = await fetch(`${base}/console/api/workspaces/current/tools/api`, {
      headers: {Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(15000),
    })
    check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 工具列表读取失败: HTTP ${response.status}`)
    const rows = await response.json()
    for (const provider of Array.isArray(rows) ? rows : rows.data ?? []) {
      for (const t of provider.tools ?? []) {
        const toolId = t.id || t.name
        if (!toolId) continue
        const tool = {
          toolId,
          providerId: provider.id || provider.name || 'dify-api',
          name: (typeof t.label === 'string' ? t.label : t.label?.zh_Hans || t.label?.en_US) || toolId,
          providerName: (typeof provider.label === 'string' ? provider.label : provider.label?.zh_Hans) || provider.name || 'Dify API',
          version: t.version || '1.0.0',
          inputSchema: t.parameters_schema || {type: 'object', properties: {}},
          outputDescription: t.description || '工具调用输出',
          workspaceId,
        }
        map.set(toolId, {...tool, fingerprint: computeToolFingerprint(tool)})
      }
    }
  } else {
    for (const seed of SEED_TOOLS) {
      map.set(seed.toolId, {...seed, workspaceId, fingerprint: computeToolFingerprint(seed)})
    }
  }
  if (openLedger) {
    for (const row of openLedger('tool-configs').all()) {
      if (!workspaceId || !row.workspaceId || row.workspaceId === workspaceId) {
        map.set(row.toolId, {...row, fingerprint: row.fingerprint || computeToolFingerprint(row)})
      }
    }
  }
  return [...map.values()]
}

export function diffToolConfigs(prev, current) {
  const diffs = []
  if (prev.version !== current.version) {
    diffs.push({差异项: '版本', 原值摘要: prev.version, 新值摘要: current.version})
  }
  if (prev.fingerprint !== current.fingerprint) {
    diffs.push({差异项: '配置指纹', 原值摘要: prev.fingerprint.slice(0, 12), 新值摘要: current.fingerprint.slice(0, 12)})
  }
  if (!diffs.length) {
    diffs.push({差异项: '配置复审', 原值摘要: prev.version, 新值摘要: current.version})
  }
  return diffs
}

export async function readToolApprovedInput(clients, command) {
  check(clients?.management, 503, 'REPOSITORY_UNCONFIGURED', '未配置管理端获准输入地址')
  const response = await clients.management('/approved-inputs/' + encodeURIComponent(command.executionId))
  const approved = await response.json()
  check(
    approved &&
      approved.decisionRef === command.payload?.decisionRef &&
      approved.ticketType === command.ticketType &&
      approved.action === command.action &&
      approved.resourceId === command.resourceId,
    409,
    'APPROVED_INPUT_MISMATCH',
    '获准输入与执行命令不一致',
  )
  return {
    fields: approved.fields ?? {},
    preconditions: Array.isArray(approved.preconditions) ? approved.preconditions : [],
  }
}
