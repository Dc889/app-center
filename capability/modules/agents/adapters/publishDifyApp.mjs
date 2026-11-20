import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'
export async function publishDifyApp(command) {
  const { isReal } = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

  return {
    resourceId: command.resourceId,
    versionId: command.payload?.publicationVersionId || 'v1.0.0',
    scope: command.payload?.scope || 'internal',
    status: '已发布',
  }
}

/**
 * AG-05: 下架应用
 */
