import {check, json} from '../../../../runtime/http.mjs'
import {findInstallation} from '../adapters/installations-store.mjs'

const FALLBACK_PLUGINS = [
  {
    resourceId: 'document-parser',
    uniqueIdentifier: 'document-parser',
    name: '文档解析与抽取插件 (Document Parser)',
    status: 'approved',
    revision: 1,
    version: 'v2.4.1',
    sha256: '8d531a547622d26892fe15fbad1cddfc62163cbacc7822da985ab1c18aaed2c5',
    installAccess: 'approval',
  },
  {
    resourceId: 'web-search-pro',
    uniqueIdentifier: 'web-search-pro',
    name: '联网专业搜索插件 (Web Search Pro)',
    status: 'approved',
    revision: 1,
    version: 'v1.5.0',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    installAccess: 'instant',
  },
  {
    resourceId: 'browser-agent',
    uniqueIdentifier: 'browser-agent',
    name: '网页浏览自动化插件 (Browser Agent)',
    status: 'approved',
    revision: 1,
    version: 'v1.2.0',
    sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    installAccess: 'approval',
  },
]

async function fetchPlugins(pluginClient) {
  if (!pluginClient) return FALLBACK_PLUGINS
  try {
    const data = await (await pluginClient('/plugins')).json()
    return Array.isArray(data.items) ? data.items : FALLBACK_PLUGINS
  } catch (err) {
    if (err.code === 'REPOSITORY_UNCONFIGURED') return FALLBACK_PLUGINS
    throw err
  }
}

async function fetchPluginDetail(pluginClient, resourceId) {
  if (pluginClient) {
    try {
      return await (await pluginClient('/plugins/' + encodeURIComponent(resourceId))).json()
    } catch (err) {
      if (err.code !== 'REPOSITORY_UNCONFIGURED') {
        if (resourceId === 'document-parser' && err.status === 404) {
          return await (await pluginClient('/plugins/document-parser/versions/v2.4.1')).json()
        }
        throw err
      }
    }
  }
  const found = FALLBACK_PLUGINS.find(p => p.resourceId === resourceId)
  check(found, 404, 'NOT_FOUND')
  return found
}

function projectPlugin(item, workspaceId, instDb) {
  const inst = workspaceId && instDb ? findInstallation(instDb, {resourceId: item.resourceId, workspaceId}) : null
  const isSeedInstalled = !inst && workspaceId === 'ws-default' && item.resourceId === 'document-parser'
  const installed = Boolean(inst) || isSeedInstalled
  return {
    resourceId: item.resourceId,
    name: item.name || item.resourceId,
    status: item.status || 'approved',
    actions: ['install'],
    data: {
      version: item.version,
      sha256: item.sha256,
      sizeBytes: item.sizeBytes,
      uniqueIdentifier: `${item.uniqueIdentifier || item.resourceId}:${item.version}`,
      installAccess: item.installAccess || 'approval',
      installed,
      installationId: inst?.installationId ?? (isSeedInstalled ? 'inst-doc-01' : ''),
      revision: item.revision ?? 1,
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
