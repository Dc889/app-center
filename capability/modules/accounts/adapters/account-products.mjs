import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig} from '../../../platform/dify/public.mjs'
import {getRagflowConfig} from '../../../platform/ragflow/public.mjs'

const DIFY_TO_ROLE = {
  normal: '成员',
  member: '成员',
  成员: '成员',
  editor: '编辑',
  编辑: '编辑',
  admin: '管理员',
  owner: '管理员',
  管理员: '管理员',
}

const ROLE_TO_DIFY = {
  成员: 'normal',
  编辑: 'editor',
  管理员: 'admin',
}

const RAGFLOW_TO_PERM = {
  me: '个人',
  personal: '个人',
  个人: '个人',
  team: '团队成员',
  member: '团队成员',
  团队成员: '团队成员',
  admin: '管理员',
  owner: '管理员',
  管理员: '管理员',
}

const PERM_TO_RAGFLOW = {
  个人: 'me',
  团队成员: 'team',
  管理员: 'admin',
}

export function requireDualAccountUpstreams() {
  const dify = getDifyConfig()
  const ragflow = getRagflowConfig()
  check(dify.isReal && ragflow.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 或 RAGFlow 连接凭证')
  return {dify, ragflow}
}

async function fetchJson(url, {method = 'GET', token, body, product} = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? {'content-type': 'application/json'} : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  let parsed = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }
  if (!res.ok) {
    const unsupported = [404, 405, 501].includes(res.status)
    const code = unsupported ? 'UPSTREAM_UNSUPPORTED' : 'UPSTREAM_ERROR'
    const err = Object.assign(new Error(unsupported ? '目标产品未提供此账号管理接口' : `账号上游请求失败 (HTTP ${res.status})`),
      {status: unsupported ? 501 : res.status >= 500 ? 502 : res.status, code,
        writeRejected: [400,401,403,404,405,409,422].includes(res.status)})
    throw err
  }
  check(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 502, 'UPSTREAM_INVALID_RESPONSE', '账号上游响应不是有效对象')
  check(product !== 'ragflow' || parsed.code === 0, 502, 'UPSTREAM_BUSINESS_ERROR', 'RAGFlow 未确认账号请求成功')
  check(!parsed.error && (parsed.result === undefined || parsed.result === 'success'), 502, 'UPSTREAM_BUSINESS_ERROR', '账号上游返回业务错误')
  return parsed
}

function identityFor(product, raw, accountId) {
  const source = process.env[`${product}_ACCOUNT_IDENTITY_MAP`]
  let mapping = {}
  if (source) {
    try {mapping = JSON.parse(source)} catch {check(false, 501, 'INVALID_IDENTITY_MAPPING', '账号身份映射配置无法解析')}
    check(mapping && typeof mapping === 'object' && !Array.isArray(mapping), 501, 'INVALID_IDENTITY_MAPPING')
  }
  const mapped = mapping[accountId]
  if (mapped !== undefined) {
    check(mapped && typeof mapped.subjectId === 'string' && mapped.subjectId.trim(),
      501, 'INVALID_IDENTITY_MAPPING', '产品 UUID 映射必须提供稳定人员ID')
    check((!raw.subjectId || raw.subjectId === mapped.subjectId),
      409, 'IDENTITY_MAPPING_CONFLICT', '产品身份与显式 UUID 映射不一致')
  }
  // The mapping identifies a person; it cannot manufacture a current product login name.
  return {account: raw.account ?? raw.username ?? null,
    subjectId: mapped?.subjectId ?? raw.subjectId ?? raw.subject_id ?? raw.external_id ?? null}
}

function uniqueRows(rows) {
  check(Array.isArray(rows), 502, 'UPSTREAM_INVALID_RESPONSE', '账号列表缺失，不能按空列表判定账户不存在')
  const ids = new Set()
  for (const row of rows) {
    check(row && typeof row.accountId === 'string' && row.accountId && !ids.has(row.accountId), 502, 'UPSTREAM_INVALID_RESPONSE', '产品账号ID缺失或重复')
    ids.add(row.accountId)
  }
  return rows
}

function normalizeDifyAccount(raw, fallbackWorkspaceId) {
  if (!raw || typeof raw !== 'object') return null
  const accountId = raw.id ?? raw.accountId ?? raw.account_id ?? null
  const identity = identityFor('DIFY', raw, accountId)
  const account = identity.account
  const roleRaw = raw.role ?? null
  const role = roleRaw ? (DIFY_TO_ROLE[String(roleRaw).toLowerCase()] ?? DIFY_TO_ROLE[roleRaw] ?? null) : null
  const knownStatus = ['active', 'pending', 'uninitialized', 'banned', 'closed'].includes(raw.status)
  const active = typeof raw.active === 'boolean' ? raw.active : knownStatus ? raw.status === 'active' : null
  const workspaceId = raw.workspaceId ?? raw.workspace_id ?? fallbackWorkspaceId ?? null
  const subjectId = identity.subjectId
  return {
    accountId: accountId ? String(accountId) : null,
    account: account ? String(account) : null,
    workspaceId: workspaceId ? String(workspaceId) : null,
    active,
    role,
    productRole: roleRaw,
    displayName: raw.name ?? null,
    loginEmail: raw.email ?? null,
    subjectId: subjectId ? String(subjectId) : null,
  }
}

function normalizeRagflowAccount(raw) {
  if (!raw || typeof raw !== 'object') return null
  const accountId = raw.id ?? raw.accountId ?? raw.user_id ?? null
  const identity = identityFor('RAGFLOW', raw, accountId)
  const account = identity.account
  const permRaw = raw.permission ?? raw.role ?? null
  const permission = permRaw ? (RAGFLOW_TO_PERM[String(permRaw).toLowerCase()] ?? RAGFLOW_TO_PERM[permRaw] ?? null) : null
  const active = typeof raw.active === 'boolean' ? raw.active : ['1', '0', 'active', 'inactive'].includes(raw.status) ? raw.status === '1' || raw.status === 'active' : null
  const subjectId = identity.subjectId
  return {
    accountId: accountId ? String(accountId) : null,
    account: account ? String(account) : null,
    active,
    permission,
    displayName: raw.nickname ?? null,
    loginEmail: raw.email ?? null,
    subjectId: subjectId ? String(subjectId) : null,
  }
}

async function verifiedDifyWorkspace(workspaceId) {
  const {dify} = requireDualAccountUpstreams()
  const ws = workspaceId ?? dify.workspaceId ?? null
  check(ws && dify.workspaceId === ws, 403, 'ACCESS_DENIED', '账号工作区与配置身份不一致')
  const current = await fetchJson(`${dify.base}/console/api/workspaces/current`, {token: dify.token})
  check(current.id === ws, 403, 'ACCESS_DENIED', '产品当前工作区已变化，不使用查询参数伪造目标工作区')
  return {dify, ws}
}

export async function listDifyMembers(workspaceId) {
  const {dify, ws} = await verifiedDifyWorkspace(workspaceId)
  const data = await fetchJson(`${dify.base}/console/api/workspaces/current/members`, {token: dify.token})
  check(Array.isArray(data.accounts), 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 成员清单缺失')
  return uniqueRows(data.accounts.map(row => normalizeDifyAccount(row, ws)))
}

export async function listRagflowUsers() {
  const {ragflow} = requireDualAccountUpstreams()
  const data = await fetchJson(`${ragflow.base}/api/v1/system/users`, {token: ragflow.token, product: 'ragflow'})
  check(Array.isArray(data.data), 502, 'UPSTREAM_INVALID_RESPONSE', 'RAGFlow 用户清单缺失')
  return uniqueRows(data.data.map(normalizeRagflowAccount))
}

export async function createDifyMember({subjectId, account, workspaceId, role}) {
  const {dify, ws} = await verifiedDifyWorkspace(workspaceId)
  const created = await fetchJson(`${dify.base}/console/api/workspaces/current/members`, {
    method: 'POST',
    token: dify.token,
    body: {subjectId, account, workspaceId: ws, role: ROLE_TO_DIFY[role] ?? role, active: true},
  })
  const result = normalizeDifyAccount(created?.account && typeof created.account === 'object' ? created.account : created?.data ?? created, ws)
  check(typeof result?.accountId === 'string' && result.accountId, 502, 'UPSTREAM_INVALID_RESPONSE', '创建响应缺少实际产品ID，请查证原请求')
  return result
}

export async function updateDifyMember({accountId, workspaceId, account, role, active}) {
  const {dify, ws} = await verifiedDifyWorkspace(workspaceId)
  const updated = await fetchJson(`${dify.base}/console/api/workspaces/current/members/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    token: dify.token,
    body: {
      ...(account !== undefined ? {account} : {}),
      ...(ws !== undefined ? {workspaceId: ws} : {}),
      ...(role !== undefined ? {role: ROLE_TO_DIFY[role] ?? role} : {}),
      ...(active !== undefined ? {active} : {}),
    },
  })
  return normalizeDifyAccount(updated?.account && typeof updated.account === 'object' ? updated.account : updated?.data ?? updated, ws)
}

export async function deleteDifyMember({accountId, workspaceId}) {
  const {dify} = await verifiedDifyWorkspace(workspaceId)
  await fetchJson(`${dify.base}/console/api/workspaces/current/members/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    token: dify.token,
  })
}

export async function createRagflowUser({subjectId, account, permission}) {
  const {ragflow} = requireDualAccountUpstreams()
  const created = await fetchJson(`${ragflow.base}/api/v1/system/users`, {
    method: 'POST',
    token: ragflow.token,
    product: 'ragflow',
    body: {subjectId, account, permission: PERM_TO_RAGFLOW[permission] ?? permission, active: true},
  })
  const result = normalizeRagflowAccount(created?.data ?? created?.user ?? created)
  check(typeof result?.accountId === 'string' && result.accountId, 502, 'UPSTREAM_INVALID_RESPONSE', '创建响应缺少实际产品ID，请查证原请求')
  return result
}

export async function updateRagflowUser({accountId, account, permission, active}) {
  const {ragflow} = requireDualAccountUpstreams()
  const updated = await fetchJson(`${ragflow.base}/api/v1/system/users/${encodeURIComponent(accountId)}`, {
    method: 'PUT',
    token: ragflow.token,
    product: 'ragflow',
    body: {
      ...(account !== undefined ? {account} : {}),
      ...(permission !== undefined ? {permission: PERM_TO_RAGFLOW[permission] ?? permission} : {}),
      ...(active !== undefined ? {active} : {}),
    },
  })
  return normalizeRagflowAccount(updated?.data ?? updated?.user ?? updated)
}

export async function deleteRagflowUser({accountId}) {
  const {ragflow} = requireDualAccountUpstreams()
  await fetchJson(`${ragflow.base}/api/v1/system/users/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    token: ragflow.token,
    product: 'ragflow',
  })
}

export function findMatchingAccount(list, {accountId, subjectId, account}) {
  // An existing UUID is authoritative. Missing UUIDs never fall back to another same-name account.
  const matches = accountId ? list.filter(item => item.accountId === accountId)
    : subjectId ? list.filter(item => item.subjectId === subjectId) : []
  check(matches.length <= 1, 409, 'AMBIGUOUS_ACCOUNT_IDENTITY', '同一稳定身份对应多个产品账户')
  const found = matches[0] ?? null
  if (found) {
    check(!subjectId || !found.subjectId || found.subjectId === subjectId, 409, 'ACCOUNT_IDENTITY_CHANGED', '原生UUID对应的人员已变化')
    return found
  }
  if (!accountId && account) check(!list.some(item => item.account?.toLowerCase() === account.toLowerCase()),
    409, 'UNMAPPED_ACCOUNT_IDENTITY', '存在同名产品账户但没有稳定人员映射，不能自动接管')
  return null
}

export function buildBaselineFact({ragAccount, difyAccount, fallbackAccount, workspaceId}) {
  for (const item of [ragAccount, difyAccount].filter(Boolean)) check(
    typeof item.accountId === 'string' && item.accountId && typeof item.account === 'string' && item.account && typeof item.active === 'boolean',
    501, 'INCOMPLETE_ACCOUNT_FACTS', '产品账户名或可用状态未经核实，不能生成恢复基线')
  check(!ragAccount || ['个人', '团队成员', '管理员'].includes(ragAccount.permission), 501, 'INCOMPLETE_ACCOUNT_FACTS', '无法核实RAGFlow产品权限')
  check(!difyAccount || ['成员', '编辑', '管理员'].includes(difyAccount.role), 501, 'INCOMPLETE_ACCOUNT_FACTS', '无法核实Dify产品角色')
  check(difyAccount?.productRole !== 'owner', 501, 'UPSTREAM_UNSUPPORTED', '所有者角色无法用管理员角色无损恢复')
  check(!difyAccount || difyAccount.workspaceId === workspaceId, 409, 'ACCOUNT_WORKSPACE_CHANGED')
  const account = fallbackAccount ?? null
  return {
    ragflow: ragAccount
      ? {
          accountId: ragAccount.accountId,
          account: ragAccount.account,
          active: ragAccount.active,
          permission: ragAccount.permission,
        }
      : {
          accountId: null,
          account,
          active: false,
          permission: null,
        },
    dify: difyAccount
      ? {
          accountId: difyAccount.accountId,
          workspaceId: difyAccount.workspaceId ?? workspaceId ?? null,
          account: difyAccount.account,
          active: difyAccount.active,
          role: difyAccount.role,
        }
      : {
          accountId: null,
          workspaceId: workspaceId ?? null,
          account,
          active: false,
          role: null,
        },
  }
}

export async function fetchApprovedAccountInputs(clients, command) {
  check(clients?.management, 501, 'UPSTREAM_UNSUPPORTED', '未配置管理端回读通道')
  const res = await clients.management(`/approved-inputs/${encodeURIComponent(command.executionId)}`)
  const approved = await res.json()
  check(
    approved &&
      approved.decisionRef === command.payload?.decisionRef &&
      approved.ticketType === command.ticketType &&
      approved.action === command.action &&
      approved.resourceId === command.resourceId && approved.fields?.['目标人员ID'] === command.resourceId,
    409,
    'APPROVED_INPUT_MISMATCH',
    '获准输入与执行命令不一致',
  )
  return approved
}

export async function assertUniqueProductAccount({account, workspaceId, ragflowAccountId, difyAccountId}) {
  const [rag, dify] = await Promise.all([listRagflowUsers(), listDifyMembers(workspaceId)])
  for (const [list, ownId] of [[rag, ragflowAccountId], [dify, difyAccountId]]) check(
    !list.some(row => row.accountId !== ownId && row.account?.toLowerCase() === account.toLowerCase()),
    409, 'PRODUCT_ACCOUNT_NAME_CONFLICT', '产品端存在其他用户占用该账户名')
}

export async function commitManagementAccountChange(clients, executionId, body) {
  check(clients?.management, 501, 'UPSTREAM_UNSUPPORTED', '未配置管理端提交通道')
  const res = await clients.management(`/account-changes/${encodeURIComponent(executionId)}/commit`, 'PUT', body)
  return res.json()
}
