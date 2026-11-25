import {body, check, json} from '../../../../runtime/http.mjs'
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
  const {applications, directory, identity, options, path, req, res, subsystems, tickets} = services
  check(identity?.active, 403, 'ACCESS_DENIED')

  const now = (options.now ?? Date.now)()
  const store = directory.store
  const profile = directory.get(identity.subjectId) ?? directory.byAccount(identity.account)
  check(profile, 404, 'PROFILE_NOT_FOUND')

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
