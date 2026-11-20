export function recordNativeTaskFailure({row, store, stamp}, error) {
  if (error.code !== 'PLUGIN_INSTALL_FAILED') return false
  row.state.status = 'failed'
  row.state.updatedAt = stamp()
  row.state.result = {ok: false, failureCode: 'PLUGIN_INSTALL_FAILED', failureReason: '原生产品确认安装任务失败，请查证原任务与部署依赖',
    retryable: false, resultId: '', version: '', sha256: '',
    details: {upstreamTaskId: row.productTask?.upstreamTaskId ?? null, workspaceId: row.productTask?.workspaceId, nativeStatus: 'failed'}}
  store.put(row.command.executionId, row)
  return true
}
