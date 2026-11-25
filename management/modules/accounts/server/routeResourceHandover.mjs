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

function executeTransfer({src, dst, handoverType, reason, deactivateSource, ticketNo, actor, at, applications, tickets, events, store}) {
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
          actor,
          action: `${handoverType}（${ticketNo}）`,
          note: `资源所有权由 ${src.name}(${src.account}) 移交至 ${dst.name}(${dst.account})：${reason}`,
        }],
      })
      transferredApplications += 1
    }
  }

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
          actor,
          action: `${handoverType}（${ticketNo}）`,
          note: `工单归属由 ${src.name}(${src.account}) 移交至 ${dst.name}(${dst.account})：${reason}`,
        }],
      })
      transferredTickets += 1
    }
  }

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
        actor,
        action: `${handoverType}转派（${ticketNo}）`,
        fromStatus: ev.status,
        toStatus: ev.status,
        note: `由 ${src.name}(${src.account}) 交接至 ${dst.name}(${dst.account})`,
      }],
    })
    transferredEvents += 1
  }

  let sourceDeactivated = false
  if (deactivateSource && src.active && src.account !== actor) {
    store.put(`person:${src.subjectId}`, {
      ...src,
      active: false,
      revision: (src.revision ?? 1) + 1,
      deactivatedAt: at,
      deactivatedBy: actor,
      deactivationReason: `${handoverType}（${ticketNo}）：${reason}`,
    })
    sourceDeactivated = true
  }

  return {transferredApplications, transferredTickets, transferredEvents, sourceDeactivated}
}

export async function routeResourceHandover(services) {
  const {applications, directory, events, hasRole, identity, options, path, req, res, subsystems, tickets} = services
  check(identity?.active, 403, 'ACCESS_DENIED')

  const isStaff = hasRole(identity, 'admin') || hasRole(identity, 'operator')
  const now = (options.now ?? Date.now)()
  const store = directory.store
  const listHistory = () => store.all()
    .filter(r => r && r.kind === 'resource-handover')
    .filter(r => isStaff || r.fromAccount === identity.account || r.applicant === identity.account)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  if (req.method === 'GET' && path === '/api/resource-handover') {
    const url = new URL(req.url, 'http://localhost')
    const requestedFrom = (url.searchParams.get('fromAccount') || '').trim()
    const fromAccount = isStaff ? requestedFrom : identity.account
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
      currentAccount: identity.account,
      isStaff,
      accounts: subjects,
      preview,
      history: listHistory(),
    })
  }

  check(req.method === 'POST' && (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host), 403, 'ACCESS_DENIED')
  const input = await body(req)
  const at = new Date(now).toISOString()

  if (path === '/api/resource-handover') {
    const fromAccount = isStaff ? String(input?.fromAccount ?? '').trim() : identity.account
    const toAccount = String(input?.toAccount ?? '').trim()
    const handoverType = String(input?.handoverType ?? '调岗交接').trim()
    const reason = String(input?.reason ?? '').trim()
    const deactivateSource = isStaff ? Boolean(input?.deactivateSource) : false

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

    const ticketNo = `ACC-03-${id().slice(0, 8)}`
    const inv = subsystems?.getDifyInventory?.() ?? {apps: [], datasets: [], plugins: [], mcpProviders: [], apiKeys: []}
    const difyCounts = countOwnedDifyResources(inv, src.account, src.email)

    // Regular users submit a pending approval ticket; admins/ops execute immediately
    if (!isStaff || input?.mode === 'request') {
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
        sourceDeactivated: false,
        transferredApplications: 0,
        transferredTickets: 0,
        transferredEvents: 0,
        difySummary: {
          apps: difyCounts.difyApps,
          datasets: difyCounts.difyDatasets,
          plugins: difyCounts.difyPlugins,
          mcp: difyCounts.difyMcp,
          keys: difyCounts.difyKeys,
        },
        status: '待审批',
        applicant: identity.account,
        operator: identity.account,
        operatorName: identity.name || identity.account,
        createdAt: at,
      })
      return json(res, {ok: true, record}, 201)
    }

    const transfer = executeTransfer({
      src, dst, handoverType, reason, deactivateSource, ticketNo, actor: identity.account, at,
      applications, tickets, events, store,
    })

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
      ...transfer,
      difySummary: {
        apps: difyCounts.difyApps,
        datasets: difyCounts.difyDatasets,
        plugins: difyCounts.difyPlugins,
        mcp: difyCounts.difyMcp,
        keys: difyCounts.difyKeys,
      },
      status: '已完成',
      applicant: identity.account,
      operator: identity.account,
      operatorName: identity.name || identity.account,
      createdAt: at,
    })

    return json(res, {ok: true, record}, 201)
  }

  if (path === '/api/resource-handover/approve') {
    check(isStaff, 403, 'ACCESS_DENIED')
    const ticketNo = String(input?.ticketNo ?? '').trim()
    const decision = input?.decision === 'reject' ? 'reject' : 'approve'
    const deactivateSource = Boolean(input?.deactivateSource)
    const reviewNote = String(input?.reviewNote ?? (decision === 'approve' ? '同意交接并执行' : '驳回交接申请')).trim()

    const existing = store.get(`handover:${ticketNo}`)
    check(existing && existing.status === '待审批', 404, 'TICKET_NOT_PENDING', '该交接申请不存在或已办理')

    if (decision === 'reject') {
      const updated = store.put(`handover:${ticketNo}`, {
        ...existing,
        status: '已驳回',
        reviewedAt: at,
        reviewer: identity.account,
        reviewNote,
      })
      return json(res, {ok: true, record: updated})
    }

    const src = directory.byAccount(existing.fromAccount)
    const dst = directory.byAccount(existing.toAccount)
    check(src && dst && dst.active, 409, 'ACCOUNT_INVALID', '移交人或接任人账号状态异常')

    const transfer = executeTransfer({
      src, dst,
      handoverType: existing.handoverType,
      reason: existing.reason,
      deactivateSource,
      ticketNo,
      actor: identity.account,
      at,
      applications, tickets, events, store,
    })

    const updated = store.put(`handover:${ticketNo}`, {
      ...existing,
      ...transfer,
      status: '已完成',
      reviewedAt: at,
      reviewer: identity.account,
      reviewNote,
    })
    return json(res, {ok: true, record: updated})
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
