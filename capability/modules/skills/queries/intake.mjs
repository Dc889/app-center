import {check, json} from '../../../../runtime/http.mjs'
import {projectIntake, readMultipartFile, storeSkillIntake} from '../adapters/intake-store.mjs'

export async function uploadSkillIntake({req, res, identity, openLedger}) {
  const idempotencyKey = req.headers['idempotency-key']
  check(typeof idempotencyKey === 'string' && idempotencyKey.length > 0 && idempotencyKey.length <= 200, 400, 'UPLOAD_KEY_REQUIRED')
  const file = await readMultipartFile(req)
  const db = openLedger('intake')
  const {record, created} = storeSkillIntake(db, {
    idempotencyKey,
    identity,
    filename: file.filename,
    contentType: file.contentType,
    bytes: file.bytes,
  })
  return json(res, {intakeId: record.intakeId, status: record.status}, created ? 201 : 200)
}

export async function getSkillIntake({res, params, identity, openLedger}) {
  const db = openLedger('intake')
  const record = db.get(params.intakeId)
  const isOwner =
    record &&
    (record.ownerAccount === identity.account ||
      (record.ownerSubjectId && identity.subjectId && record.ownerSubjectId === identity.subjectId) ||
      ['operator', 'admin'].includes(identity.role))
  check(isOwner, 404, 'NOT_FOUND', '上传记录不存在或无权读取')
  return json(res, projectIntake(record))
}
