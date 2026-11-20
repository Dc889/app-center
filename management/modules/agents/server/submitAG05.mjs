import {check, same} from '../../../../runtime/http.mjs'
import {agentManagementContext} from './agent-management.mjs'
import {impactPreconditions, readAgentImpact, requireAgentImpact} from './agent-impact.mjs'
import {replacementContext, verifyReplacementSource} from './agent-replacements.mjs'

export async function submitAG05(services) {
  const {accounts, actor, applications, at, cap, fields, headersFor, identity, input, owns, save, send, submission, text, types, version, visibleApplication} = services

  check(fields && ['主动下架', '版本替换', '安全事件', '长期故障', '其他'].includes(fields.reason) &&
    text(fields.explanation) && typeof fields.effectiveAt === 'string' &&
    Number.isFinite(Date.parse(fields.effectiveAt)) &&
    (!fields.replacementAppId || text(fields.replacementAppId)), 400, 'INVALID_FIELDS')

  const headers = headersFor({command: {account: actor, org: accounts.get(actor), actorRole: identity.roles[0]}})
  const originalCatalog = await agentManagementContext(cap, headers, input.resourceId, input.workspaceId, 'withdraw_app')
  check(originalCatalog.resourceId === input.resourceId && originalCatalog.data?.workspaceId === input.workspaceId && originalCatalog.data?.appId,
    409, 'INVALID_CATALOG_RESOURCE')
  const sourceId = originalCatalog.data.appId
  const snapshot = await (await cap('/resources/dify_app/' + encodeURIComponent(sourceId) + '?workspaceId=' + encodeURIComponent(input.workspaceId) + '&catalogResourceId=' + encodeURIComponent(input.resourceId),
    'GET', undefined, headers)).json()
  check(snapshot.resourceId === sourceId && snapshot.workspaceId === input.workspaceId &&
    typeof snapshot.snapshotId === 'string' && snapshot.snapshotId && snapshot.data &&
    snapshot.data.publicationVersionId && Number.isInteger(snapshot.data.catalogRevision), 409, 'INVALID_SNAPSHOT', '应用快照缺少发布版本或目录修订号')
  check(Number.isSafeInteger(snapshot.data.catalogRevision) && snapshot.data.catalogRevision >= 0, 409, 'INVALID_AGENT_IMPACT_SOURCE')
  const agentImpact = readAgentImpact(snapshot.data.agentImpact, {resourceId: input.resourceId, appId: sourceId, workspaceId: input.workspaceId})
  requireAgentImpact(agentImpact, 'withdraw_app')
  snapshot.data.agentImpact = agentImpact
  snapshot.data.dependencies = agentImpact.dependencies.state === 'collected' ? agentImpact.dependencies.items.filter(row => row.change !== 'removed') : []
  const current = await agentManagementContext(cap, headers, input.resourceId, input.workspaceId, 'withdraw_app')
  check(['appId', 'workspaceId', 'publicationVersionId', 'workflowSnapshotId', 'policyRef'].every(key => same(current.data[key], originalCatalog.data[key])),
    409, 'STALE_SNAPSHOT', '预检期间目录版本已变化，请重新申请')
  const replacement = fields.replacementAppId ? await replacementContext(cap, headers, input.resourceId, fields.replacementAppId) : null
  if (replacement) {
    verifyReplacementSource(replacement, originalCatalog)
    const latest = await agentManagementContext(cap, headers, input.resourceId, input.workspaceId, 'withdraw_app')
    check(['appId', 'workspaceId', 'publicationVersionId', 'workflowSnapshotId', 'policyRef'].every(key => same(latest.data[key], originalCatalog.data[key])), 409, 'STALE_SNAPSHOT')
  }
  check(types.activeVersion(input.ticketType, input.workspaceId) === version, 409, 'TYPE_VERSION_CHANGED')
  const concurrent = applications.get(input.ticketNo)
  if (concurrent) {
    check(owns(concurrent) && same(concurrent.submission, submission), 409, 'APPLICATION_CONFLICT')
    return send(visibleApplication(concurrent, identity))
  }
  return send(save(input.ticketNo, {
    ticketNo: input.ticketNo, ticketType: 'AG-05', ticketTypeVersion: version,
    account: actor, org: accounts.get(actor), submission, snapshot, originalCatalog, status: '待受理', revision: 1,
    agentImpact, preconditions: [{kind: 'agent', id: input.resourceId, revision: snapshot.data.catalogRevision}, ...impactPreconditions(agentImpact), ...replacement ? [{kind: 'agent_replacement', id: replacement.resourceId, revision: replacement.revision}] : []],
    ...replacement ? {replacementApplication: replacement} : {},
    history: [{at, actor, action: '提交下架申请'}]
  }), 201)
}
