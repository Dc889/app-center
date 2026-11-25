import {body, check, json} from '../../../../runtime/http.mjs'

const DAY_MS = 86_400_000
const DEFAULT_VALID_DAYS = {
  key: 90,
  dataset: 180,
  app: 180,
  account: 365,
}

function parseMs(val) {
  if (!val) return null
  const ms = Date.parse(String(val))
  return Number.isFinite(ms) ? ms : null
}

function collectExpirableItems({applications, tickets, directory, subsystems, now}) {
  const store = directory.store
  const overrides = new Map()
  for (const row of store.all()) {
    if (row && row.kind === 'grant-expiration' && row.itemId) {
      overrides.set(row.itemId, row)
    }
  }

  const rawItems = []
  const seen = new Set()

  // 1. Approved KEY-01 / KB-03 / APP-02 applications & tickets
  for (const row of [...applications.records(), ...tickets.all()]) {
    const ticketType = String(row.ticketType ?? row.command?.ticketType ?? '').toUpperCase()
    if (!['KEY-01', 'KB-03', 'APP-02'].includes(ticketType)) continue
    const execStatus = String(row.execution?.status ?? row.state?.status ?? '').toLowerCase()
    if (!['succeeded', 'approved', 'completed', 'active'].includes(execStatus) && !['已通过', '已办结', '已完成'].includes(row.status)) continue

    const itemId = `ticket:${row.ticketNo}`
    if (seen.has(itemId)) continue
    seen.add(itemId)

    const grantType = ticketType === 'KEY-01' ? 'key' : ticketType === 'KB-03' ? 'dataset' : 'app'
    const grantLabel = ticketType === 'KEY-01' ? '应用访问密钥' : ticketType === 'KB-03' ? '知识库共享授权' : '智能体访问授权'
    const issuedAtStr = row.execution?.updatedAt ?? row.state?.updatedAt ?? row.createdAt ?? new Date(now).toISOString()
    const issuedMs = parseMs(issuedAtStr) ?? now
    const explicitExp = row.approvedFields?.['有效期截止时间'] ?? row.submission?.fields?.expiresAt ?? row.command?.payload?.expiresAt ?? null
    const defaultExpMs = issuedMs + DEFAULT_VALID_DAYS[grantType] * DAY_MS
    const baseExpiresMs = parseMs(explicitExp) ?? defaultExpMs

    const ownerProfile = directory.byAccount(row.account)
    const resourceName = row.approvedFields?.['调用方名称']
      || row.snapshot?.fields?.['资源名称']
      || row.snapshot?.fields?.['Dify应用ID']
      || row.command?.resourceId
      || row.ticketNo

    rawItems.push({
      itemId,
      grantType,
      grantLabel,
      ticketNo: row.ticketNo,
      resourceId: row.command?.resourceId ?? row.ticketNo,
      resourceName: String(resourceName),
      ownerAccount: row.account || '',
      ownerName: ownerProfile?.name || row.account || '未知',
      org: row.org || ownerProfile?.org || '待归属',
      issuedAt: new Date(issuedMs).toISOString(),
      baseExpiresAt: new Date(baseExpiresMs).toISOString(),
    })
  }

  // 2. Dify live API keys (if any exist directly in Dify)
  const inv = subsystems?.getDifyInventory?.() ?? {apiKeys: []}
  for (const key of inv.apiKeys ?? []) {
    const itemId = `dify-key:${key.keyId}`
    if (seen.has(itemId)) continue
    seen.add(itemId)
    const issuedMs = parseMs(key.createdAt) ?? now
    const baseExpiresMs = issuedMs + DEFAULT_VALID_DAYS.key * DAY_MS
    rawItems.push({
      itemId,
      grantType: 'key',
      grantLabel: 'Dify 应用密钥',
      ticketNo: null,
      resourceId: key.keyId,
      resourceName: `${key.appName || '应用'} (${key.tokenPreview || key.keyId.slice(0, 8)})`,
      ownerAccount: key.ownerAccount || '',
      ownerName: key.ownerName || 'Dify 工作区',
      org: key.org || '待归属',
      issuedAt: new Date(issuedMs).toISOString(),
      baseExpiresAt: new Date(baseExpiresMs).toISOString(),
    })
  }

  // 3. Accounts with explicit expiresAt
  for (const p of directory.subjects()) {
    if (!p.expiresAt) continue
    const itemId = `account:${p.subjectId}`
    if (seen.has(itemId)) continue
    seen.add(itemId)
    rawItems.push({
      itemId,
      grantType: 'account',
      grantLabel: '临时账号有效期',
      ticketNo: null,
      resourceId: p.subjectId,
      resourceName: `${p.name} (${p.account})`,
      ownerAccount: p.account,
      ownerName: p.name,
      org: p.org || '待归属',
      issuedAt: p.createdAt || new Date(now).toISOString(),
      baseExpiresAt: p.expiresAt,
    })
  }

  const items = rawItems.map(item => {
    const ov = overrides.get(item.itemId)
    const expiresAt = ov?.expiresAt || item.baseExpiresAt
    const expiresMs = parseMs(expiresAt) ?? now
    const daysRemaining = Math.ceil((expiresMs - now) / DAY_MS)
    const revokedAt = ov?.revokedAt || null
    let status = '正常有效'
    if (revokedAt) status = '已回收'
    else if (daysRemaining < 0) status = '已过期未回收'
    else if (daysRemaining <= 7) status = '即将到期'

    return {
      ...item,
      expiresAt,
      daysRemaining,
      status,
      revokedAt,
      revokedBy: ov?.revokedBy || null,
      revokeReason: ov?.revokeReason || null,
      renewedCount: ov?.renewedCount || 0,
    }
  })

  // Sort: expired first, then expiringSoon, then active, then revoked
  const rank = {'已过期未回收': 0, '即将到期': 1, '正常有效': 2, '已回收': 3}
  items.sort((a, b) => (rank[a.status] - rank[b.status]) || (a.daysRemaining - b.daysRemaining))

  return {
    capturedAt: new Date(now).toISOString(),
    summary: {
      total: items.length,
      expired: items.filter(i => i.status === '已过期未回收').length,
      expiringSoon: items.filter(i => i.status === '即将到期').length,
      active: items.filter(i => i.status === '正常有效').length,
      revoked: items.filter(i => i.status === '已回收').length,
    },
    items,
  }
}

export async function routeExpirations(services) {
  const {applications, directory, hasRole, identity, options, path, req, res, subsystems, tickets} = services
  check(identity?.active && (hasRole(identity, 'admin') || hasRole(identity, 'operator')), 403, 'ACCESS_DENIED')

  const now = (options.now ?? Date.now)()
  const store = directory.store

  if (req.method === 'GET' && path === '/api/expirations') {
    const url = new URL(req.url, 'http://localhost')
    const status = url.searchParams.get('status') || ''
    const grantType = url.searchParams.get('grantType') || ''
    const q = (url.searchParams.get('q') || '').trim().toLowerCase()

    const report = collectExpirableItems({applications, tickets, directory, subsystems, now})
    let items = report.items
    if (status) items = items.filter(i => i.status === status)
    if (grantType) items = items.filter(i => i.grantType === grantType)
    if (q) {
      items = items.filter(i =>
        [i.resourceName, i.ownerName, i.ownerAccount, i.org, i.ticketNo, i.grantLabel]
          .some(v => String(v ?? '').toLowerCase().includes(q)),
      )
    }
    return json(res, {...report, items})
  }

  check(req.method === 'POST' && (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host), 403, 'ACCESS_DENIED')
  const input = await body(req)
  const at = new Date(now).toISOString()

  if (path === '/api/expirations/renew') {
    const itemId = String(input?.itemId ?? '').trim()
    const extendDays = Number(input?.extendDays ?? 90)
    const reason = String(input?.reason ?? '运营审核续期').trim()
    check(itemId, 400, 'INVALID_ITEM')
    check(Number.isFinite(extendDays) && extendDays >= 1 && extendDays <= 730, 400, 'INVALID_DAYS', '续期天数需在 1～730 天之间')

    const report = collectExpirableItems({applications, tickets, directory, subsystems, now})
    const target = report.items.find(i => i.itemId === itemId)
    check(target, 404, 'NOT_FOUND')

    const prev = store.get(`exp:${itemId}`)
    const baseMs = Math.max(now, parseMs(target.expiresAt) ?? now)
    const nextExpiresAt = new Date(baseMs + extendDays * DAY_MS).toISOString()

    const saved = store.put(`exp:${itemId}`, {
      kind: 'grant-expiration',
      itemId,
      expiresAt: nextExpiresAt,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      renewedCount: (prev?.renewedCount ?? 0) + 1,
      history: [...(prev?.history ?? []), {at, actor: identity.account, action: `续期 ${extendDays} 天`, note: reason, expiresAt: nextExpiresAt}],
    })
    return json(res, {ok: true, itemId, expiresAt: saved.expiresAt})
  }

  if (path === '/api/expirations/revoke') {
    const itemIds = Array.isArray(input?.itemIds)
      ? input.itemIds.filter(x => typeof x === 'string' && x.trim())
      : (typeof input?.itemId === 'string' && input.itemId.trim() ? [input.itemId.trim()] : [])
    const reason = String(input?.reason ?? '到期自动/人工回收').trim()
    check(itemIds.length > 0 && itemIds.length <= 100, 400, 'INVALID_ITEMS')

    const report = collectExpirableItems({applications, tickets, directory, subsystems, now})
    const byId = new Map(report.items.map(i => [i.itemId, i]))
    const revoked = []

    for (const itemId of itemIds) {
      const target = byId.get(itemId)
      if (!target || target.status === '已回收') continue
      const prev = store.get(`exp:${itemId}`)
      store.put(`exp:${itemId}`, {
        kind: 'grant-expiration',
        itemId,
        expiresAt: target.expiresAt,
        revokedAt: at,
        revokedBy: identity.account,
        revokeReason: reason,
        renewedCount: prev?.renewedCount ?? 0,
        history: [...(prev?.history ?? []), {at, actor: identity.account, action: '回收失效授权', note: reason}],
      })
      // If it's a temporary account, also deactivate it in directory
      if (itemId.startsWith('account:')) {
        const subjectId = itemId.slice('account:'.length)
        const p = directory.get(subjectId)
        if (p && p.active && p.account !== identity.account) {
          store.put(`person:${subjectId}`, {
            ...p,
            active: false,
            revision: (p.revision ?? 1) + 1,
            deactivatedAt: at,
            deactivatedBy: identity.account,
            deactivationReason: `账号到期回收：${reason}`,
          })
        }
      }
      revoked.push(itemId)
    }

    return json(res, {ok: true, revokedCount: revoked.length, revoked})
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
