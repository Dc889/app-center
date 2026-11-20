import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig, resolveProductOwner} from '../../../platform/dify/public.mjs'

export async function fetchDifyAppForKey(appId, workspaceId) {
  const {base, token, isReal} = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置已核验的 Dify 访问身份')

  const response = await fetch(`${base}/console/api/apps/${encodeURIComponent(appId)}`, {
    headers: {Authorization: `Bearer ${token}`},
    signal: AbortSignal.timeout(15000),
  })
  check(response.status !== 404, 404, 'NOT_FOUND', 'Dify 应用不存在')
  check(response.ok, 503, 'UPSTREAM_ERROR', `Dify 应用读取失败: HTTP ${response.status}`)

  const app = await response.json()
  check(app?.id === appId, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 应用标识不一致')
  return {
    appId: app.id,
    appName: app.name || appId,
    workspaceId: app.workspace_id || workspaceId,
    ownerAccount: resolveProductOwner([app.owner_account, app.created_by_account, app.created_by], {product: 'DIFY'}),
    apiBase: `${base}/v1`,
    publicationTicketNo: app.publication_ticket_no ?? null,
  }
}
