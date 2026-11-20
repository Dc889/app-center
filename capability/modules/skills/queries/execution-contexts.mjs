import {check, json} from '../../../../runtime/http.mjs'

function canManage(item, identity) {
  if (['operator', 'admin'].includes(identity?.role)) return true
  return Boolean(identity?.account && item.ownerAccount && item.ownerAccount === identity.account)
}

export async function skl02Context({res, query, skill, identity}) {
  const action = query.get('action')
  const resourceId = (query.get('resourceId') ?? '').trim()
  check(action === 'revise_skill' && resourceId, 400, 'INVALID_REQUEST')

  const item = await (await skill('/skills/' + encodeURIComponent(resourceId))).json()
  check(['available', 'approved'].includes(item.status), 409, 'SKILL_WITHDRAWN', '已下架 Skill 不允许变更再审')
  check(canManage(item, identity), 403, 'ACCESS_DENIED', '当前身份无此 Skill 变更资格')

  return json(res, {
    snapshotId: `snap-skl02-${item.resourceId}-r${item.revision}`,
    ticketType: 'SKL-02',
    action: 'revise_skill',
    resourceId: item.resourceId,
    capturedAt: new Date().toISOString(),
    fields: {
      '原版本号': item.version,
      '原文件SHA-256': item.sha256,
    },
    preconditions: [{kind: 'skill', id: item.resourceId, revision: item.revision}],
  })
}

export async function skl04Context({res, query, skill, identity}) {
  const action = query.get('action')
  const resourceId = (query.get('resourceId') ?? '').trim()
  check(action === 'withdraw_skill' && resourceId, 400, 'INVALID_REQUEST')

  const item = await (await skill('/skills/' + encodeURIComponent(resourceId))).json()
  check(['available', 'approved'].includes(item.status), 403, 'SKILL_WITHDRAWAL_DENIED', '该 Skill 已下架或状态不允许下架')
  check(canManage(item, identity), 403, 'SKILL_WITHDRAWAL_DENIED', '当前身份没有此 Skill 的下架资格')

  const stats = await (await skill('/skills/' + encodeURIComponent(resourceId) + '/stats')).json()
  return json(res, {
    snapshotId: `snap-skl04-${item.resourceId}-r${item.revision}`,
    ticketType: 'SKL-04',
    action: 'withdraw_skill',
    resourceId: item.resourceId,
    capturedAt: new Date().toISOString(),
    fields: {
      'Skill名称': item.name,
      '当前版本号': item.version,
      '历史下载次数': stats.downloadCount,
      '历史下载人数': stats.uniqueAccounts,
    },
    preconditions: [{kind: 'skill', id: item.resourceId, revision: item.revision}],
  })
}
