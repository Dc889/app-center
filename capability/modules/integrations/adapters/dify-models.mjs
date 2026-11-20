import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'

const LOCAL_DEV_MODELS = Object.freeze([
  {resourceId: 'qwen2.5-72b-instruct', name: '通义千问 2.5 72B Instruct', source: 'internal_cluster', workspaceId: null, modelType: 'llm', status: 'active'},
  {resourceId: 'deepseek-r1-distill', name: 'DeepSeek-R1 推理增强模型', source: 'internal_cluster', workspaceId: null, modelType: 'llm', status: 'active'},
])

export async function fetchAllModels({workspaceId = null} = {}) {
  const {base, token, isReal} = getDifyConfig()
  if (!isReal) {
    check(process.env.CAPABILITY_STRICT_UPSTREAM !== '1', 501, 'UPSTREAM_UNSUPPORTED', '未配置已核验的 Dify 模型来源')
    return LOCAL_DEV_MODELS.map(m => ({...m}))
  }

  const response = await fetch(`${base}/console/api/workspaces/current/models/model-types/llm`, {
    headers: {Authorization: `Bearer ${token}`},
    signal: AbortSignal.timeout(15000),
  })
  check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 模型列表读取失败: HTTP ${response.status}`)
  const payload = await response.json()
  const providers = Array.isArray(payload.data) ? payload.data : []
  const items = []
  for (const group of providers) {
    const provider = typeof group?.provider === 'string' ? group.provider : 'dify'
    for (const m of group?.models ?? []) {
      if (!m || typeof m.model !== 'string' || !m.model.trim()) continue
      if (m.status && m.status !== 'active') continue
      const label =
        typeof m.label === 'string'
          ? m.label
          : m.label?.zh_Hans || m.label?.en_US || m.model
      items.push({
        resourceId: `${provider}/${m.model}`,
        name: label,
        source: provider,
        workspaceId: workspaceId || null,
        modelType: m.model_type || 'llm',
        status: m.status || 'active',
      })
    }
  }
  return items
}
