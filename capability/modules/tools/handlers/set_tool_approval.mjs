import {check} from '../../../../runtime/http.mjs'
import {listWorkspaceTools, readToolApprovedInput} from '../adapters/tool-store.mjs'

export async function execute(context) {
  const {command, state, clients, openLedger} = context
  const approved = await readToolApprovedInput(clients, command)
  const fields = approved.fields
  const workspaceId = fields['Dify workspace ID'] || fields.workspaceId
  check(typeof workspaceId === 'string' && workspaceId.trim(), 409, 'INCOMPLETE_TOOL_CONTEXT')

  const cfgPre = approved.preconditions.find(p => p && p.kind === 'tool_configuration' && p.id === command.resourceId)
  const appPre = approved.preconditions.find(p => p && p.kind === 'tool_approval' && p.id === command.resourceId)
  check(cfgPre && /^[a-f0-9]{64}$/.test(cfgPre.sha256), 409, 'STALE_SNAPSHOT', '缺少工具配置指纹前置条件')
  check(appPre && Number.isInteger(appPre.revision), 409, 'STALE_SNAPSHOT', '缺少工具批准修订前置条件')

  const approvalsDb = openLedger('approvals')
  const key = `${workspaceId}:${command.resourceId}`
  const existing = approvalsDb.get(key)
  const currentRev = existing?.revision ?? 0
  check(currentRev === appPre.revision, 409, 'STALE_SNAPSHOT', '工具批准修订已变化')

  const tools = await listWorkspaceTools({workspaceId, openLedger})
  const liveTool = tools.find(t => t.toolId === command.resourceId)
  const operation = fields['操作类型'] || fields.operation || (fields['对外使用权限'] === '禁止' ? '撤销批准' : currentRev === 0 ? '首次批准' : '变更再审')
  if (operation !== '撤销批准') {
    check(liveTool && liveTool.fingerprint === cfgPre.sha256, 409, 'STALE_SNAPSHOT', '工具配置指纹已变化，旧审批失效')
  }

  const nextStatus = operation === '撤销批准' ? 'revoked' : 'approved'
  const record = {
    key,
    workspaceId,
    toolId: command.resourceId,
    providerId: liveTool?.providerId ?? fields['Dify工具提供者ID'] ?? existing?.providerId ?? '',
    name: liveTool?.name ?? fields['工具名称'] ?? existing?.name ?? command.resourceId,
    providerName: liveTool?.providerName ?? fields['工具提供者名称'] ?? existing?.providerName ?? '',
    version: liveTool?.version ?? fields['工具版本'] ?? existing?.version ?? '1.0.0',
    fingerprint: cfgPre.sha256,
    inputSchema: liveTool?.inputSchema ?? fields['输入参数schema'] ?? existing?.inputSchema ?? {type: 'object'},
    outputDescription: liveTool?.outputDescription ?? fields['输出说明'] ?? existing?.outputDescription ?? '',
    status: nextStatus,
    externalAllowed: nextStatus === 'revoked' ? '禁止' : fields['对外使用权限'] || '允许',
    ticketNo: command.ticketNo,
    revision: currentRev + 1,
    updatedAt: new Date().toISOString(),
  }
  approvalsDb.put(key, record)

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: `${workspaceId}:${command.resourceId}`,
    version: record.version,
    sha256: record.fingerprint,
    details: {
      toolId: record.toolId,
      workspaceId: record.workspaceId,
      status: record.status,
      externalAllowed: record.externalAllowed,
      revision: record.revision,
    },
  }
}
