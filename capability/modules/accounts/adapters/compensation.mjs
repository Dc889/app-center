import {same, id} from '../../../../runtime/http.mjs'
import {
  listDifyMembers,
  listRagflowUsers,
  findMatchingAccount,
  buildBaselineFact,
  updateRagflowUser,
  deleteRagflowUser,
  updateDifyMember,
  deleteDifyMember,
} from './account-products.mjs'

export async function readLiveAccountFacts({subjectId, ragflowAccountId, difyAccountId, fallbackAccount, workspaceId}) {
  const [ragUsers, difyMembers] = await Promise.all([listRagflowUsers(), listDifyMembers(workspaceId)])
  const ragAccount = findMatchingAccount(ragUsers, {accountId: ragflowAccountId, subjectId, account: fallbackAccount})
  const difyAccount = findMatchingAccount(difyMembers, {accountId: difyAccountId, subjectId, account: fallbackAccount})
  return buildBaselineFact({ragAccount, difyAccount, fallbackAccount, workspaceId})
}

export function extractPreconditionRevision(preconditions, kind, subjectId) {
  const found = (preconditions ?? []).filter(p => p.kind === kind && p.id === subjectId)
  return found.length === 1 && Number.isSafeInteger(found[0].revision) && found[0].revision >= 0 ? found[0].revision : null
}

export async function compensateProducts({baseline, createdRagId, createdDifyId, ragMutated, difyMutated, steps = []}) {
  const errors = []
  const changes = product => new Set(steps.filter(step => step.product === product && step.state === 'acknowledged').map(step => step.operation))
  if (difyMutated) {
    try {
      if (createdDifyId) {
        await deleteDifyMember({accountId: createdDifyId, workspaceId: baseline.dify.workspaceId})
      } else if (baseline.dify.accountId) {
        const touched = changes('dify')
        if (!touched.size) throw Object.assign(new Error('缺少本次写入范围，不能覆盖产品字段'), {code: 'MISSING_COMPENSATION_SCOPE'})
        await updateDifyMember({
          accountId: baseline.dify.accountId,
          workspaceId: baseline.dify.workspaceId,
          ...(touched.has('rename') ? {account: baseline.dify.account} : {}),
          ...(touched.has('role') ? {role: baseline.dify.role} : {}),
          ...(touched.has('disable') ? {active: baseline.dify.active} : {}),
        })
      }
    } catch (err) {
      errors.push({product: 'dify', code: err.code ?? 'COMPENSATION_FAILED', message: err.message})
    }
  }
  if (ragMutated) {
    try {
      if (createdRagId) {
        await deleteRagflowUser({accountId: createdRagId})
      } else if (baseline.ragflow.accountId) {
        const touched = changes('ragflow')
        if (!touched.size) throw Object.assign(new Error('缺少本次写入范围，不能覆盖产品字段'), {code: 'MISSING_COMPENSATION_SCOPE'})
        await updateRagflowUser({
          accountId: baseline.ragflow.accountId,
          ...(touched.has('rename') ? {account: baseline.ragflow.account} : {}),
          ...(touched.has('role') ? {permission: baseline.ragflow.permission} : {}),
          ...(touched.has('disable') ? {active: baseline.ragflow.active} : {}),
        })
      }
    } catch (err) {
      errors.push({product: 'ragflow', code: err.code ?? 'COMPENSATION_FAILED', message: err.message})
    }
  }
  return errors
}

export async function sealFailedAccountExecution({
  recoveryLedger,
  record,
  subjectId,
  baseline,
  createdRagId,
  createdDifyId,
  ragMutated,
  difyMutated,
}) {
  const uncertain = record.uncertainWrites || record.commitPhase === 'pending' ||
    record.steps?.some(step => ['dispatching', 'unknown'].includes(step.state))
  const compErrors = uncertain ? [{code: 'UNCONFIRMED_ACCOUNT_WRITE', message: '原请求可能继续生效，禁止自动回滚或封存解锁'}]
    : await compensateProducts({baseline, createdRagId, createdDifyId, ragMutated, difyMutated, steps: record.steps})
  let liveProducts = null
  let restored = false
  try {
    liveProducts = await readLiveAccountFacts({
      subjectId,
      ragflowAccountId: baseline.ragflow.accountId,
      difyAccountId: baseline.dify.accountId,
      fallbackAccount: baseline.ragflow.account,
      workspaceId: baseline.dify.workspaceId,
    })
    restored = !uncertain && compErrors.length === 0 && same(liveProducts, baseline)
  } catch {
    restored = false
  }
  const sealed = restored && compErrors.length === 0
  const updated = {
    ...record,
    sealed,
    sealedAt: sealed ? new Date().toISOString() : null,
    proofId: record.proofId ?? `acc-proof-${id()}`,
    compensationErrors: compErrors,
    updatedAt: new Date().toISOString(),
  }
  recoveryLedger.put(record.executionId, updated)
  return {sealed, restored, compErrors, proofId: updated.proofId}
}
