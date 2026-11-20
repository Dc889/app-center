import {check, id, same} from '../../../../runtime/http.mjs'

export async function submitKB01(services) {
  const {accounts, actor, applications, at, cap, deliver, fields, headersFor, identity, input, owns, save, send, submission, types, version, visibleApplication} = services

  check(fields && ['RAGFlow', 'Dify'].includes(fields.sourceSystem), 400, 'INVALID_FIELDS')

  const resourceKind = fields.sourceSystem === 'RAGFlow' ? 'ragflow_dataset' : 'dify_dataset'
  const resourceQuery = resourceKind === 'ragflow_dataset' ? '' : '?workspaceId=' + encodeURIComponent(input.workspaceId)
  const snapshot = await (await cap('/resources/' + resourceKind + '/' + encodeURIComponent(input.resourceId) + resourceQuery,
    'GET', undefined, headersFor({command: {account: actor, org: accounts.get(actor), actorRole: identity.roles[0]}}))).json()
  check(snapshot.resourceId === input.resourceId &&
    (resourceKind === 'ragflow_dataset' ? snapshot.workspaceId === null && snapshot.data?.tenantId === input.workspaceId : snapshot.workspaceId === input.workspaceId) &&
    typeof snapshot.snapshotId === 'string' && snapshot.snapshotId && snapshot.data, 409, 'INVALID_SNAPSHOT')
  check(snapshot.data.ownerAccount === actor, 403, 'NOT_RESOURCE_OWNER', '仅可同步本人知识库')
  check(types.activeVersion(input.ticketType, input.workspaceId) === version, 409, 'TYPE_VERSION_CHANGED')
  const concurrent = applications.get(input.ticketNo)
  if (concurrent) {
    check(owns(concurrent) && same(concurrent.submission, submission), 409, 'APPLICATION_CONFLICT')
    return send(visibleApplication(concurrent, identity))
  }
  const executionId = id()
  const approvedFields = {
    '来源系统': fields.sourceSystem,
    '所属workspace/tenant ID': input.workspaceId,
    '所有者账户名': actor,
    snapshotId: snapshot.snapshotId
  }
  const command = {
    executionId, ticketNo: input.ticketNo, ticketType: 'KB-01', ticketTypeVersion: version,
    action: 'sync_dataset', resourceId: input.resourceId, account: actor, org: accounts.get(actor), payload: {decisionRef: 'dec-' + executionId}
  }
  const row = save(input.ticketNo, {
    ticketNo: input.ticketNo, ticketType: 'KB-01', ticketTypeVersion: version,
    account: actor, org: accounts.get(actor), submission, snapshot, status: '执行中', revision: 1, command, approvedFields,
    preconditions: [], attempts: [{command, approvedFields}], history: [{at, actor, action: '同步本人知识库'}]
  })
  void deliver(row)
  return send(visibleApplication(row, identity), 201)
}
