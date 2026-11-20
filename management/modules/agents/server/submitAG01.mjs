import {check, id, same} from '../../../../runtime/http.mjs'

export async function submitAG01(services) {
  const {accounts, actor, applications, at, cap, deliver, headersFor, identity, input, owns, save, send, submission, types, version, visibleApplication} = services
  const snapshot = await (await cap('/resources/dify_app/' + encodeURIComponent(input.resourceId) + '?workspaceId=' + encodeURIComponent(input.workspaceId),
    'GET', undefined, headersFor({command: {account: actor, org: accounts.get(actor), actorRole: identity.roles[0]}}))).json()
  check(snapshot.resourceId === input.resourceId && snapshot.workspaceId === input.workspaceId &&
    typeof snapshot.snapshotId === 'string' && snapshot.snapshotId && snapshot.data, 409, 'INVALID_SNAPSHOT', '应用快照缺少发布版本或目录修订号')
  check(snapshot.data.ownerAccount === actor, 403, 'NOT_RESOURCE_OWNER', '仅可纳管本人应用')
  check(snapshot.data.webSiteEnabled === false, 409, 'WEB_SITE_ENABLED', '纳管前须关闭应用 Web 站点')
  check(types.activeVersion(input.ticketType, input.workspaceId) === version, 409, 'TYPE_VERSION_CHANGED')
  const concurrent = applications.get(input.ticketNo)
  if (concurrent) {
    check(owns(concurrent) && same(concurrent.submission, submission), 409, 'APPLICATION_CONFLICT')
    return send(visibleApplication(concurrent, identity))
  }
  const executionId = id()
  const approvedFields = {snapshotId: snapshot.snapshotId, workspaceId: input.workspaceId, ownerAccount: actor}
  const command = {
    executionId, ticketNo: input.ticketNo, ticketType: 'AG-01', ticketTypeVersion: version,
    action: 'sync_app', resourceId: input.resourceId, account: actor, org: accounts.get(actor), payload: {decisionRef: 'dec-' + executionId}
  }
  const row = save(input.ticketNo, {
    ticketNo: input.ticketNo, ticketType: 'AG-01', ticketTypeVersion: version,
    account: actor, org: accounts.get(actor), submission, snapshot, status: '执行中', revision: 1, command, approvedFields,
    preconditions: [],
    attempts: [{command, approvedFields}], history: [{at, actor, action: '提交本人纳管同步'}]
  })
  void deliver(row)
  return send(visibleApplication(row, identity), 201)
}
