import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'


export async function fetchAllModels({workspaceId = null} = {}) {
  const {base, token, isReal} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置已核验的 Dify 模型来源')

  const response = await fetch(`${base}/console/api/workspaces/current/models/model-types/llm`, {
    headers: {Authorization: `Bearer ${token}`},
    signal: AbortSignal.timeout(15000),
  })
  check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 模型列表读取失败: HTTP ${response.status}`)
  const payload = await response.json()
  check(Array.isArray(payload?.data), 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 模型列表响应格式错误')
  const providers = payload.data
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
