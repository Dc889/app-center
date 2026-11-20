import {check, id, same} from '../../../../runtime/http.mjs'

export async function submitAG03(services) {
  const {accounts, actor, applications, at, cap, deliver, fields, headersFor, identity, input, owns, save, send, submission, text, types, version, visibleApplication} = services
  const list = value => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(text)

  check(fields && text(fields.purpose) &&
    typeof fields.startsAt === 'string' && typeof fields.expiresAt === 'string' &&
    Number.isFinite(Date.parse(fields.startsAt)) && Date.parse(fields.expiresAt) > Date.now() &&
    Date.parse(fields.expiresAt) > Date.parse(fields.startsAt) && list(fields.usages) &&
    fields.usages.every(v => ['run', 'embed', 'api'].includes(v)), 400, 'INVALID_FIELDS')

  const headers = headersFor({command: {account: actor, org: accounts.get(actor), actorRole: identity.roles[0]}})
  const originalCatalog = await (await cap('/catalog/agent/' + encodeURIComponent(input.resourceId), 'GET', undefined, headers)).json()
  check(originalCatalog.resourceId === input.resourceId && originalCatalog.data?.workspaceId === input.workspaceId && originalCatalog.data?.appId,
    409, 'INVALID_CATALOG_RESOURCE')
  const sourceId = originalCatalog.data.appId
  const data = originalCatalog.data
  check(originalCatalog.status === 'active' && typeof data.policyRef === 'string' && data.policyRef &&
    Array.isArray(data.usages) && fields.usages.every(v => data.usages.includes(v)), 403, 'USAGE_NOT_PUBLISHED')
  check(Array.isArray(data.boundaryOrgs) && data.boundaryOrgs.includes(accounts.get(actor)) &&
    (data.scope === 'all' || data.scope === 'orgs' && data.targetOrgs?.includes(accounts.get(actor)) ||
      data.scope === 'accounts' && data.targetAccounts?.includes(actor)), 403, 'OUTSIDE_PUBLISHED_SCOPE')

  const snapshot = await (await cap('/resources/dify_app/' + encodeURIComponent(sourceId) + '?workspaceId=' + encodeURIComponent(input.workspaceId),
    'GET', undefined, headers)).json()
  check(snapshot.resourceId === sourceId && snapshot.workspaceId === input.workspaceId &&
    typeof snapshot.snapshotId === 'string' && snapshot.snapshotId && snapshot.data &&
    snapshot.data.publicationVersionId && Number.isInteger(snapshot.data.catalogRevision), 409, 'INVALID_SNAPSHOT', '应用快照缺少发布版本或目录修订号')
  check(types.activeVersion(input.ticketType, input.workspaceId) === version, 409, 'TYPE_VERSION_CHANGED')
  const concurrent = applications.get(input.ticketNo)
  if (concurrent) {
    check(owns(concurrent) && same(concurrent.submission, submission), 409, 'APPLICATION_CONFLICT')
    return send(visibleApplication(concurrent, identity))
  }
  if (originalCatalog.data.scope === 'all') {
    const executionId = id()
    const approvedFields = {
      workspaceId: input.workspaceId, account: actor, startsAt: fields.startsAt,
      expiresAt: fields.expiresAt, usages: fields.usages, policyRef: originalCatalog.data.policyRef,
      expectedRevision: snapshot.data.catalogRevision
    }
    const command = {
      executionId, ticketNo: input.ticketNo, ticketType: 'AG-03', ticketTypeVersion: version,
      action: 'grant_app_access', resourceId: input.resourceId, account: actor, org: accounts.get(actor), payload: {decisionRef: 'dec-' + executionId}
    }
    const row = save(input.ticketNo, {
      ticketNo: input.ticketNo, ticketType: 'AG-03', ticketTypeVersion: version,
      account: actor, org: accounts.get(actor), submission, snapshot, originalCatalog, status: '执行中', revision: 1,
      command, approvedFields, preconditions: [{kind: 'agent', id: input.resourceId, revision: snapshot.data.catalogRevision}],
      attempts: [{command, approvedFields}], history: [{at, actor, action: '提交公开应用使用授权'}]
    })
    void deliver(row)
    return send(visibleApplication(row, identity), 201)
  }
  return send(save(input.ticketNo, {
    ticketNo: input.ticketNo, ticketType: 'AG-03', ticketTypeVersion: version,
    account: actor, org: accounts.get(actor), submission, snapshot, originalCatalog, status: '待受理', revision: 1,
    history: [{at, actor, action: '提交受限使用授权'}]
  }), 201)
}
