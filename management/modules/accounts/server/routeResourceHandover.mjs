import {body, check, id, json} from '../../../../runtime/http.mjs'

function countOwnedDifyResources(inventory, account, email) {
  const match = (ownerAccount, ownerEmail) => {
    const acc = String(account || '').toLowerCase()
    const mail = String(email || '').toLowerCase()
    const oa = String(ownerAccount || '').toLowerCase()
    const oe = String(ownerEmail || '').toLowerCase()
    return (acc && oa === acc) || (mail && (oe === mail || oa === mail))
  }
  const apps = (inventory?.apps ?? []).filter(a => match(a.ownerAccount, a.ownerEmail))
  const datasets = (inventory?.datasets ?? []).filter(d => match(d.ownerAccount, d.ownerEmail))
  const plugins = (inventory?.plugins ?? []).filter(p => match(p.ownerAccount, p.ownerEmail))
  const mcpProviders = (inventory?.mcpProviders ?? []).filter(m => match(m.ownerAccount, m.ownerEmail))
  const apiKeys = (inventory?.apiKeys ?? []).filter(k => match(k.ownerAccount, k.ownerEmail))
  return {
    difyApps: apps.length,
    difyDatasets: datasets.length,
    difyPlugins: plugins.length,
    difyMcp: mcpProviders.length,
    difyKeys: apiKeys.length,
    sampleApps: apps.slice(0, 5).map(a => a.name),
    sampleDatasets: datasets.slice(0, 5).map(d => d.name),
  }
}

export async function routeResourceHandover(services) {
  const {applications, directory, events, hasRole, identity, options, path, req, res, subsystems, tickets} = services
  check(identity?.active && (hasRole(identity, 'admin') || hasRole(identity, 'operator')), 403, 'ACCESS_DENIED')

  const now = (options.now ?? Date.now)()
  const store = directory.store
  const listHistory = () => store.all()
    .filter(r => r && r.kind === 'resource-handover')
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  if (req.method === 'GET' && path === '/api/resource-handover') {
    const url = new URL(req.url, 'http://localhost')
    const fromAccount = (url.searchParams.get('fromAccount') || '').trim()
    const subjects = directory.subjects().map(p => ({
      account: p.account,
      name: p.name,
      email: p.email || '',
      org: p.org || '待归属',
      active: Boolean(p.active),
      roles: p.roles ?? [],
    }))

    let preview = null
    if (fromAccount) {
      const src = directory.byAccount(fromAccount)
      if (src) {
        const inv = subsystems?.getDifyInventory?.() ?? {apps: [], datasets: [], plugins: [], mcpProviders: [], apiKeys: []}
        const difyCounts = countOwnedDifyResources(inv, src.account, src.email)
        const ownedApps = applications.records().filter(r => r.account === src.account)
        const ownedTickets = tickets.all().filter(r => r.account === src.account || r.command?.account === src.account)
        const ownedEvents = events.all().filter(r => (r.account === src.account || r.handler === src.account) && r.status !== '已关闭')
        preview = {
          account: src.account,
          name: src.name,
          org: src.org || '待归属',
          active: Boolean(src.active),
          applicationsCount: ownedApps.length,
          ticketsCount: ownedTickets.length,
          openEventsCount: ownedEvents.length,
          ...difyCounts,
        }
      }
    }

    return json(res, {
      capturedAt: new Date(now).toISOString(),
      accounts: subjects,
      preview,
      history: listHistory(),
    })
  }

  if (req.method === 'POST' && path === '/api/resource-handover') {
    check(!req.headers.origin || new URL(req.headers.origin).host === req.headers.host, 403, 'ACCESS_DENIED')
    const input = await body(req)
    const fromAccount = String(input?.fromAccount ?? '').trim()
    const toAccount = String(input?.toAccount ?? '').trim()
    const handoverType = String(input?.handoverType ?? '离职交接').trim()
    const reason = String(input?.reason ?? '').trim()
    const deactivateSource = Boolean(input?.deactivateSource)

    check(fromAccount && toAccount && fromAccount !== toAccount, 400, 'INVALID_ACCOUNTS', '移交人与接任人必须为不同的有效账号')
    check(['离职交接', '调岗交接', '临时托管'].includes(handoverType), 400, 'INVALID_HANDOVER_TYPE')
    check(reason.length >= 2 && reason.length <= 2000, 400, 'INVALID_REASON', '请填写交接原因说明')

    const src = directory.byAccount(fromAccount)
    const dst = directory.byAccount(toAccount)
    check(src, 404, 'SOURCE_NOT_FOUND', '移交人账号不存在')
    check(dst && dst.active, 409, 'TARGET_INACTIVE', '接任人账号不存在或已停用')
    if (deactivateSource) {
      check(src.account !== identity.account, 409, 'CANNOT_DEACTIVATE_SELF', '不可在交接时停用当前登录账号')
    }

    const at = new Date(now).toISOString()
    const ticketNo = `ACC-03-${id().slice(0, 8)}`
    const inv = subsystems?.getDifyInventory?.() ?? {apps: [], datasets: [], plugins: [], mcpProviders: [], apiKeys: []}
    const difyCounts = countOwnedDifyResources(inv, src.account, src.email)

    // 1. Transfer App Center applications
    let transferredApplications = 0
    if (typeof applications.put === 'function') {
      for (const row of applications.records()) {
        if (row.account !== src.account) continue
        applications.put(row.ticketNo, {
          ...row,
          account: dst.account,
          org: dst.org || row.org,
          previousOwner: src.account,
          handoverTicketNo: ticketNo,
          history: [...(row.history ?? []), {
            at,
            actor: identity.account,
            action: `${handoverType}（${ticketNo}）`,
            note: `资源所有权由 ${src.name}(${src.account}) 移交至 ${dst.name}(${dst.account})：${reason}`,
          }],
        })
        transferredApplications += 1
      }
    }

    // 2. Transfer App Center tickets
    let transferredTickets = 0
    if (typeof tickets.put === 'function') {
      for (const row of tickets.all()) {
        if (row.account !== src.account && row.command?.account !== src.account) continue
        tickets.put(row.ticketNo, {
          ...row,
          account: row.account === src.account ? dst.account : row.account,
          org: dst.org || row.org,
          previousOwner: src.account,
          handoverTicketNo: ticketNo,
          history: [...(row.history ?? []), {
            at,
            actor: identity.account,
            action: `${handoverType}（${ticketNo}）`,
            note: `工单归属由 ${src.name}(${src.account}) 移交至 ${dst.name}(${dst.account})：${reason}`,
          }],
        })
        transferredTickets += 1
      }
    }

    // 3. Reassign open security events
    let transferredEvents = 0
    for (const ev of events.all()) {
      if (ev.status === '已关闭') continue
      if (ev.handler !== src.account && ev.account !== src.account) continue
      events.put(ev.ticketNo, {
        ...ev,
        account: ev.account === src.account ? dst.account : ev.account,
        handler: ev.handler === src.account ? dst.account : ev.handler,
        revision: (ev.revision ?? 1) + 1,
        history: [...(ev.history ?? []), {
          at,
          actor: identity.account,
          action: `${handoverType}转派（${ticketNo}）`,
          fromStatus: ev.status,
          toStatus: ev.status,
          note: `由 ${src.name}(${src.account}) 交接至 ${dst.name}(${dst.account})`,
        }],
      })
      transferredEvents += 1
    }

    // 4. Optionally deactivate source account in directory
    let sourceDeactivated = false
    if (deactivateSource && src.active) {
      store.put(`person:${src.subjectId}`, {
        ...src,
        active: false,
        revision: (src.revision ?? 1) + 1,
        deactivatedAt: at,
        deactivatedBy: identity.account,
        deactivationReason: `${handoverType}（${ticketNo}）：${reason}`,
      })
      sourceDeactivated = true
    }

    const record = store.put(`handover:${ticketNo}`, {
      kind: 'resource-handover',
      ticketNo,
      handoverType,
      fromAccount: src.account,
      fromName: src.name,
      fromOrg: src.org || '待归属',
      toAccount: dst.account,
      toName: dst.name,
      toOrg: dst.org || '待归属',
      reason,
      sourceDeactivated,
      transferredApplications,
      transferredTickets,
      transferredEvents,
      difySummary: {
        apps: difyCounts.difyApps,
        datasets: difyCounts.difyDatasets,
        plugins: difyCounts.difyPlugins,
        mcp: difyCounts.difyMcp,
        keys: difyCounts.difyKeys,
      },
      status: '已完成',
      operator: identity.account,
      operatorName: identity.name || identity.account,
      createdAt: at,
    })

    return json(res, {ok: true, record}, 201)
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
