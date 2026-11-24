import {check} from '../../../../runtime/http.mjs'
import {getRagflowConfig, ragflowFetch} from '../../../platform/ragflow/public.mjs'

export async function listRagflowAccounts() {
  check(getRagflowConfig().isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 账户连接')
  const response = await ragflowFetch('/api/v1/system/users')
  check(response.ok, 503, 'UPSTREAM_ERROR', `RAGFlow 账户列表读取失败: HTTP ${response.status}`)
  const body = await response.json()
  const rows = Array.isArray(body?.data) ? body.data : []
  check(rows.length === 0 || rows.every(row => row && (row.id || row.user_id || row.email)), 502, 'UPSTREAM_INVALID_RESPONSE', 'RAGFlow 账户列表格式不正确')
  return {
    items: rows.map(row => ({
      resourceId: String(row.id ?? row.user_id ?? row.email),
      account: row.email ?? row.nickname ?? String(row.id ?? ''),
      name: row.nickname ?? row.email ?? '',
    })),
    nextCursor: null,
  }
}
