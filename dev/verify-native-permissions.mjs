import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {liveProducts, readLocalProducts} from './live-verification/products.mjs'
import {grantDifySameWorkspaceAccess, revokeDifyDatasetAccess} from '../capability/modules/knowledge/adapters/dify-datasets.mjs'

const dir = resolve(process.env.APP_DATA_DIR ?? '.local-data')
const config = readLocalProducts(resolve(dir, 'local-products.json'))
Object.assign(process.env, {DIFY_API_BASE: config.dify.base, DIFY_CONSOLE_TOKEN: config.dify.token, DIFY_WORKSPACE_ID: config.dify.workspaceId})
const products = liveProducts({dir, credentials: config})
const report = {runId: products.runId, generatedAt: new Date().toISOString(), scope: 'native ACL protocol against an owned test dataset; not full KB-03 acceptance', checks: [], ok: false}
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
try {
  const datasetId = await products.dataset('dify')
  const members = await products.api('dify', '/console/api/workspaces/current/members')
  const initial = await products.api('dify', `/console/api/datasets/${datasetId}`)
  // Verify actual product UUID mapping; a separate non-owner login is still required by full acceptance.
  const owner = members.accounts.find(account => account.id === initial.created_by && account.status === 'active')
  assert.ok(owner)
  const command = {datasetId, workspaceId: config.dify.workspaceId, granteeAccount: owner.id, permission: '检索使用'}
  const grant = await grantDifySameWorkspaceAccess(command)
  const after = await products.api('dify', `/console/api/datasets/${datasetId}`)
  assert.equal(after.permission, 'partial_members')
  assert.deepEqual(after.partial_member_list, grant.addedMemberIds)
  assert.deepEqual(after.retrieval_model_dict, initial.retrieval_model_dict)
  assert.equal(after.name, initial.name); assert.equal(after.description, initial.description)
  report.checks.push({name: 'specified member grant and unrelated configuration preservation', datasetId, beforePermission: initial.permission,
    afterPermission: after.permission, memberIds: after.partial_member_list, retrievalFingerprint: fingerprint(after.retrieval_model_dict)})
  const repeated = await grantDifySameWorkspaceAccess(command)
  assert.deepEqual(repeated.addedMemberIds, [])
  await revokeDifyDatasetAccess({...command, grantRef: repeated})
  const stillGranted = await products.api('dify', `/console/api/datasets/${datasetId}`)
  assert.deepEqual(stillGranted.partial_member_list, after.partial_member_list)
  report.checks.push({name: 'no ownership over preexisting membership; no removal', datasetId, permission: stillGranted.permission, memberIds: stillGranted.partial_member_list})
  await revokeDifyDatasetAccess({...command, grantRef: grant})
  const revoked = await products.api('dify', `/console/api/datasets/${datasetId}`)
  assert.equal(revoked.permission, 'only_me')
  assert.deepEqual(revoked.retrieval_model_dict, initial.retrieval_model_dict)
  report.checks.push({name: 'remove only owned membership and restore only_me', datasetId, permission: revoked.permission, retrievalFingerprint: fingerprint(revoked.retrieval_model_dict)})
  report.ok = true
} catch (error) {
  report.error = {code: error.code ?? 'CHECK_FAILED', message: error.code === 'ERR_ASSERTION' ? 'Product state readback assertion failed' : error.message}
} finally {
  report.cleanupOk = await products.close()
  report.ok = report.ok && report.cleanupOk
  report.finishedAt = new Date().toISOString()
  const content = JSON.stringify(report, null, 2) + '\n'
  writeFileSync(resolve(dir, `live-native-permissions-${products.runId}.json`), content)
  writeFileSync(resolve(dir, 'live-native-permissions-report.json'), content)
}
console.log(`Native permission readback ${report.checks.length}/3; cleanup ${report.cleanupOk ? 'PASS' : 'FAIL'}; ${report.ok ? 'PASS' : 'FAIL'}`)
if (!report.ok) {console.error(report.error?.code ?? 'CHECK_FAILED'); process.exitCode = 1}
