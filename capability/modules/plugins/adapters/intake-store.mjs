import {randomUUID} from 'node:crypto'
import {inspectPluginArchive} from './package-archive.mjs'
import {check, digest} from '../../../../runtime/http.mjs'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const EICAR_SIGNATURE = Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')

export async function readMultipartPlugin(req) {
  const contentType = req.headers['content-type'] ?? ''
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  check(boundaryMatch, 400, 'INVALID_UPLOAD_FORMAT', '缺少 multipart boundary')
  const boundary = boundaryMatch[1] || boundaryMatch[2]
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    check(total <= MAX_UPLOAD_BYTES, 413, 'UPLOAD_TOO_LARGE', '插件包超过 50MB 限制')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks)
  const delim = Buffer.from('--' + boundary)
  let pos = raw.indexOf(delim)
  check(pos !== -1, 400, 'INVALID_UPLOAD_FORMAT')

  while (pos !== -1) {
    const start = pos + delim.length
    if (raw[start] === 45 && raw[start + 1] === 45) break
    const next = raw.indexOf(delim, start)
    if (next === -1) break
    const partStart = raw[start] === 13 && raw[start + 1] === 10 ? start + 2 : start
    const partEnd = raw[next - 2] === 13 && raw[next - 1] === 10 ? next - 2 : next
    const part = raw.subarray(partStart, partEnd)
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString('utf8')
      const fnMatch = /filename="([^"]+)"/i.exec(headerText)
      if (fnMatch) {
        const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText)
        return {
          filename: fnMatch[1],
          contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
          bytes: Buffer.from(part.subarray(headerEnd + 4)),
        }
      }
    }
    pos = next
  }
  check(false, 400, 'MISSING_UPLOAD_FILE', '请求中未找到插件上传文件')
}

export function parsePluginMetadata(bytes, _filename) {
  try {return inspectPluginArchive(bytes)} catch {return null}
}

export function storePluginIntake(db, {idempotencyKey, identity, filename, contentType, bytes}) {
  const sha256 = digest(bytes)
  const idemKey = 'idem:' + idempotencyKey
  const existingRef = db.get(idemKey)
  if (existingRef) {
    const existing = db.get(existingRef.intakeId)
    check(existing, 500, 'INTAKE_STATE_CORRUPT')
    check(
      existing.ownerAccount === identity.account || (existing.ownerSubjectId && existing.ownerSubjectId === identity.subjectId),
      409,
      'INTAKE_OWNER_CONFLICT',
    )
    check(existing.sha256 === sha256 && existing.filename === filename, 409, 'IDEMPOTENCY_CONFLICT')
    return {record: existing, created: false}
  }

  const checkedAt = new Date().toISOString()
  let status = 'ready'
  const findings = []
  let packageMetadata = null
  if (!bytes || bytes.length === 0) {
    status = 'rejected'
    findings.push('插件包不能为空')
  } else if (bytes.includes(EICAR_SIGNATURE)) {
    status = 'rejected'
    findings.push('检测到恶意测试特征码')
  } else {
    try {packageMetadata = inspectPluginArchive(bytes)} catch (error) {
      status = 'rejected'
      findings.push(error.code || 'INVALID_PLUGIN_ARCHIVE')
    }
  }

  const intakeId = 'plg-in-' + randomUUID().slice(0, 12)
  const record = {
    intakeId,
    kind: 'plugin',
    status,
    sha256,
    sizeBytes: bytes.length,
    filename,
    contentType,
    scan: {verdict: status === 'ready' ? 'passed' : 'rejected', checkedAt, findings},
    packageMetadata,
    ownerAccount: identity.account,
    ownerSubjectId: identity.subjectId || null,
    contentBase64: bytes.toString('base64'),
    createdAt: checkedAt,
  }
  db.put(intakeId, record)
  db.put(idemKey, {intakeId})
  return {record, created: true}
}

export function projectPluginIntake(record) {
  return {
    intakeId: record.intakeId,
    status: record.status,
    sha256: record.sha256,
    sizeBytes: record.sizeBytes,
    filename: record.filename,
    scan: record.scan,
    packageMetadata: record.packageMetadata,
  }
}
