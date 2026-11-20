import {check, json, id} from '../../../../runtime/http.mjs'
import {
  listDifyMembers,
  listRagflowUsers,
  findMatchingAccount,
  buildBaselineFact,
  requireDualAccountUpstreams,
} from '../adapters/account-products.mjs'

function readMapping(openLedger, subjectId) {
  const db = openLedger('mappings')
  return db.get(subjectId) ?? null
}

function isNameUnique(list, name, excludeAccountId) {
  if (!name) return false
  const target = name.toLowerCase()
  return !list.some(item => item.account?.toLowerCase() === target && item.accountId !== excludeAccountId)
}

export async function accountContext(ctx, ticketType) {
  const {query, res, openLedger, clients} = ctx
  requireDualAccountUpstreams()
  const expectedAction = ticketType === 'ACC-01' ? 'apply_account_change' : 'rename_account'
  const action = query.get('action') ?? expectedAction
  check(action === expectedAction, 400, 'INVALID_ACTION')
  const subjectId = query.get('resourceId')
  check(typeof subjectId === 'string' && subjectId.trim() && subjectId.length <= 160, 400, 'INVALID_REQUEST')
  const workspaceIdParam = query.get('workspaceId') || null
  const newAccount = query.get('newAccount') || null
  if (ticketType === 'ACC-02') {
    check(typeof newAccount === 'string' && newAccount.trim() && newAccount.length <= 100, 400, 'INVALID_NEW_ACCOUNT')
  }

  const mapping = readMapping(openLedger, subjectId)
  check(clients?.management, 501, 'UPSTREAM_UNSUPPORTED', '缺少可信人员目录读取通道')
  const profile = await (await clients.management('/subjects/' + encodeURIComponent(subjectId))).json()
  check(profile.subjectId === subjectId && typeof profile.account === 'string' && profile.account &&
    Number.isSafeInteger(profile.revision) && profile.revision >= 1, 502, 'INVALID_SUBJECT_IDENTITY')
  const effectiveWorkspaceId = workspaceIdParam ?? mapping?.workspaceId ?? profile.workspaceId ?? null
  for (const key of ['ragflowAccountId','difyAccountId']) check(!mapping?.[key] || !profile[key] || mapping[key] === profile[key],
    409, 'ACCOUNT_IDENTITY_CHANGED', '平台人员目录与产品映射不一致')

  const [ragUsers, difyMembers] = await Promise.all([listRagflowUsers(), listDifyMembers(effectiveWorkspaceId)])
  const ragAccount = findMatchingAccount(ragUsers, {
    accountId: mapping?.ragflowAccountId ?? profile.ragflowAccountId,
    subjectId,
    account: profile.account,
  })
  const difyAccount = findMatchingAccount(difyMembers, {
    accountId: mapping?.difyAccountId ?? profile.difyAccountId,
    subjectId,
    account: profile.account,
  })

  const currentAccount = profile.account
  check([ragAccount, difyAccount].every(row => !row || !row.account || row.account === currentAccount),
    409, 'ACCOUNT_NAME_DRIFT', '产品账户名与可信人员目录不一致')
  const resolvedWorkspaceId = effectiveWorkspaceId ?? difyAccount?.workspaceId ?? null

  const candidateName = ticketType === 'ACC-02' ? newAccount : currentAccount
  const ragUnique = isNameUnique(ragUsers, candidateName, ragAccount?.accountId ?? null)
  const difyUnique = isNameUnique(difyMembers, candidateName, difyAccount?.accountId ?? null)

  const baseline = buildBaselineFact({
    ragAccount,
    difyAccount,
    fallbackAccount: currentAccount,
    workspaceId: resolvedWorkspaceId,
  })

  const hasConsistentNames = baseline.ragflow.account === baseline.dify.account && Boolean(baseline.ragflow.account)
  const ragKnown = baseline.ragflow.accountId === null ? baseline.ragflow.active === false : Boolean(baseline.ragflow.permission)
  const difyKnown = baseline.dify.accountId === null ? baseline.dify.active === false : Boolean(baseline.dify.role)
  const recoveryBaseline = hasConsistentNames && ragKnown && difyKnown ? baseline : undefined

  const fields = {
    目标人员ID: subjectId,
    当前账户名: currentAccount,
    RAGFlow账户ID: baseline.ragflow.accountId,
    Dify账户ID: baseline.dify.accountId,
    'Dify workspace ID': baseline.dify.workspaceId,
    当前RAGFlow权限: baseline.ragflow.permission,
    '当前Dify workspace角色': baseline.dify.role,
    RAGFlow唯一性校验: ragUnique ? '通过' : '冲突',
    Dify唯一性校验: difyUnique ? '通过' : '冲突',
    ...(ticketType === 'ACC-02' ? {待校验新账户名: newAccount} : {}),
  }

  return json(res, {
    snapshotId: `acc-${id()}`,
    ticketType,
    action: expectedAction,
    resourceId: subjectId,
    capturedAt: new Date().toISOString(),
    eligible: ragUnique && difyUnique,
    fields,
    ...(recoveryBaseline ? {recoveryBaseline} : {}),
    preconditions: [{kind: 'product_account_mapping', id: subjectId, revision: mapping?.revision ?? 0}],
  })
}

export const acc01Context = ctx => accountContext(ctx, 'ACC-01')
export const acc02Context = ctx => accountContext(ctx, 'ACC-02')

export const accountCatalog = Object.freeze({
  async list({openLedger, query, res}) {
    const db = openLedger('mappings')
    const q = (query.get('q') ?? '').trim().toLowerCase()
    const rows = db
      .all()
      .filter(
        row =>
          !q ||
          row.subjectId.toLowerCase().includes(q) ||
          (row.account ?? '').toLowerCase().includes(q) ||
          (row.ragflowAccountId ?? '').toLowerCase().includes(q) ||
          (row.difyAccountId ?? '').toLowerCase().includes(q),
      )
      .map(row => ({
        resourceId: row.subjectId,
        name: row.account,
        status: row.active ? '启用' : '停用',
        actions: ['apply_account_change', 'rename_account'],
        data: {
          subjectId: row.subjectId,
          account: row.account,
          ragflowAccountId: row.ragflowAccountId,
          difyAccountId: row.difyAccountId,
          workspaceId: row.workspaceId,
          ragflowPermission: row.ragflowPermission ?? null,
          difyRole: row.difyRole ?? null,
          revision: row.revision,
        },
      }))
    return json(res, {items: rows, nextCursor: null})
  },
  async detail({openLedger, resourceId, res}) {
    const row = openLedger('mappings').get(resourceId)
    check(row, 404, 'NOT_FOUND')
    return json(res, {
      snapshotId: `acc-cat-${row.revision}`,
      resourceId: row.subjectId,
      name: row.account,
      status: row.active ? '启用' : '停用',
      capturedAt: row.updatedAt ?? new Date().toISOString(),
      data: {
        subjectId: row.subjectId,
        account: row.account,
        ragflowAccountId: row.ragflowAccountId,
        difyAccountId: row.difyAccountId,
        workspaceId: row.workspaceId,
        ragflowPermission: row.ragflowPermission ?? null,
        difyRole: row.difyRole ?? null,
        revision: row.revision,
      },
    })
  },
})
