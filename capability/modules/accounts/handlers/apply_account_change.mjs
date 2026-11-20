import {check, id} from '../../../../runtime/http.mjs'
import {
  requireDualAccountUpstreams,
  fetchApprovedAccountInputs,
  commitManagementAccountChange,
  createRagflowUser,
  updateRagflowUser,
  createDifyMember,
  updateDifyMember,
} from '../adapters/account-products.mjs'
import {readLiveAccountFacts, extractPreconditionRevision, sealFailedAccountExecution} from '../adapters/compensation.mjs'

export async function execute({command, state, clients, openLedger}) {
  requireDualAccountUpstreams()
  const approved = await fetchApprovedAccountInputs(clients, command)
  const fields = approved.fields ?? {}
  const preconditions = approved.preconditions ?? []

  const subjectId = command.resourceId
  const identityRevision = extractPreconditionRevision(preconditions, 'identity_mapping', subjectId)
  const productMappingRevision = extractPreconditionRevision(preconditions, 'product_account_mapping', subjectId)
  check(identityRevision !== null && productMappingRevision !== null, 409, 'MISSING_PRECONDITION', '缺少身份或产品映射前置修订')

  const mappingsLedger = openLedger('mappings')
  const recoveryLedger = openLedger('recovery')
  const existing = mappingsLedger.get(subjectId)
  check((existing?.revision ?? 0) === productMappingRevision, 409, 'STALE_SNAPSHOT', '产品账号映射修订已变化')

  const operation = fields['操作类型']
  check(['开通', '停用', '组织变更', '角色变更'].includes(operation), 400, 'INVALID_ACCOUNT_OPERATION')

  const targetAccount = fields['唯一账户名'] ?? fields['原账户名'] ?? existing?.account ?? null
  const workspaceId = fields['Dify workspace ID'] ?? existing?.workspaceId ?? null
  const targetRagPermission = fields['RAGFlow目标权限'] ?? existing?.ragflowPermission ?? '个人'
  const targetDifyRole = fields['Dify目标workspace角色'] ?? existing?.difyRole ?? '成员'

  const baseline = await readLiveAccountFacts({
    subjectId,
    ragflowAccountId: existing?.ragflowAccountId ?? null,
    difyAccountId: existing?.difyAccountId ?? null,
    fallbackAccount: targetAccount,
    workspaceId,
  })

  const recoveryRecord = {
    executionId: command.executionId,
    ticketNo: command.ticketNo,
    subjectId,
    identityRevision,
    productMappingRevision,
    operation,
    baseline,
    proofId: `acc-proof-${id()}`,
    sealed: false,
    sealedAt: null,
    committed: false,
    updatedAt: new Date().toISOString(),
  }
  recoveryLedger.put(command.executionId, recoveryRecord)

  let ragMutated = false
  let difyMutated = false
  let createdRagId = null
  let createdDifyId = null
  let finalRagId = baseline.ragflow.accountId
  let finalDifyId = baseline.dify.accountId
  let finalActive = baseline.ragflow.active
  let finalRagPerm = baseline.ragflow.permission
  let finalDifyRole = baseline.dify.role

  try {
    if (operation === '开通') {
      check(!baseline.ragflow.accountId && !baseline.dify.accountId, 409, 'ACCOUNT_ALREADY_EXISTS', '产品端已存在该账号')
      const createdRag = await createRagflowUser({subjectId, account: targetAccount, permission: targetRagPermission})
      createdRagId = createdRag.accountId
      finalRagId = createdRag.accountId
      ragMutated = true

      const createdDify = await createDifyMember({subjectId, account: targetAccount, workspaceId, role: targetDifyRole})
      createdDifyId = createdDify.accountId
      finalDifyId = createdDify.accountId
      difyMutated = true

      finalActive = true
      finalRagPerm = targetRagPermission
      finalDifyRole = targetDifyRole
    } else if (operation === '停用') {
      check(baseline.ragflow.accountId && baseline.dify.accountId, 409, 'ACCOUNT_NOT_FOUND', '产品端账号不存在')
      await updateRagflowUser({accountId: baseline.ragflow.accountId, active: false})
      ragMutated = true
      await updateDifyMember({accountId: baseline.dify.accountId, workspaceId, active: false})
      difyMutated = true
      finalActive = false
    } else if (operation === '角色变更') {
      check(baseline.ragflow.accountId && baseline.dify.accountId, 409, 'ACCOUNT_NOT_FOUND', '产品端账号不存在')
      await updateRagflowUser({accountId: baseline.ragflow.accountId, permission: targetRagPermission})
      ragMutated = true
      await updateDifyMember({accountId: baseline.dify.accountId, workspaceId, role: targetDifyRole})
      difyMutated = true
      finalRagPerm = targetRagPermission
      finalDifyRole = targetDifyRole
    } else if (operation === '组织变更') {
      check(baseline.ragflow.accountId && baseline.dify.accountId, 409, 'ACCOUNT_NOT_FOUND', '产品端账号不存在')
    }

    const commitRes = await commitManagementAccountChange(clients, command.executionId, {
      subjectId,
      ragflowAccountId: finalRagId,
      difyAccountId: finalDifyId,
      workspaceId,
    })

    const nextRevision = productMappingRevision + 1
    mappingsLedger.put(subjectId, {
      subjectId,
      account: targetAccount,
      ragflowAccountId: finalRagId,
      difyAccountId: finalDifyId,
      workspaceId,
      active: finalActive,
      ragflowPermission: finalRagPerm,
      difyRole: finalDifyRole,
      revision: nextRevision,
      updatedAt: new Date().toISOString(),
    })
    recoveryLedger.put(command.executionId, {
      ...recoveryRecord,
      committed: true,
      sealed: true,
      sealedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    state.status = 'succeeded'
    state.result = {
      ok: true,
      failureCode: '',
      failureReason: '',
      retryable: false,
      resultId: `${subjectId}:${nextRevision}`,
      version: String(nextRevision),
      sha256: '',
      details: {
        目标人员ID: subjectId,
        操作类型: operation,
        RAGFlow账户ID: finalRagId,
        Dify账户ID: finalDifyId,
        'Dify workspace ID': workspaceId,
        本平台身份修订: commitRes?.revision ?? null,
      },
    }
  } catch (err) {
    const sealedInfo = await sealFailedAccountExecution({
      recoveryLedger,
      record: recoveryRecord,
      subjectId,
      baseline,
      createdRagId,
      createdDifyId,
      ragMutated,
      difyMutated,
    })
    state.status = 'failed'
    state.result = {
      ok: false,
      failureCode: err.code ?? 'UPSTREAM_ERROR',
      failureReason: err.message ?? '双端账号变更执行失败',
      retryable: false,
      resultId: '',
      version: '',
      sha256: '',
      details: {
        compensated: sealedInfo.restored,
        sealed: sealedInfo.sealed,
        proofId: sealedInfo.proofId,
      },
    }
  }
}
