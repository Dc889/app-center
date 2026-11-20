import {check, json} from '../../../../runtime/http.mjs'
import {findInstallation, listWorkspaceInstallations} from '../adapters/installations-store.mjs'

export async function plg02Context({res, query, plugin}) {
  const action = query.get('action')
  const resourceId = (query.get('resourceId') ?? '').trim()
  check(action === 'revise_package' && resourceId, 400, 'INVALID_REQUEST')

  const item = await (await plugin('/plugins/' + encodeURIComponent(resourceId))).json()
  return json(res, {
    snapshotId: `snap-plg02-${item.resourceId}-r${item.revision}`,
    ticketType: 'PLG-02',
    action: 'revise_package',
    resourceId: item.resourceId,
    capturedAt: new Date().toISOString(),
    fields: {
      '原版本号': item.version,
      '原版本指纹': item.sha256,
      '插件唯一标识': item.uniqueIdentifier || item.resourceId,
    },
    preconditions: [{kind: 'plugin', id: item.resourceId, revision: item.revision}],
  })
}

export async function plg03Candidates({res, query, openLedger}) {
  const action = query.get('action')
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  check(['upgrade', 'uninstall'].includes(action) && workspaceId, 400, 'INVALID_REQUEST')
  const instDb = openLedger('installations')
  const items = listWorkspaceInstallations(instDb, workspaceId).map(inst => ({
    resourceId: inst.resourceId,
    installationId: inst.installationId,
    name: inst.pluginName,
    workspaceId: inst.workspaceId,
    version: inst.version,
    status: inst.status,
    revision: inst.revision,
  }))
  return json(res, {items, nextCursor: null})
}

export async function plg03Context({res, query, plugin, openLedger}) {
  const action = query.get('action')
  const resourceId = (query.get('resourceId') ?? '').trim()
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  const installationId = (query.get('installationId') ?? '').trim()
  check(['upgrade', 'uninstall'].includes(action) && resourceId && workspaceId && installationId, 400, 'INVALID_REQUEST')

  const instDb = openLedger('installations')
  const inst = findInstallation(instDb, {installationId, resourceId, workspaceId})
  check(inst && inst.status !== '已卸载', 404, 'NOT_FOUND', '未找到已安装的插件实例')

  const catalogItem = await (await plugin('/plugins/' + encodeURIComponent(resourceId))).json()
  const isUpgrade = action === 'upgrade'
  const approvedVersion = isUpgrade ? catalogItem.version : inst.version
  const approvedSha256 = isUpgrade ? catalogItem.sha256 : inst.sha256
  const preconditions = [{kind: 'plugin_installation', id: inst.installationId, revision: inst.revision}]
  if (isUpgrade) {
    preconditions.push({kind: 'plugin', id: catalogItem.resourceId, sha256: catalogItem.sha256})
  }

  return json(res, {
    snapshotId: `snap-plg03-${inst.installationId}-r${inst.revision}`,
    ticketType: 'PLG-03',
    action,
    resourceId,
    eligible: true,
    capturedAt: new Date().toISOString(),
    fields: {
      '目标Dify workspace ID': workspaceId,
      '插件名称': catalogItem.name || inst.pluginName,
      '安装实例ID': inst.installationId,
      '原安装版本号': inst.version,
      '原安装指纹': inst.sha256,
      '批准版本号': approvedVersion,
      '版本指纹': approvedSha256,
      '权限匹配结果': catalogItem.installAccess === 'instant' ? '免审' : '需审批',
      ...(isUpgrade ? {'升级策略': catalogItem.upgradePolicy || '逐个工单升级'} : {}),
    },
    preconditions,
  })
}

export async function plg04Context({res, query, openLedger}) {
  const action = query.get('action')
  const resourceId = (query.get('resourceId') ?? '').trim()
  const workspaceId = (query.get('workspaceId') ?? '').trim()
  const sourceEventId = query.get('sourceEventId') || null
  const observationExecutionId = query.get('observationExecutionId') || null
  check(['disable_plugin', 'restore_plugin'].includes(action) && resourceId && workspaceId, 400, 'INVALID_REQUEST')

  const instDb = openLedger('installations')
  const inst = findInstallation(instDb, {resourceId, workspaceId})
  const capable = Boolean(inst && inst.status !== '已卸载')
  const preconditions = capable ? [{kind: 'plugin_installation', id: inst.installationId, revision: inst.revision}] : []
  const nowIso = new Date().toISOString()

  const fields = {
    'workspace ID': workspaceId,
    '插件名称': inst?.pluginName ?? resourceId,
    '版本号': inst?.version ?? 'unknown',
    '禁用周期ID': inst?.disableCycleId ?? `cycle-${workspaceId}-${resourceId}`,
    '定向操作能力': capable ? 'verified' : 'unsupported',
    '实例状态': capable ? inst.status : '未知',
    '安装实例ID': capable ? inst.installationId : null,
  }
  if (sourceEventId) {
    const alert = openLedger('alerts').get(sourceEventId)
    if (alert) Object.assign(fields, alert)
    fields['告警ID'] = sourceEventId
  }
  if (observationExecutionId) {
    fields['观察执行ID'] = observationExecutionId
    fields['观察区间开始'] = query.get('observeFrom') || nowIso
    fields['观察覆盖截止'] = query.get('observeUntil') || nowIso
    fields['观察结论'] = '通过'
    fields['观察数据完整'] = true
  }

  return json(res, {
    snapshotId: `snap-plg04-${workspaceId}-${resourceId}-r${inst?.revision ?? 0}`,
    ticketType: 'PLG-04',
    action,
    resourceId,
    capturedAt: nowIso,
    fields,
    preconditions,
  })
}
