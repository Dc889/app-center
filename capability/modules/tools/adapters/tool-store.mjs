import {check, digest} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'


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

function pickText(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    const candidate = value.zh_Hans ?? value.zh_CN ?? value.en_US ?? Object.values(value).find(v => typeof v === 'string' && v.trim())
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return fallback
}

export async function listWorkspaceTools({workspaceId, openLedger}) {
  const {base, token, isReal} = getDifyConfig()
  const map = new Map()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 工具来源')
  {
    const response = await fetch(`${base}/console/api/workspaces/current/tools/api`, {
      headers: {Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(15000),
    })
    check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 工具列表读取失败: HTTP ${response.status}`)
    const rows = await response.json()
    const providers = Array.isArray(rows) ? rows : rows?.data
    check(Array.isArray(providers), 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 工具列表响应格式错误')
    for (const provider of providers) {
      for (const t of provider.tools ?? []) {
        const toolId = t.id || t.name
        if (!toolId) continue
        const schema =
          t.parameters_schema && typeof t.parameters_schema === 'object' && !Array.isArray(t.parameters_schema)
            ? t.parameters_schema
            : {
                type: 'object',
                properties: Object.fromEntries(
                  (Array.isArray(t.parameters) ? t.parameters : []).map(p => [
                    p.name,
                    {type: p.type || 'string', description: pickText(p.human_description ?? p.label, p.name)},
                  ]),
                ),
              }
        const tool = {
          toolId,
          providerId: String(provider.id || provider.name || 'dify-api'),
          name: pickText(t.label, toolId),
          providerName: pickText(provider.label, provider.name || 'Dify API'),
          version: typeof t.version === 'string' && t.version.trim() ? t.version.trim() : '1.0.0',
          inputSchema: schema,
          outputDescription: pickText(t.description, '工具调用输出'),
          workspaceId,
        }
        map.set(toolId, {...tool, fingerprint: computeToolFingerprint(tool)})
      }
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
