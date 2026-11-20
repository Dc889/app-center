import {check, json, same} from '../../../../runtime/http.mjs'
import {requireDualAccountUpstreams} from '../adapters/account-products.mjs'
import {readLiveAccountFacts} from '../adapters/compensation.mjs'

export async function getAccountConsistency(ctx) {
  const {params, res, getExecution, openLedger} = ctx
  requireDualAccountUpstreams()
  const executionId = params?.executionId
  check(typeof executionId === 'string' && executionId.length >= 1 && executionId.length <= 160, 400, 'INVALID_REQUEST')

  const execRecord = getExecution(executionId)
  check(execRecord, 404, 'NOT_FOUND', '未找到对应的执行记录')
  const {command, state} = execRecord
  check(
    command.ticketType === 'ACC-01' || command.ticketType === 'ACC-02',
    409,
    'UNSUPPORTED_TICKET_TYPE',
    '仅支持账号类执行的一致性查证',
  )

  const recoveryLedger = openLedger('recovery')
  const record = recoveryLedger.get(executionId)
  check(record && record.baseline, 404, 'RECOVERY_RECORD_NOT_FOUND', '未找到审批前产品基线与查证封存记录')

  const executionStatus = state.status === 'failed' ? 'failed' : 'reconciling'
  const checkedAt = new Date().toISOString()

  let liveProducts = null
  let outcome = 'unknown'
  try {
    liveProducts = await readLiveAccountFacts({
      subjectId: record.subjectId,
      ragflowAccountId: record.baseline.ragflow.accountId,
      difyAccountId: record.baseline.dify.accountId,
      fallbackAccount: record.baseline.ragflow.account,
      workspaceId: record.baseline.dify.workspaceId,
    })
    const ragComplete =
      liveProducts.ragflow.accountId === null
        ? liveProducts.ragflow.active === false && liveProducts.ragflow.permission === null
        : Boolean(liveProducts.ragflow.permission)
    const difyComplete =
      liveProducts.dify.accountId === null
        ? liveProducts.dify.active === false && liveProducts.dify.role === null
        : Boolean(liveProducts.dify.role)
    if (!ragComplete || !difyComplete) {
      outcome = 'unknown'
    } else if (same(liveProducts, record.baseline)) {
      outcome = 'restored'
    } else {
      outcome = 'partial'
    }
  } catch {
    outcome = 'unknown'
    liveProducts = {
      ragflow: {accountId: null, account: record.baseline.ragflow.account, active: false, permission: null},
      dify: {
        accountId: null,
        workspaceId: record.baseline.dify.workspaceId,
        account: record.baseline.dify.account,
        active: false,
        role: null,
      },
    }
  }

  const sealed = Boolean(record.sealed) && executionStatus === 'failed' && outcome !== 'unknown'

  return json(res, {
    proofId: record.proofId,
    executionId,
    ticketNo: command.ticketNo,
    subjectId: record.subjectId,
    identityRevision: record.identityRevision,
    productMappingRevision: record.productMappingRevision,
    executionStatus,
    sealed,
    outcome,
    checkedAt,
    products: liveProducts,
  })
}
