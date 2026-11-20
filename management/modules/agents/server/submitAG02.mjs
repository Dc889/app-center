import {check, same} from '../../../../runtime/http.mjs'

export async function submitAG02(services) {
  const {accounts, actor, applications, at, cap, fields, headersFor, identity, input, owns, save, send, submission, text, types, version, visibleApplication} = services
  const list = value => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(text)

  check(fields && text(fields.scenario) && text(fields.instructions) && text(fields.businessLine) &&
    ['公开', '内部', '敏感', '机密'].includes(fields.classification) && ['all', 'orgs', 'accounts'].includes(fields.scope) &&
    list(fields.boundaryOrgs) && Array.isArray(fields.usages) && fields.usages.length > 0 &&
    fields.usages.every(value => ['run', 'embed', 'api'].includes(value)) &&
    (fields.scope !== 'orgs' || list(fields.targetOrgs)) &&
    (fields.scope !== 'accounts' || list(fields.targetAccounts)), 400, 'INVALID_FIELDS')

  const snapshot = await (await cap('/resources/dify_app/' + encodeURIComponent(input.resourceId) + '?workspaceId=' + encodeURIComponent(input.workspaceId),
    'GET', undefined, headersFor({command: {account: actor, org: accounts.get(actor), actorRole: identity.roles[0]}}))).json()
  check(snapshot.resourceId === input.resourceId && snapshot.workspaceId === input.workspaceId &&
    typeof snapshot.snapshotId === 'string' && snapshot.snapshotId && snapshot.data &&
    snapshot.data.publicationVersionId && Number.isInteger(snapshot.data.catalogRevision), 409, 'INVALID_SNAPSHOT', '应用快照缺少发布版本或目录修订号')
  check(types.activeVersion(input.ticketType, input.workspaceId) === version, 409, 'TYPE_VERSION_CHANGED')
  const concurrent = applications.get(input.ticketNo)
  if (concurrent) {
    check(owns(concurrent) && same(concurrent.submission, submission), 409, 'APPLICATION_CONFLICT')
    return send(visibleApplication(concurrent, identity))
  }
  return send(save(input.ticketNo, {
    ticketNo: input.ticketNo, ticketType: 'AG-02', ticketTypeVersion: version,
    account: actor, org: accounts.get(actor), submission, snapshot, status: '待受理', revision: 1,
    history: [{at, actor, action: '提交发布申请'}]
  }), 201)
}
