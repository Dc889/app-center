import {check, json} from '../../../../runtime/http.mjs'
import {findInstallation} from '../adapters/installations-store.mjs'

async function fetchPlugins(pluginClient) {
  check(pluginClient, 501, 'REPOSITORY_UNCONFIGURED', '未配置插件仓库')
  const data = await (await pluginClient('/plugins')).json()
  check(Array.isArray(data?.items), 502, 'UPSTREAM_INVALID_RESPONSE', '插件仓库未返回有效列表')
  return data.items
}

async function fetchPluginDetail(pluginClient, resourceId) {
  check(pluginClient, 501, 'REPOSITORY_UNCONFIGURED', '未配置插件仓库')
  const item = await (await pluginClient('/plugins/' + encodeURIComponent(resourceId))).json()
  check(item?.resourceId === resourceId, 502, 'UPSTREAM_INVALID_RESPONSE', '插件仓库返回的资源标识不一致')
  return item
}

function projectPlugin(item, workspaceId, instDb) {
  const inst = workspaceId && instDb ? findInstallation(instDb, {resourceId: item.resourceId, workspaceId}) : null
  const installed = workspaceId && instDb ? Boolean(inst) : null
  return {
    resourceId: item.resourceId,
    name: item.name || item.resourceId,
    status: item.status ?? 'unknown',
    actions: item.status === 'approved' ? ['install'] : [],
    data: {
      version: item.version,
      sha256: item.sha256,
      sizeBytes: item.sizeBytes,
      uniqueIdentifier: `${item.uniqueIdentifier || item.resourceId}:${item.version}`,
      installAccess: item.installAccess || 'approval',
      installed,
      installationId: inst?.installationId ?? '',
      revision: item.revision ?? null,
    },
  }
}

export async function listCatalog({res, query, plugin, openLedger}) {
  const q = (query.get('q') ?? '').trim().toLowerCase()
  const workspaceId = query.get('workspaceId') || ''
  const items = await fetchPlugins(plugin)
  const instDb = openLedger ? openLedger('installations') : null
  const projected = items
    .map(item => projectPlugin(item, workspaceId, instDb))
    .filter(p => !q || (p.name + p.resourceId).toLowerCase().includes(q))
  return json(res, {items: projected, nextCursor: null})
}

export async function catalogItem({res, query, plugin, resourceId, openLedger}) {
  const workspaceId = query?.get('workspaceId') || ''
  const item = await fetchPluginDetail(plugin, resourceId)
  const instDb = openLedger ? openLedger('installations') : null
  return json(res, projectPlugin(item, workspaceId, instDb))
}

export async function catalogVersions({res, plugin, resourceId}) {
  const data = await (await plugin('/plugins/' + encodeURIComponent(resourceId) + '/versions')).json()
  return json(res, data)
}
