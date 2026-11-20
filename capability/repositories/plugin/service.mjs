import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {body, check, digest, json, ledger, listen, prefix} from '../../../runtime/http.mjs'

function seedDocBytes() {
  return readFileSync(new URL('./packages/document-parser.txt', import.meta.url))
}

function buildSeedPlugins() {
  const docBytes = seedDocBytes()
  const docSha = digest(docBytes)
  return [
    {
      resourceId: 'document-parser',
      uniqueIdentifier: 'document-parser',
      name: '文档解析与抽取插件 (Document Parser)',
      status: 'approved',
      revision: 1,
      version: 'v2.4.1',
      sha256: docSha,
      sizeBytes: docBytes.length,
      upgradePolicy: '逐个工单升级',
      installAccess: 'approval',
      versions: [
        {version: 'v2.4.1', sha256: docSha, sizeBytes: docBytes.length, seed: true, status: 'approved'},
      ],
    },
    {
      resourceId: 'web-search-pro',
      uniqueIdentifier: 'web-search-pro',
      name: '联网专业搜索插件 (Web Search Pro)',
      status: 'approved',
      revision: 1,
      version: 'v1.5.0',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 0,
      upgradePolicy: '逐个工单升级',
      installAccess: 'instant',
      versions: [
        {
          version: 'v1.5.0',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          sizeBytes: 0,
          empty: true,
          status: 'approved',
        },
      ],
    },
    {
      resourceId: 'browser-agent',
      uniqueIdentifier: 'browser-agent',
      name: '网页浏览自动化插件 (Browser Agent)',
      status: 'approved',
      revision: 1,
      version: 'v1.2.0',
      sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
      sizeBytes: 1,
      upgradePolicy: '逐个工单升级',
      installAccess: 'approval',
      versions: [
        {
          version: 'v1.2.0',
          sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
          sizeBytes: 1,
          empty: true,
          status: 'approved',
        },
      ],
    },
  ]
}

export function startPlugin(options) {
  const catalogStore = ledger(options.dir, 'plugin-catalog')
  const objectsDir = join(options.dir, 'plugin-objects')
  mkdirSync(objectsDir, {recursive: true})
  const seeds = buildSeedPlugins()

  function mergedItems() {
    const map = new Map()
    for (const s of seeds) map.set(s.resourceId, s)
    for (const p of catalogStore.all()) map.set(p.resourceId, p)
    return [...map.values()]
  }

  function findItem(resourceId) {
    return catalogStore.get(resourceId) ?? seeds.find(s => s.resourceId === resourceId) ?? null
  }

  function writeBlob(resourceId, version, base64Content) {
    const bytes = Buffer.from(base64Content, 'base64')
    const blobName = `${resourceId.replace(/[^\w-]/g, '_')}_${version.replace(/[^\w.-]/g, '_')}_${digest(bytes).slice(0, 12)}.bin`
    writeFileSync(join(objectsDir, blobName), bytes)
    return {blobName, sha256: digest(bytes), sizeBytes: bytes.length}
  }

  function readVersionBytes(item, ver) {
    if (ver.seed && item.resourceId === 'document-parser') return seedDocBytes()
    if (ver.blobName) return readFileSync(join(objectsDir, ver.blobName))
    check(false, 404, 'PACKAGE_FILE_NOT_FOUND')
  }

  return listen(
    async (req, res, path) => {
      if (req.method === 'GET' && path === prefix + '/plugins') {
        const items = mergedItems().map(({versions: _v, ...summary}) => summary)
        return json(res, {items, nextCursor: null})
      }

      if (req.method === 'POST' && path === prefix + '/plugins') {
        const input = await body(req)
        check(
          input &&
            typeof input.resourceId === 'string' &&
            /^[\w-]+$/.test(input.resourceId) &&
            typeof input.uniqueIdentifier === 'string' &&
            input.uniqueIdentifier.trim() &&
            typeof input.name === 'string' &&
            input.name.trim() &&
            typeof input.version === 'string' &&
            input.version.trim() &&
            typeof input.contentBase64 === 'string',
          400,
          'INVALID_REQUEST',
        )
        check(!findItem(input.resourceId), 409, 'PLUGIN_ALREADY_EXISTS', '该插件目录 ID 已存在')
        const blob = writeBlob(input.resourceId, input.version, input.contentBase64)
        if (input.sha256) check(blob.sha256 === input.sha256, 409, 'STALE_SNAPSHOT')
        const ver = {
          version: input.version,
          sha256: blob.sha256,
          sizeBytes: blob.sizeBytes,
          blobName: blob.blobName,
          status: 'approved',
          publishedAt: new Date().toISOString(),
        }
        const record = {
          resourceId: input.resourceId,
          uniqueIdentifier: input.uniqueIdentifier.trim(),
          name: input.name.trim(),
          status: 'approved',
          revision: 1,
          version: ver.version,
          sha256: ver.sha256,
          sizeBytes: ver.sizeBytes,
          upgradePolicy: input.upgradePolicy || '逐个工单升级',
          installAccess: ['instant', 'approval'].includes(input.installAccess) ? input.installAccess : 'approval',
          ownerAccount: input.ownerAccount ?? '',
          versions: [ver],
        }
        catalogStore.put(record.resourceId, record)
        return json(res, record, 201)
      }

      const verFileMatch = /^\/internal\/v1\/plugins\/([^/]+)\/versions\/([^/]+)(\/file)?$/.exec(path)
      if (verFileMatch && req.method === 'GET') {
        const resourceId = decodeURIComponent(verFileMatch[1])
        const version = decodeURIComponent(verFileMatch[2])
        const isFile = Boolean(verFileMatch[3])
        const item = findItem(resourceId)
        check(item, 404, 'NOT_FOUND')
        const ver = item.versions.find(v => v.version === version)
        check(ver, 404, 'NOT_FOUND')
        if (!isFile) {
          return json(res, {
            resourceId: item.resourceId,
            uniqueIdentifier: item.uniqueIdentifier,
            version: ver.version,
            sha256: ver.sha256,
            sizeBytes: ver.sizeBytes,
          })
        }
        const bytes = readVersionBytes(item, ver)
        res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': bytes.length})
        return res.end(bytes)
      }

      const itemMatch = /^\/internal\/v1\/plugins\/([^/]+)(?:\/(versions))?$/.exec(path)
      check(itemMatch, 404, 'NOT_FOUND')
      const resourceId = decodeURIComponent(itemMatch[1])
      const sub = itemMatch[2]
      const item = findItem(resourceId)
      check(item, 404, 'NOT_FOUND')

      if (!sub && req.method === 'GET') {
        const {versions: _v, ...summary} = item
        return json(res, summary)
      }
      if (sub === 'versions' && req.method === 'GET') {
        return json(res, {
          resourceId: item.resourceId,
          revision: item.revision,
          versions: item.versions.map(({blobName: _b, seed: _s, empty: _e, ...v}) => v),
        })
      }
      if (sub === 'versions' && req.method === 'PUT') {
        const input = await body(req)
        if (input.expectedRevision !== undefined && input.expectedRevision !== null) {
          check(item.revision === input.expectedRevision, 409, 'STALE_SNAPSHOT', '插件目录修订已变化')
        }
        if (input.uniqueIdentifier) {
          check(input.uniqueIdentifier === item.uniqueIdentifier, 409, 'PLUGIN_IDENTITY_MISMATCH')
        }
        check(
          typeof input.version === 'string' && input.version.trim() && typeof input.contentBase64 === 'string',
          400,
          'INVALID_REQUEST',
        )
        check(!item.versions.some(v => v.version === input.version), 409, 'VERSION_ALREADY_PUBLISHED')
        const blob = writeBlob(item.resourceId, input.version, input.contentBase64)
        if (input.sha256) check(blob.sha256 === input.sha256, 409, 'STALE_SNAPSHOT')
        const ver = {
          version: input.version,
          sha256: blob.sha256,
          sizeBytes: blob.sizeBytes,
          blobName: blob.blobName,
          status: 'approved',
          publishedAt: new Date().toISOString(),
        }
        const updated = {
          ...item,
          version: ver.version,
          sha256: ver.sha256,
          sizeBytes: ver.sizeBytes,
          upgradePolicy: input.upgradePolicy || item.upgradePolicy,
          revision: item.revision + 1,
          versions: [...item.versions, ver],
        }
        catalogStore.put(item.resourceId, updated)
        return json(res, updated)
      }
      check(false, 405, 'METHOD_NOT_ALLOWED')
    },
    {...options, close: catalogStore.close},
  )
}
