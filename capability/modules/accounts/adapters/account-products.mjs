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

async function fetchJson(url, {method = 'GET', token, body} = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? {'content-type': 'application/json'} : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = {raw: text}
    }
  }
  if (!res.ok) {
    const code = parsed?.code ?? parsed?.error?.code ?? 'UPSTREAM_ERROR'
    const msg = parsed?.message ?? parsed?.error?.message ?? `上游请求失败 (${res.status})`
    const err = Object.assign(new Error(msg), {status: res.status >= 500 ? 502 : res.status, code})
    throw err
  }
  return parsed
}

function normalizeDifyAccount(raw, fallbackWorkspaceId) {
  if (!raw || typeof raw !== 'object') return null
  const accountId = raw.id ?? raw.accountId ?? raw.account_id ?? null
  const account = raw.account ?? raw.username ?? raw.name ?? raw.email ?? null
  const roleRaw = raw.role ?? null
  const role = roleRaw ? (DIFY_TO_ROLE[String(roleRaw).toLowerCase()] ?? DIFY_TO_ROLE[roleRaw] ?? null) : null
  const active = typeof raw.active === 'boolean' ? raw.active : raw.status ? raw.status === 'active' : true
  const workspaceId = raw.workspaceId ?? raw.workspace_id ?? fallbackWorkspaceId ?? null
  const subjectId = raw.subjectId ?? raw.subject_id ?? raw.external_id ?? null
  return {
    accountId: accountId ? String(accountId) : null,
    account: account ? String(account) : null,
    workspaceId: workspaceId ? String(workspaceId) : null,
    active: Boolean(active),
    role,
    subjectId: subjectId ? String(subjectId) : null,
  }
}

function normalizeRagflowAccount(raw) {
  if (!raw || typeof raw !== 'object') return null
  const accountId = raw.id ?? raw.accountId ?? raw.user_id ?? null
  const account = raw.account ?? raw.username ?? raw.nickname ?? raw.email ?? null
  const permRaw = raw.permission ?? raw.role ?? null
  const permission = permRaw ? (RAGFLOW_TO_PERM[String(permRaw).toLowerCase()] ?? RAGFLOW_TO_PERM[permRaw] ?? null) : null
  const active = typeof raw.active === 'boolean' ? raw.active : raw.status ? raw.status === '1' || raw.status === 'active' : true
  const subjectId = raw.subjectId ?? raw.subject_id ?? raw.external_id ?? null
  return {
    accountId: accountId ? String(accountId) : null,
    account: account ? String(account) : null,
    active: Boolean(active),
    permission,
    subjectId: subjectId ? String(subjectId) : null,
  }
}

export async function listDifyMembers(workspaceId) {
  const {dify} = requireDualAccountUpstreams()
  const ws = workspaceId ?? dify.workspaceId ?? null
  const query = ws ? `?workspace_id=${encodeURIComponent(ws)}` : ''
  const data = await fetchJson(`${dify.base}/console/api/workspaces/current/members${query}`, {token: dify.token})
  const rows = Array.isArray(data?.accounts) ? data.accounts : Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
  return rows.map(row => normalizeDifyAccount(row, ws)).filter(Boolean)
}

export async function listRagflowUsers() {
  const {ragflow} = requireDualAccountUpstreams()
  const data = await fetchJson(`${ragflow.base}/api/v1/system/users`, {token: ragflow.token})
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : []
  return rows.map(normalizeRagflowAccount).filter(Boolean)
}

export async function createDifyMember({subjectId, account, workspaceId, role}) {
  const {dify} = requireDualAccountUpstreams()
  const ws = workspaceId ?? dify.workspaceId ?? null
  const created = await fetchJson(`${dify.base}/console/api/workspaces/current/members`, {
    method: 'POST',
    token: dify.token,
    body: {subjectId, account, workspaceId: ws, role: ROLE_TO_DIFY[role] ?? role, active: true},
  })
  return normalizeDifyAccount(created?.account && typeof created.account === 'object' ? created.account : created?.data ?? created, ws)
}

export async function updateDifyMember({accountId, workspaceId, account, role, active}) {
  const {dify} = requireDualAccountUpstreams()
  const ws = workspaceId ?? dify.workspaceId ?? null
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
  const {dify} = requireDualAccountUpstreams()
  const ws = workspaceId ?? dify.workspaceId ?? null
  const query = ws ? `?workspace_id=${encodeURIComponent(ws)}` : ''
  await fetchJson(`${dify.base}/console/api/workspaces/current/members/${encodeURIComponent(accountId)}${query}`, {
    method: 'DELETE',
    token: dify.token,
  })
}

export async function createRagflowUser({subjectId, account, permission}) {
  const {ragflow} = requireDualAccountUpstreams()
  const created = await fetchJson(`${ragflow.base}/api/v1/system/users`, {
    method: 'POST',
    token: ragflow.token,
    body: {subjectId, account, permission: PERM_TO_RAGFLOW[permission] ?? permission, active: true},
  })
  return normalizeRagflowAccount(created?.data ?? created?.user ?? created)
}

export async function updateRagflowUser({accountId, account, permission, active}) {
  const {ragflow} = requireDualAccountUpstreams()
  const updated = await fetchJson(`${ragflow.base}/api/v1/system/users/${encodeURIComponent(accountId)}`, {
    method: 'PUT',
    token: ragflow.token,
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
  })
}

export function findMatchingAccount(list, {accountId, subjectId, account}) {
  if (accountId) {
    const byId = list.find(item => item.accountId === accountId)
    if (byId) return byId
  }
  if (subjectId) {
    const bySubject = list.find(item => item.subjectId === subjectId)
    if (bySubject) return bySubject
  }
  if (account) {
    const target = account.toLowerCase()
    const byName = list.find(item => item.account?.toLowerCase() === target)
    if (byName) return byName
  }
  return null
}

export function buildBaselineFact({ragAccount, difyAccount, fallbackAccount, workspaceId}) {
  const account = ragAccount?.account ?? difyAccount?.account ?? fallbackAccount ?? null
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
      approved.resourceId === command.resourceId,
    409,
    'APPROVED_INPUT_MISMATCH',
    '获准输入与执行命令不一致',
  )
  return approved
}

export async function commitManagementAccountChange(clients, executionId, body) {
  check(clients?.management, 501, 'UPSTREAM_UNSUPPORTED', '未配置管理端提交通道')
  const res = await clients.management(`/account-changes/${encodeURIComponent(executionId)}/commit`, 'PUT', body)
  return res.json()
}
