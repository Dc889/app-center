import {body, check, id, json} from '../../../../runtime/http.mjs'
import {buildModelQuotaReport} from './routeModelQuotas.mjs'

const DAY_MS = 86_400_000
const DEFAULT_VALID_DAYS = {key: 90, dataset: 180, app: 180}

function norm(v) {
  return String(v ?? '').trim().toLowerCase()
}

function parseMs(val) {
  if (!val) return null
  const ms = Date.parse(String(val))
  return Number.isFinite(ms) ? ms : null
}

export async function routeProfile(services) {
  const {applications, directory, hasRole, identity, options, path, req, res, subsystems, tickets} = services
  check(identity?.active, 403, 'ACCESS_DENIED')

  const isStaff = hasRole(identity, 'admin') || hasRole(identity, 'operator')
  const now = (options.now ?? Date.now)()
  const store = directory.store
  const profile = directory.get(identity.subjectId) ?? directory.byAccount(identity.account)
  check(profile, 404, 'PROFILE_NOT_FOUND')

  // ACC-04: Self-service org/role change requests
  if (path === '/api/org-role-requests' && req.method === 'GET') {
    const orgs = Array.isArray(directory.catalog?.orgs) ? directory.catalog.orgs : []
    const items = store.all()
      .filter(r => r && r.kind === 'org-role-request')
      .filter(r => isStaff || r.account === identity.account)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    return json(res, {
      currentProfile: {account: profile.account, name: profile.name, org: profile.org || '未归属', roles: profile.roles ?? ['user']},
      orgs,
      items,
    })
  }

  if (path === '/api/org-role-requests' && req.method === 'POST') {
    check(!req.headers.origin || new URL(req.headers.origin).host === req.headers.host, 403, 'ACCESS_DENIED')
    const input = await body(req)
    const requestType = String(input?.requestType ?? '组织变更').trim()
    const targetOrg = String(input?.targetOrg ?? '').trim()
    const targetRole = String(input?.targetRole ?? '').trim()
    const reason = String(input?.reason ?? '').trim()
    check(['组织变更', '角色变更'].includes(requestType), 400, 'INVALID_REQUEST_TYPE')
    if (requestType === '组织变更') {
      const orgs = Array.isArray(directory.catalog?.orgs) ? directory.catalog.orgs : []
      check(targetOrg && (!orgs.length || orgs.includes(targetOrg)), 400, 'INVALID_TARGET_ORG', '请选择有效的目标组织机构')
    } else {
      check(['user', 'operator', 'admin'].includes(targetRole), 400, 'INVALID_TARGET_ROLE', '请选择有效的目标角色')
    }
    check(reason.length >= 2 && reason.length <= 1000, 400, 'INVALID_REASON', '请填写变更申请原因')

    const at = new Date(now).toISOString()
    const ticketNo = `ACC-04-${id().slice(0, 8)}`
    const record = store.put(`org-role:${ticketNo}`, {
      kind: 'org-role-request',
      ticketNo,
      subjectId: profile.subjectId,
      account: profile.account,
      name: profile.name,
      currentOrg: profile.org || '未归属',
      currentRoles: profile.roles ?? ['user'],
      requestType,
      targetOrg: requestType === '组织变更' ? targetOrg : null,
      targetRole: requestType === '角色变更' ? targetRole : null,
      reason,
      status: '待审批',
      createdAt: at,
      reviewedAt: null,
      reviewer: null,
      reviewNote: null,
    })
    return json(res, {ok: true, record}, 201)
  }

  if (path === '/api/org-role-requests/approve' && req.method === 'POST') {
    check(hasRole(identity, 'admin'), 403, 'ACCESS_DENIED', '仅系统管理员可审批组织与角色变更单')
    check(!req.headers.origin || new URL(req.headers.origin).host === req.headers.host, 403, 'ACCESS_DENIED')
    const input = await body(req)
    const ticketNo = String(input?.ticketNo ?? '').trim()
    const decision = input?.decision === 'reject' ? 'reject' : 'approve'
    const reviewNote = String(input?.reviewNote ?? (decision === 'approve' ? '同意变更并生效' : '驳回变更申请')).trim()

    const existing = store.get(`org-role:${ticketNo}`)
    check(existing && existing.status === '待审批', 404, 'TICKET_NOT_PENDING', '该申请单不存在或已办理')
    const at = new Date(now).toISOString()

    if (decision === 'approve') {
      const targetPerson = directory.get(existing.subjectId) ?? directory.byAccount(existing.account)
      check(targetPerson, 404, 'PERSON_NOT_FOUND')
      const nextPerson = {...targetPerson, revision: (targetPerson.revision ?? 1) + 1, updatedAt: at}
      if (existing.requestType === '组织变更' && existing.targetOrg) {
        nextPerson.org = existing.targetOrg
        nextPerson.businessLine = existing.targetOrg
      } else if (existing.requestType === '角色变更' && existing.targetRole) {
        nextPerson.roles = [...new Set([existing.targetRole, ...(targetPerson.roles ?? [])])]
      }
      store.put(`person:${targetPerson.subjectId}`, nextPerson)
    }

    const updated = store.put(`org-role:${ticketNo}`, {
      ...existing,
      status: decision === 'approve' ? '已批准' : '已驳回',
      reviewedAt: at,
      reviewer: identity.account,
      reviewNote,
    })
    return json(res, {ok: true, record: updated})
  }

  if (req.method === 'GET' && path === '/api/profile/me') {
    const inv = subsystems?.getDifyInventory?.() ?? {syncedAt: null, apps: [], datasets: [], mcpProviders: [], plugins: [], apiKeys: [], modelUsage: []}
    const accLower = norm(profile.account)
    const mailLower = norm(profile.email)
    const wsId = String(profile.difyWorkspaceId || '').trim()

    const isMine = (item) => {
      if (wsId && item.workspaceId && item.workspaceId === wsId) return true
      if (accLower && norm(item.ownerAccount) === accLower) return true
      if (mailLower && (norm(item.ownerEmail) === mailLower || norm(item.ownerAccount) === mailLower)) return true
      return false
    }

    const myApps = (inv.apps ?? []).filter(isMine)
    const myDatasets = (inv.datasets ?? []).filter(isMine)
    const myPlugins = (inv.plugins ?? []).filter(isMine)
    const myMcp = (inv.mcpProviders ?? []).filter(isMine)
    const myApiKeys = (inv.apiKeys ?? []).filter(isMine)

    const resolvedWsId = wsId || myApps[0]?.workspaceId || myDatasets[0]?.workspaceId || ''
    const resolvedWsName = profile.difyWorkspaceName || myApps[0]?.workspaceName || myDatasets[0]?.workspaceName || ''

    // Model quotas & MOD-01 requests for this user
    const mqReport = buildModelQuotaReport({inventory: inv, directory, now})
    const myModels = mqReport.items.filter(m =>
      (resolvedWsId && m.workspaceId === resolvedWsId) || norm(m.ownerAccount) === accLower,
    )
    const myQuotaTickets = mqReport.tickets.filter(t =>
      norm(t.applicant) === accLower || (resolvedWsId && t.workspaceId === resolvedWsId),
    )

    // My work order stats
    const myAllTickets = [...applications.records(), ...tickets.all()].filter(r =>
      norm(r.account) === accLower || norm(r.command?.account) === accLower,
    )
    const ticketStats = {
      total: myAllTickets.length,
      pending: myAllTickets.filter(r => ['待受理', '审核中', '执行中', '待补正', '排队中'].includes(r.status) || ['queued', 'running', 'reconciling'].includes(r.state?.status)).length,
      completed: myAllTickets.filter(r => ['已通过', '已办结', '已完成'].includes(r.status) || r.execution?.status === 'succeeded' || r.state?.status === 'succeeded').length,
      rejected: myAllTickets.filter(r => ['已驳回', '已撤回', '已取消', '执行失败'].includes(r.status) || r.execution?.status === 'failed' || r.state?.status === 'failed').length,
    }

    // My expirable keys & grants
    const expOverrides = new Map()
    for (const row of store.all()) {
      if (row?.kind === 'grant-expiration' && row.itemId) expOverrides.set(row.itemId, row)
    }
    const myExpirations = []
    const seenExp = new Set()
    for (const row of myAllTickets) {
      const ticketType = String(row.ticketType ?? row.command?.ticketType ?? '').toUpperCase()
      if (!['KEY-01', 'KB-03', 'APP-02'].includes(ticketType)) continue
      const execStatus = String(row.execution?.status ?? row.state?.status ?? '').toLowerCase()
      if (!['succeeded', 'approved', 'completed', 'active'].includes(execStatus) && !['已通过', '已办结', '已完成'].includes(row.status)) continue
      const itemId = `ticket:${row.ticketNo}`
      if (seenExp.has(itemId)) continue
      seenExp.add(itemId)
      const grantType = ticketType === 'KEY-01' ? 'key' : ticketType === 'KB-03' ? 'dataset' : 'app'
      const grantLabel = ticketType === 'KEY-01' ? '应用访问密钥' : ticketType === 'KB-03' ? '知识库共享授权' : '智能体访问授权'
      const issuedMs = parseMs(row.execution?.updatedAt ?? row.state?.updatedAt ?? row.createdAt) ?? now
      const explicitExp = row.approvedFields?.['有效期截止时间'] ?? row.submission?.fields?.expiresAt ?? null
      const ov = expOverrides.get(itemId)
      const expiresAt = ov?.expiresAt || explicitExp || new Date(issuedMs + DEFAULT_VALID_DAYS[grantType] * DAY_MS).toISOString()
      const daysRemaining = Math.ceil(((parseMs(expiresAt) ?? now) - now) / DAY_MS)
      const status = ov?.revokedAt ? '已回收' : daysRemaining < 0 ? '已过期' : daysRemaining <= 7 ? '即将到期' : '正常有效'
      myExpirations.push({
        itemId,
        grantLabel,
        ticketNo: row.ticketNo,
        resourceName: String(row.approvedFields?.['调用方名称'] || row.snapshot?.fields?.['资源名称'] || row.command?.resourceId || row.ticketNo),
        expiresAt,
        daysRemaining,
        status,
      })
    }

    return json(res, {
      capturedAt: new Date(now).toISOString(),
      syncedAt: inv.syncedAt || null,
      profile: {
        subjectId: profile.subjectId,
        account: profile.account,
        email: profile.email || `${profile.account}@kpw.com`,
        name: profile.name,
        org: profile.org || '未归属',
        businessLine: profile.businessLine || profile.org || '未归属',
        roles: profile.roles ?? ['user'],
        active: Boolean(profile.active),
        authSource: profile.difyAccountId || profile.authSource === 'dify' ? 'dify' : 'local',
        difyAccountId: profile.difyAccountId || null,
        difyWorkspaceId: resolvedWsId || null,
        difyWorkspaceName: resolvedWsName || null,
        ragflowPermission: profile.ragflowPermission || '个人',
        difyRole: profile.difyRole || '成员',
        expiresAt: profile.expiresAt || null,
      },
      assets: {
        appsCount: myApps.length,
        datasetsCount: myDatasets.length,
        pluginsCount: myPlugins.length,
        mcpCount: myMcp.length,
        apiKeysCount: myApiKeys.length,
        recentApps: myApps.slice(0, 6).map(a => ({id: a.resourceId, name: a.name, mode: a.mode})),
        recentDatasets: myDatasets.slice(0, 6).map(d => ({id: d.resourceId, name: d.name, documentCount: d.documentCount})),
      },
      ticketStats,
      models: myModels,
      quotaTickets: myQuotaTickets,
      expirations: myExpirations,
    })
  }

  if (req.method === 'POST' && path === '/api/profile/me') {
    check(!req.headers.origin || new URL(req.headers.origin).host === req.headers.host, 403, 'ACCESS_DENIED')
    const input = await body(req)
    const name = String(input?.name ?? '').trim()
    check(name.length >= 1 && name.length <= 50, 400, 'INVALID_NAME', '请输入 1～50 个字符的真实姓名')

    const updated = store.put(`person:${profile.subjectId}`, {
      ...profile,
      name,
      revision: (profile.revision ?? 1) + 1,
      updatedAt: new Date(now).toISOString(),
    })
    return json(res, {
      ok: true,
      profile: {
        account: updated.account,
        email: updated.email,
        name: updated.name,
        org: updated.org,
        businessLine: updated.businessLine,
      },
    })
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
