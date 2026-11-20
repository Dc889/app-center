import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {body, check, digest, json, ledger, listen, prefix, same} from '../../../runtime/http.mjs'

export function startSkill(options) {
  const store = ledger(options.dir, 'skill')
  const catalogStore = ledger(options.dir, 'skill-catalog')
  const objectsDir = join(options.dir, 'skill-objects')
  mkdirSync(objectsDir, {recursive: true})

  function mergedItems() {
    const map = new Map()
    for (const persisted of catalogStore.all()) {
      map.set(persisted.resourceId, persisted)
    }
    return [...map.values()]
  }

  function findItem(resourceId) {
    const persisted = catalogStore.get(resourceId)
    if (persisted) return persisted
    return mergedItems().find(i => i.resourceId === resourceId) ?? null
  }

  function readVersionBytes(item, versionName) {
    const ver = item.versions?.find(v => v.version === versionName)
    check(ver, 404, 'VERSION_NOT_FOUND')
    const bytes = readFileSync(join(objectsDir, ver.blobName))
    return {
      bytes,
      sha256: digest(bytes),
      sizeBytes: bytes.length,
      filename: ver.filename || `${item.resourceId}-${ver.version}.bin`,
      contentType: ver.contentType || 'application/octet-stream',
    }
  }

  function writeBlob(resourceId, version, base64Content) {
    const bytes = Buffer.from(base64Content, 'base64')
    const blobName = `${resourceId.replace(/[^\w-]/g, '_')}_${version.replace(/[^\w.-]/g, '_')}_${digest(bytes).slice(0, 12)}.bin`
    writeFileSync(join(objectsDir, blobName), bytes)
    return {blobName, sha256: digest(bytes), sizeBytes: bytes.length}
  }

  return listen(
    async (req, res, path) => {
      if (req.method === 'GET' && path === prefix + '/skills') {
        const items = mergedItems().map(({versions: _versions, ...summary}) => summary)
        return json(res, {items, nextCursor: null})
      }

      if (req.method === 'POST' && path === prefix + '/skills') {
        const input = await body(req)
        check(
          input &&
            typeof input.resourceId === 'string' &&
            /^[\w-]+$/.test(input.resourceId) &&
            typeof input.name === 'string' &&
            input.name.trim() &&
            typeof input.version === 'string' &&
            input.version.trim() &&
            typeof input.contentBase64 === 'string',
          400,
          'INVALID_REQUEST',
        )
        check(!findItem(input.resourceId), 409, 'SKILL_ALREADY_EXISTS', '该 Skill 目录 ID 已存在')
        const blob = writeBlob(input.resourceId, input.version, input.contentBase64)
        if (input.sha256) check(blob.sha256 === input.sha256, 409, 'STALE_SNAPSHOT', '文件内容摘要与审批指纹不一致')
        const versionEntry = {
          version: input.version,
          sha256: blob.sha256,
          sizeBytes: blob.sizeBytes,
          filename: input.filename || `${input.resourceId}.bin`,
          contentType: input.contentType || 'application/octet-stream',
          blobName: blob.blobName,
          status: 'available',
          publishedAt: new Date().toISOString(),
        }
        const record = {
          resourceId: input.resourceId,
          name: input.name.trim(),
          version: input.version,
          sha256: blob.sha256,
          sizeBytes: blob.sizeBytes,
          filename: versionEntry.filename,
          contentType: versionEntry.contentType,
          orgs: Array.isArray(input.orgs) ? input.orgs : [],
          ownerAccount: input.ownerAccount ?? '',
          status: 'available',
          revision: 1,
          versions: [versionEntry],
        }
        catalogStore.put(record.resourceId, record)
        return json(res, record, 201)
      }

      const skillSub = /^\/internal\/v1\/skills\/([^/]+)(?:\/(versions|withdraw|stats))?$/.exec(path)
      if (skillSub) {
        const resourceId = decodeURIComponent(skillSub[1])
        const sub = skillSub[2]
        const item = findItem(resourceId)
        check(item, 404, 'NOT_FOUND')

        if (!sub && req.method === 'GET') {
          const requestedVersion = new URL(req.url, 'http://localhost').searchParams.get('version')
          if (!requestedVersion) {
            const {versions: _v, ...summary} = item
            return json(res, summary)
          }
          const ver = item.versions.find(v => v.version === requestedVersion)
          check(ver, 404, 'VERSION_NOT_FOUND')
          return json(res, {
            resourceId: item.resourceId,
            name: item.name,
            version: ver.version,
            sha256: ver.sha256,
            sizeBytes: ver.sizeBytes,
            orgs: item.orgs,
            ownerAccount: item.ownerAccount,
            status: item.status === 'withdrawn' ? 'withdrawn' : ver.status,
            revision: item.revision,
          })
        }

        if (sub === 'versions' && req.method === 'GET') {
          return json(res, {
            resourceId: item.resourceId,
            revision: item.revision,
            versions: item.versions.map(({blobName: _b, ...v}) => v),
          })
        }

        if (sub === 'versions' && req.method === 'PUT') {
          const input = await body(req)
          check(item.status !== 'withdrawn', 409, 'SKILL_WITHDRAWN', '已下架 Skill 不能变更版本')
          if (input.expectedRevision !== undefined && input.expectedRevision !== null) {
            check(item.revision === input.expectedRevision, 409, 'STALE_SNAPSHOT', 'Skill 目录修订已变化')
          }
          check(
            typeof input.version === 'string' && input.version.trim() && typeof input.contentBase64 === 'string',
            400,
            'INVALID_REQUEST',
          )
          check(!item.versions.some(v => v.version === input.version), 409, 'VERSION_ALREADY_PUBLISHED')
          const blob = writeBlob(item.resourceId, input.version, input.contentBase64)
          if (input.sha256) check(blob.sha256 === input.sha256, 409, 'STALE_SNAPSHOT')
          const disableHistory = input.historyPolicy === '禁止历史版本下载' || input.historyPolicy === 'disable_history'
          const updatedVersions = item.versions.map(v => ({
            ...v,
            status: disableHistory ? 'unavailable' : v.status,
          }))
          const nextVer = {
            version: input.version,
            sha256: blob.sha256,
            sizeBytes: blob.sizeBytes,
            filename: input.filename || `${item.resourceId}-${input.version}.bin`,
            contentType: input.contentType || 'application/octet-stream',
            blobName: blob.blobName,
            status: 'available',
            publishedAt: new Date().toISOString(),
          }
          updatedVersions.push(nextVer)
          const updated = {
            ...item,
            version: nextVer.version,
            sha256: nextVer.sha256,
            sizeBytes: nextVer.sizeBytes,
            filename: nextVer.filename,
            contentType: nextVer.contentType,
            revision: item.revision + 1,
            versions: updatedVersions,
          }
          catalogStore.put(item.resourceId, updated)
          return json(res, updated)
        }

        if (sub === 'withdraw' && req.method === 'POST') {
          const input = await body(req)
          if (input?.expectedRevision !== undefined && input?.expectedRevision !== null) {
            check(item.revision === input.expectedRevision, 409, 'STALE_SNAPSHOT', 'Skill 目录修订已变化')
          }
          check(item.status !== 'withdrawn', 409, 'ALREADY_WITHDRAWN')
          const updated = {
            ...item,
            status: 'withdrawn',
            withdrawnAt: new Date().toISOString(),
            revision: item.revision + 1,
            // 保留全部历史版本元数据与文件作为审计副本
            auditCopyPreserved: true,
          }
          catalogStore.put(item.resourceId, updated)
          return json(res, updated)
        }

        if (sub === 'stats' && req.method === 'GET') {
          const completed = store.all().filter(r => r.input?.resourceId === resourceId && r.deliveredAt)
          const accounts = new Set(completed.map(r => r.input?.account).filter(Boolean))
          return json(res, {resourceId, downloadCount: completed.length, uniqueAccounts: accounts.size})
        }
      }

      if (req.method === 'POST' && path === prefix + '/deliveries') {
        check(req.headers['idempotency-key'], 400, 'INVALID_REQUEST', '缺少 Idempotency-Key')
        const input = await body(req)
        const item = findItem(input.resourceId)
        check(item && item.status !== 'withdrawn', 403, 'ACCESS_DENIED', '该 Skill 已下架或不存在')
        check(!item.orgs.length || item.orgs.includes(input.org), 403, 'ACCESS_DENIED', '不在下载范围内')
        const ver = item.versions.find(v => v.version === input.version)
        check(ver && ver.status !== 'unavailable' && ver.status !== 'withdrawn', 403, 'VERSION_UNAVAILABLE', '目标版本不可下载')
        const obj = readVersionBytes(item, ver.version)
        check(obj.sha256 === input.sha256, 409, 'STALE_SNAPSHOT')
        const resultId = 'DL-' + input.executionId
        const previous = store.get(resultId)
        if (previous) {
          check(same(previous.input, input), 409, 'EXECUTION_CONFLICT')
          return json(res, previous.delivery)
        }
        const delivery = {
          resultId,
          version: ver.version,
          sha256: obj.sha256,
          filename: obj.filename,
          contentType: obj.contentType,
          sizeBytes: obj.sizeBytes,
        }
        store.put(resultId, {input, delivery, deliveredAt: null})
        return json(res, delivery)
      }

      const match = /^\/internal\/v1\/deliveries\/([^/]+)\/(file|receipt|cancel)$/.exec(path)
      const row = match && store.get(match[1])
      check(row, 404, 'NOT_FOUND')
      const d = row.delivery
      if (req.method === 'POST' && match[2] === 'cancel') {
        check(!row.deliveredAt, 409, 'ALREADY_DELIVERED', '文件已完成交付回执，不可取消')
        const cancelledAt = row.cancelledAt ?? new Date().toISOString()
        if (!row.cancelledAt) store.put(d.resultId, {...row, cancelledAt})
        return json(res, {resultId: d.resultId, cancelledAt})
      }
      if (req.method === 'GET' && match[2] === 'file') {
        check(!row.cancelledAt, 409, 'DELIVERY_CANCELLED', '该交付预留已取消')
        const item = findItem(row.input.resourceId)
        check(item && (!item.orgs.length || item.orgs.includes(row.input.org)), 403, 'ACCESS_DENIED')
        const file = readVersionBytes(item, d.version)
        check(file.sha256 === d.sha256, 409, 'STALE_SNAPSHOT')
        res.writeHead(200, {
          'content-length': d.sizeBytes,
          'content-type': d.contentType,
          'content-disposition': 'attachment; filename="' + d.filename + '"',
          'x-content-sha256': d.sha256,
        })
        return res.end(file.bytes)
      }
      check(req.method === 'PUT' && match[2] === 'receipt', 405, 'METHOD_NOT_ALLOWED')
      check(!row.cancelledAt, 409, 'DELIVERY_CANCELLED', '该交付预留已取消')
      const receipt = await body(req)
      check(receipt.sha256 === d.sha256 && receipt.bytesSent === d.sizeBytes, 409, 'INVALID_RECEIPT')
      const current = store.get(d.resultId)
      if (!current.deliveredAt) store.put(d.resultId, {...current, deliveredAt: new Date().toISOString()})
      json(res, {resultId: d.resultId, deliveredAt: store.get(d.resultId).deliveredAt})
    },
    {
      ...options,
      close() {
        catalogStore.close()
        store.close()
      },
    },
  )
}
