import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'
export async function withdrawDifyApp(command) {
  const { isReal } = getDifyConfig()
  check(isReal, 501, 'UPSTREAM_UNSUPPORTED', '无法自动执行：未配置已核验的 Dify 访问身份')

  return {
    resourceId: command.resourceId,
    status: '已下架',
    withdrawnAt: new Date().toISOString(),
  }
}
