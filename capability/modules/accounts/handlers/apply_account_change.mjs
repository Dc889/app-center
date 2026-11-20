import {check, id, same} from '../../../../runtime/http.mjs'
import {
  requireDualAccountUpstreams,
  fetchApprovedAccountInputs,
  createRagflowUser,
  updateRagflowUser,
  createDifyMember,
  updateDifyMember,
} from '../adapters/account-products.mjs'
import {readLiveAccountFacts, extractPreconditionRevision, sealFailedAccountExecution} from '../adapters/compensation.mjs'
import {beginAccountTransaction, productStep, commitVerifiedAccount} from '../adapters/account-transaction.mjs'

export async function execute(context) {
  const {command, state, clients, openLedger} = context
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
  const targetRagPermission = fields['RAGFlow目标权限']
  const targetDifyRole = fields['Dify目标workspace角色']
  check(typeof targetAccount === 'string' && targetAccount.trim(), 400, 'MISSING_ACCOUNT_NAME')
  if (['开通', '角色变更'].includes(operation)) check(['个人', '团队成员', '管理员'].includes(targetRagPermission) &&
    ['成员', '编辑', '管理员'].includes(targetDifyRole), 400, 'MISSING_ACCOUNT_PERMISSIONS')

  const baseline = await readLiveAccountFacts({
    subjectId,
    ragflowAccountId: existing?.ragflowAccountId ?? approved.recoveryBaseline?.ragflow?.accountId ?? null,
    difyAccountId: existing?.difyAccountId ?? approved.recoveryBaseline?.dify?.accountId ?? null,
    fallbackAccount: targetAccount,
    workspaceId,
  })
  check(approved.recoveryBaseline, 501, 'RECOVERY_BASELINE_REQUIRED', '缺少审批时冻结的产品基线，禁止写入')
  check(same(approved.recoveryBaseline, baseline), 409, 'STALE_ACCOUNT_BASELINE', '审批后的真实产品状态已变化，禁止用新读值覆盖冻结基线')
  if (operation !== '开通') check(baseline.ragflow.active === baseline.dify.active, 409, 'STALE_ACCOUNT_FACTS', '两端可用状态不一致')

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
  beginAccountTransaction(context, recoveryRecord)
  const write = (product, action, fn) => productStep(recoveryLedger, recoveryRecord, product, action, fn)

  let ragMutated = false
  let difyMutated = false
  let createdRagId = null
  let createdDifyId = null
  let finalRagId = baseline.ragflow.accountId
  let finalDifyId = baseline.dify.accountId
  let finalRagAccount = baseline.ragflow.account
  let finalDifyAccount = baseline.dify.account
  let finalActive = baseline.ragflow.active
  let finalRagPerm = baseline.ragflow.permission
  let finalDifyRole = baseline.dify.role

  try {
    if (operation === '开通') {
      check(!baseline.ragflow.accountId && !baseline.dify.accountId, 409, 'ACCOUNT_ALREADY_EXISTS', '产品端已存在该账号')
      const createdRag = await write('ragflow', 'create', () => createRagflowUser({subjectId, account: targetAccount, permission: targetRagPermission}))
      createdRagId = createdRag.accountId
      finalRagId = createdRag.accountId
      finalRagAccount = createdRag.account ?? targetAccount
      ragMutated = true

      const createdDify = await write('dify', 'create', () => createDifyMember({subjectId, account: targetAccount, workspaceId, role: targetDifyRole}))
      createdDifyId = createdDify.accountId
      finalDifyId = createdDify.accountId
      finalDifyAccount = createdDify.account ?? targetAccount
      difyMutated = true

      finalActive = true
      finalRagPerm = targetRagPermission
      finalDifyRole = targetDifyRole
    } else if (operation === '停用') {
      check(baseline.ragflow.accountId && baseline.dify.accountId, 409, 'ACCOUNT_NOT_FOUND', '产品端账号不存在')
      await write('ragflow', 'disable', () => updateRagflowUser({accountId: baseline.ragflow.accountId, active: false}))
      ragMutated = true
      await write('dify', 'disable', () => updateDifyMember({accountId: baseline.dify.accountId, workspaceId, active: false}))
      difyMutated = true
      finalActive = false
    } else if (operation === '角色变更') {
      check(baseline.ragflow.accountId && baseline.dify.accountId, 409, 'ACCOUNT_NOT_FOUND', '产品端账号不存在')
      await write('ragflow', 'role', () => updateRagflowUser({accountId: baseline.ragflow.accountId, permission: targetRagPermission}))
      ragMutated = true
      await write('dify', 'role', () => updateDifyMember({accountId: baseline.dify.accountId, workspaceId, role: targetDifyRole}))
      difyMutated = true
      finalRagPerm = targetRagPermission
      finalDifyRole = targetDifyRole
    } else if (operation === '组织变更') {
      check(baseline.ragflow.accountId && baseline.dify.accountId, 409, 'ACCOUNT_NOT_FOUND', '产品端账号不存在')
    }

    const nextRevision = productMappingRevision + 1
    await commitVerifiedAccount(context, recoveryRecord, {
      expected: {ragflow: {accountId: finalRagId, account: finalRagAccount, active: finalActive, permission: finalRagPerm},
        dify: {accountId: finalDifyId, workspaceId, account: finalDifyAccount, active: finalActive, role: finalDifyRole}},
      mapping: {subjectId, account: targetAccount, ragflowAccountId: finalRagId, difyAccountId: finalDifyId, workspaceId,
        active: finalActive, ragflowPermission: finalRagPerm, difyRole: finalDifyRole, revision: nextRevision,
        updatedAt: new Date().toISOString()},
      details: {目标人员ID: subjectId, 操作类型: operation, RAGFlow账户ID: finalRagId, Dify账户ID: finalDifyId, 'Dify workspace ID': workspaceId},
    })
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
