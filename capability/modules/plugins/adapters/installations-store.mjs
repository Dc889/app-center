import {randomUUID} from 'node:crypto'
import {check} from '../../../../runtime/http.mjs'

export function upsertInstallation(db, {installationId, productInstallationId, resourceId, pluginName, workspaceId, version, sha256, uniqueIdentifier, account, status = '已启用'}) {
  const id = installationId || `inst-${randomUUID().slice(0, 10)}`
  const existing = db.get(id)
  const record = {
    installationId: id,
    productInstallationId: productInstallationId || existing?.productInstallationId || null,
    resourceId,
    pluginName: pluginName || existing?.pluginName || resourceId,
    workspaceId,
    version,
    sha256,
    uniqueIdentifier: uniqueIdentifier || existing?.uniqueIdentifier || null,
    account: account || existing?.account || '',
    status, // '已启用' | '已禁用' | '已卸载'
    revision: existing ? existing.revision + 1 : 1,
    disableCycleId: existing?.disableCycleId ?? `cycle-${id}-1`,
    updatedAt: new Date().toISOString(),
  }
  db.put(id, record)
  return record
}

export function findInstallation(db, {installationId, resourceId, workspaceId}) {
  if (installationId) {
    const direct = db.get(installationId)
    if (direct && (!resourceId || direct.resourceId === resourceId) && (!workspaceId || direct.workspaceId === workspaceId)) {
      return direct
    }
    return null
  }
  return (
    db
      .all()
      .find(r => r && r.resourceId === resourceId && r.workspaceId === workspaceId && r.status !== '已卸载') ?? null
  )
}

export function listWorkspaceInstallations(db, workspaceId) {
  return db.all().filter(r => r && r.workspaceId === workspaceId && r.status !== '已卸载')
}

export async function readPluginApprovedInput(clients, command) {
  check(clients?.management, 503, 'REPOSITORY_UNCONFIGURED', '未配置管理端获准输入地址')
  const response = await clients.management('/approved-inputs/' + encodeURIComponent(command.executionId))
  const approved = await response.json()
  check(
    approved &&
      approved.decisionRef === command.payload?.decisionRef &&
      approved.ticketType === command.ticketType &&
      approved.action === command.action &&
      approved.resourceId === command.resourceId,
    409,
    'APPROVED_INPUT_MISMATCH',
    '获准输入与执行命令不一致',
  )
  return {
    fields: approved.fields ?? {},
    preconditions: Array.isArray(approved.preconditions) ? approved.preconditions : [],
  }
}
