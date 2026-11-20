import {check, json} from '../../../../runtime/http.mjs'

function canWithdraw(item, identity) {
  if (!item || !['available', 'approved'].includes(item.status)) return false
  if (['operator', 'admin'].includes(identity?.role)) return true
  return Boolean(identity?.account && item.ownerAccount && item.ownerAccount === identity.account)
}

function visibleToOrg(item, org) {
  return !item.orgs?.length || item.orgs.includes(org)
}

function entryActions(item, identity, requestedAction) {
  if (requestedAction === 'withdraw_skill') {
    return canWithdraw(item, identity) ? ['withdraw_skill'] : []
  }
  const actions = []
  if (['available', 'approved'].includes(item.status) && visibleToOrg(item, identity?.org ?? '')) {
    actions.push('download')
  }
  if (canWithdraw(item, identity)) {
    actions.push('withdraw_skill')
  }
  return actions
}

export async function listCatalog({req, res, skill, query, identity}) {
  const action = query.get('action')
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const org = identity?.org ?? decodeURIComponent(req.headers['x-org'] ?? '')
  const caller = identity ?? {account: req.headers['x-account'] ?? '', org, role: req.headers['x-role'] ?? ''}

  const {items} = await (await skill('/skills')).json()
  const filtered = items
    .filter(item => {
      if (action === 'withdraw_skill') return canWithdraw(item, caller)
      return item.status !== 'withdrawn' && visibleToOrg(item, org)
    })
    .filter(item => !q || (item.name + item.resourceId).toLowerCase().includes(q))

  return json(res, {
    items: filtered.map(item => ({
      resourceId: item.resourceId,
      name: item.name,
      status: item.status,
      actions: entryActions(item, caller, action),
      data: {version: item.version, sha256: item.sha256, sizeBytes: item.sizeBytes},
    })),
    nextCursor: null,
  })
}

export async function catalogDetail({req, res, skill, query, resourceId, identity}) {
  const action = query.get('action')
  const version = query.get('version')
  const org = identity?.org ?? decodeURIComponent(req.headers['x-org'] ?? '')
  const caller = identity ?? {account: req.headers['x-account'] ?? '', org, role: req.headers['x-role'] ?? ''}

  const suffix = version ? '?version=' + encodeURIComponent(version) : ''
  const item = await (await skill('/skills/' + encodeURIComponent(resourceId) + suffix)).json()
  const actions = entryActions(item, caller, action)
  if (action === 'withdraw_skill') {
    check(actions.includes('withdraw_skill'), 403, 'ACCESS_DENIED', '当前身份无此 Skill 下架资格')
  }
  return json(res, {
    resourceId: item.resourceId,
    name: item.name,
    status: item.status,
    actions,
    data: {version: item.version, sha256: item.sha256, sizeBytes: item.sizeBytes, revision: item.revision},
  })
}

export async function catalogVersions({res, skill, resourceId}) {
  const data = await (await skill('/skills/' + encodeURIComponent(resourceId) + '/versions')).json()
  return json(res, data)
}
