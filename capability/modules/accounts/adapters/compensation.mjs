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
  const found = (preconditions ?? []).find(p => p.kind === kind && p.id === subjectId)
  return Number.isInteger(found?.revision) ? found.revision : null
}

export async function compensateProducts({baseline, createdRagId, createdDifyId, ragMutated, difyMutated}) {
  const errors = []
  if (difyMutated) {
    try {
      if (createdDifyId) {
        await deleteDifyMember({accountId: createdDifyId, workspaceId: baseline.dify.workspaceId})
      } else if (baseline.dify.accountId) {
        await updateDifyMember({
          accountId: baseline.dify.accountId,
          workspaceId: baseline.dify.workspaceId,
          account: baseline.dify.account,
          role: baseline.dify.role,
          active: baseline.dify.active,
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
        await updateRagflowUser({
          accountId: baseline.ragflow.accountId,
          account: baseline.ragflow.account,
          permission: baseline.ragflow.permission,
          active: baseline.ragflow.active,
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
  const compErrors = await compensateProducts({baseline, createdRagId, createdDifyId, ragMutated, difyMutated})
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
    restored = compErrors.length === 0 && same(liveProducts, baseline)
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
