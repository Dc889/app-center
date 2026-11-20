import {check, json} from '../../../../runtime/http.mjs'
import {diffToolConfigs, listWorkspaceTools} from '../adapters/tool-store.mjs'

const OPERATIONS = ['首次批准', '变更再审', '撤销批准']

export async function tol01Candidates({res, query, openLedger}) {
  const action = query.get('action')
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  const operation = query.get('operation') || '首次批准'
  check((!action || action === 'set_tool_approval') && workspaceId && OPERATIONS.includes(operation), 400, 'INVALID_REQUEST')

  const tools = await listWorkspaceTools({workspaceId, openLedger})
  const approvalsDb = openLedger('approvals')
  const items = tools
    .filter(tool => {
      const approval = approvalsDb.get(`${workspaceId}:${tool.toolId}`)
      const isApproved = Boolean(approval && approval.status === 'approved')
      return operation === '首次批准' ? !isApproved : isApproved
    })
    .map(tool => ({
      resourceId: tool.toolId,
      name: tool.name,
      workspaceId,
      providerId: tool.providerId,
      providerName: tool.providerName,
      version: tool.version,
    }))

  return json(res, {items, nextCursor: null})
}

export async function tol01Context({res, query, openLedger}) {
  const action = query.get('action')
  const resourceId = (query.get('resourceId') ?? '').trim()
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  const operation = query.get('operation')
  check(action === 'set_tool_approval' && resourceId && workspaceId && OPERATIONS.includes(operation), 400, 'INVALID_REQUEST')

  const tools = await listWorkspaceTools({workspaceId, openLedger})
  const tool = tools.find(t => t.toolId === resourceId)
  const approval = openLedger('approvals').get(`${workspaceId}:${resourceId}`)
  const hasApproval = Boolean(approval && approval.status === 'approved')

  if (operation === '首次批准') {
    check(tool, 404, 'NOT_FOUND', '未找到该 Dify 工具')
    check(!hasApproval, 409, 'EXISTING_TOOL_APPROVAL', '该工具已有有效批准，请走变更再审')
  } else {
    check(hasApproval, 409, 'MISSING_PREVIOUS_APPROVAL', '该工具尚无有效批准记录')
    if (operation === '变更再审') check(tool, 404, 'NOT_FOUND', '未找到该 Dify 工具现状')
  }

  const sourceTool = tool ?? approval
  const configSource = tool ? '产品现状' : '批准登记'
  const approvalRevision = approval?.revision ?? 0

  const fields = {
    'Dify workspace ID': workspaceId,
    'Dify工具ID': sourceTool.toolId,
    'Dify工具提供者ID': sourceTool.providerId,
    '工具名称': sourceTool.name,
    '工具提供者名称': sourceTool.providerName,
    '配置来源': configSource,
    '工具配置指纹': sourceTool.fingerprint,
    '工具版本': sourceTool.version,
    '输入参数schema': sourceTool.inputSchema,
    '输出说明': sourceTool.outputDescription,
  }
  if (operation !== '首次批准') {
    fields['原批准工单号'] = approval.ticketNo
  }
  if (operation === '变更再审') {
    fields['原工具版本'] = approval.version
    fields['原工具配置指纹'] = approval.fingerprint
    fields['配置差异'] = diffToolConfigs(approval, sourceTool)
  }

  return json(res, {
    snapshotId: `snap-tol01-${workspaceId}-${resourceId}-r${approvalRevision}`,
    ticketType: 'TOL-01',
    action: 'set_tool_approval',
    operation,
    eligible: true,
    resourceId,
    capturedAt: new Date().toISOString(),
    fields,
    preconditions: [
      {kind: 'tool_configuration', id: resourceId, sha256: sourceTool.fingerprint},
      {kind: 'tool_approval', id: resourceId, revision: approvalRevision},
    ],
  })
}
