import {check, id, same} from '../../../../runtime/http.mjs'
import {
  requireDualAccountUpstreams,
  fetchApprovedAccountInputs,
  updateRagflowUser,
  updateDifyMember,
  assertUniqueProductAccount,
} from '../adapters/account-products.mjs'
import {beginAccountTransaction, productStep, commitVerifiedAccount} from '../adapters/account-transaction.mjs'
import {readLiveAccountFacts, extractPreconditionRevision, sealFailedAccountExecution} from '../adapters/compensation.mjs'

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

  const oldAccount = fields['原账户名'] ?? existing?.account ?? null
  const newAccount = fields['新账户名'] ?? null
  const workspaceId = fields['Dify workspace ID'] ?? existing?.workspaceId ?? null
  check(typeof oldAccount === 'string' && oldAccount.length > 0 && typeof newAccount === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(newAccount) && oldAccount !== newAccount, 400, 'INVALID_NEW_ACCOUNT')

  const baseline = await readLiveAccountFacts({
    subjectId,
    ragflowAccountId: existing?.ragflowAccountId ?? approved.recoveryBaseline?.ragflow?.accountId ?? null,
    difyAccountId: existing?.difyAccountId ?? approved.recoveryBaseline?.dify?.accountId ?? null,
    fallbackAccount: oldAccount,
    workspaceId,
  })
  check(approved.recoveryBaseline, 501, 'RECOVERY_BASELINE_REQUIRED', '缺少审批时冻结的产品基线，禁止写入')
  check(same(approved.recoveryBaseline, baseline), 409, 'STALE_ACCOUNT_BASELINE', '审批后的真实产品状态已变化，禁止用新读值覆盖冻结基线')
  check(baseline.ragflow.accountId && baseline.dify.accountId, 409, 'ACCOUNT_NOT_FOUND', '双端账号不存在，无法改名')
  check(baseline.ragflow.account === oldAccount && baseline.dify.account === oldAccount, 409, 'STALE_SNAPSHOT', '产品端当前账户名已漂移')
  await assertUniqueProductAccount({account: newAccount, workspaceId,
    ragflowAccountId: baseline.ragflow.accountId, difyAccountId: baseline.dify.accountId})

  const recoveryRecord = {
    executionId: command.executionId,
    ticketNo: command.ticketNo,
    subjectId,
    identityRevision,
    productMappingRevision,
    operation: '账户名变更',
    baseline,
    proofId: `acc-proof-${id()}`,
    sealed: false,
    sealedAt: null,
    committed: false,
    updatedAt: new Date().toISOString(),
  }
  beginAccountTransaction(context, recoveryRecord)
  const write = (product, fn) => productStep(recoveryLedger, recoveryRecord, product, 'rename', fn)

  let ragMutated = false
  let difyMutated = false

  try {
    await write('ragflow', () => updateRagflowUser({accountId: baseline.ragflow.accountId, account: newAccount}))
    ragMutated = true

    await write('dify', () => updateDifyMember({accountId: baseline.dify.accountId, workspaceId, account: newAccount}))
    difyMutated = true

    const nextRevision = productMappingRevision + 1
    await commitVerifiedAccount(context, recoveryRecord, {
      expected: {ragflow: {...baseline.ragflow, account: newAccount}, dify: {...baseline.dify, account: newAccount}},
      mapping: {subjectId, account: newAccount, ragflowAccountId: baseline.ragflow.accountId, difyAccountId: baseline.dify.accountId,
        workspaceId, active: baseline.ragflow.active, ragflowPermission: baseline.ragflow.permission, difyRole: baseline.dify.role,
        revision: nextRevision, updatedAt: new Date().toISOString()},
      details: {目标人员ID: subjectId, 原账户名: oldAccount, 新账户名: newAccount,
        RAGFlow账户ID: baseline.ragflow.accountId, Dify账户ID: baseline.dify.accountId},
    })
  } catch (err) {
    const sealedInfo = await sealFailedAccountExecution({
      recoveryLedger,
      record: recoveryRecord,
      subjectId,
      baseline,
      createdRagId: null,
      createdDifyId: null,
      ragMutated,
      difyMutated,
    })
    state.status = 'failed'
    state.result = {
      ok: false,
      failureCode: err.code ?? 'UPSTREAM_ERROR',
      failureReason: err.message ?? '双端账号改名失败',
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
