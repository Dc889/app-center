import {check, same} from '../../../../runtime/http.mjs'
import {commitManagementAccountChange} from './account-products.mjs'
import {readLiveAccountFacts} from './compensation.mjs'

const save = (db, record) => {record.updatedAt = new Date().toISOString(); db.put(record.executionId, record)}

// Persist uncertainty before dispatch. A process restart cannot repeat a product write.
export function beginAccountTransaction({command, row, state, store, openLedger}, record) {
  save(openLedger('recovery'), record)
  state.status = 'reconciling'
  state.result = null
  store.put(command.executionId, row)
}

export async function productStep(db, record, product, operation, write) {
  const step = {product, operation, state: 'dispatching'}
  record.steps ??= []
  record.steps.push(step)
  save(db, record)
  try {
    const result = await write()
    step.state = 'acknowledged'; save(db, record)
    return result
  } catch (error) {
    // A 5xx, timeout, invalid response or lost connection may follow a completed write.
    step.state = error.writeRejected === true ? 'rejected' : 'unknown'
    if (step.state === 'unknown') record.uncertainWrites = true
    save(db, record)
    throw error
  }
}

export async function verifyAccountPostcondition(record, expected) {
  const actual = await readLiveAccountFacts({subjectId: record.subjectId,
    ragflowAccountId: expected.ragflow.accountId, difyAccountId: expected.dify.accountId,
    fallbackAccount: expected.ragflow.account, workspaceId: expected.dify.workspaceId})
  check(same(actual, expected), 409, 'ACCOUNT_WRITE_READBACK_MISMATCH', '产品实际状态与获准结果不一致，不能提交平台身份')
  return actual
}

function finish({row, store, openLedger, stamp = () => new Date().toISOString()}, record, response) {
  check(response?.subjectId === record.subjectId && response.revision === record.identityRevision + 1 &&
    typeof response.committedAt === 'string' && Number.isFinite(Date.parse(response.committedAt)), 502, 'INVALID_ACCOUNT_COMMIT_PROOF')
  openLedger('mappings').put(record.subjectId, record.nextMapping)
  record.committed = true; record.commitPhase = 'confirmed'; record.sealed = true; record.sealedAt = stamp()
  save(openLedger('recovery'), record)
  row.state.status = 'succeeded'; row.state.updatedAt = stamp()
  row.state.result = {ok: true, failureCode: '', failureReason: '', retryable: false,
    resultId: `${record.subjectId}:${record.nextMapping.revision}`, version: String(record.nextMapping.revision), sha256: '',
    details: {...record.resultDetails, 本平台身份修订: response.revision}}
  store.put(row.command.executionId, row)
}

export async function commitVerifiedAccount(context, record, {expected, mapping, details}) {
  const {clients, openLedger} = context
  await verifyAccountPostcondition(record, expected)
  Object.assign(record, {expected, nextMapping: mapping, resultDetails: details, commitPhase: 'pending',
    commitRequest: {subjectId: record.subjectId, ragflowAccountId: mapping.ragflowAccountId,
      difyAccountId: mapping.difyAccountId, workspaceId: mapping.workspaceId}})
  save(openLedger('recovery'), record)
  try {
    const response = await commitManagementAccountChange(clients, record.executionId, record.commitRequest)
    finish(context, record, response)
  } catch {
    // The platform may already have committed. Do not roll back products or retry a write on a GET.
    record.commitPhase = 'pending'; save(openLedger('recovery'), record)
    context.row.state.status = 'reconciling'; context.row.state.result = null
  }
}

export async function reconcileAccountCommit(context) {
  const {row, clients, openLedger} = context
  if (row.state.status !== 'reconciling') return
  const record = openLedger('recovery').get(row.command.executionId)
  if (!record || record.commitPhase !== 'pending' || !record.commitRequest || !record.expected) return
  try {
    const res = await clients.management(`/account-changes/${encodeURIComponent(record.executionId)}/commit`)
    const proof = await res.json()
    check(proof.executionId === record.executionId && same(proof.request, record.commitRequest), 409, 'ACCOUNT_COMMIT_PROOF_MISMATCH')
    await verifyAccountPostcondition(record, record.expected)
    finish(context, record, proof.response)
  } catch {
    // Missing proof, product drift and unavailable upstreams preserve the original execution and locks.
  }
}
