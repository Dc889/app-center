import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig, difyConsoleFetch} from '../../../platform/dify/public.mjs'
export async function syncDifyApp(command) {
  const { isReal } = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

  const appId = command.resourceId
  const response = await difyConsoleFetch(`/console/api/apps/${encodeURIComponent(appId)}`)

  if (!response.ok) {
    throw Error(`Dify 同步应用失败: HTTP ${response.status}`)
  }

  const app = await response.json()
  return {
    appId: app.id,
    name: app.name,
    mode: app.mode,
    status: '已纳管',
  }
}

/**
 * AG-02 / AG-04: 发布或再发布应用
 */
