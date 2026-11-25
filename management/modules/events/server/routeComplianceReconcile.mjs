import {body, check, id, json} from '../../../../runtime/http.mjs'
import {reconcileDifyCompliance} from './compliance-reconcile.mjs'

export async function routeComplianceReconcile(services) {
  const {applications, events, hasRole, identity, options, path, req, res, subsystems, tickets, types} = services
  check(identity?.active && (hasRole(identity, 'operator') || hasRole(identity, 'admin')), 403, 'ACCESS_DENIED')

  const now = (options.now ?? Date.now)()

  if (req.method === 'GET' && path === '/api/compliance-reconcile') {
    const url = new URL(req.url, 'http://localhost')
    const refresh = url.searchParams.get('refresh') === '1'
    const category = url.searchParams.get('category') || ''
    const status = url.searchParams.get('status') || ''
    const q = (url.searchParams.get('q') || '').trim().toLowerCase()

    const inventory = refresh && subsystems?.refreshDifyInventory
      ? await subsystems.refreshDifyInventory()
      : (subsystems?.getDifyInventory?.() ?? {syncedAt: null, apps: [], datasets: [], mcpProviders: [], plugins: [], apiKeys: []})

    const report = reconcileDifyCompliance({
      inventory,
      tickets: tickets.all(),
      applications: applications.records(),
      events: events.all(),
      now,
    })

    let filtered = report.items
    if (category) filtered = filtered.filter(item => item.category === category)
    if (status) filtered = filtered.filter(item => item.remediationStatus === status)
    if (q) {
      filtered = filtered.filter(item =>
        [item.resourceName, item.resourceId, item.workspaceName, item.ownerName, item.org, item.categoryLabel, item.detail]
          .some(v => String(v ?? '').toLowerCase().includes(q)),
      )
    }

    return json(res, {
      ...report,
      totalFiltered: filtered.length,
      items: filtered,
    })
  }

  if (req.method === 'POST' && path === '/api/compliance-reconcile/create-event') {
    check(!req.headers.origin || new URL(req.headers.origin).host === req.headers.host, 403, 'ACCESS_DENIED')
    const input = await body(req)
    const targetIds = Array.isArray(input?.findingIds)
      ? input.findingIds.filter(x => typeof x === 'string' && x.trim())
      : (typeof input?.findingId === 'string' && input.findingId.trim() ? [input.findingId.trim()] : [])
    check(targetIds.length > 0 && targetIds.length <= 100, 400, 'INVALID_FINDING_IDS', '请选择至少一条待处置的合规异常项')

    const inventory = subsystems?.getDifyInventory?.() ?? {syncedAt: null, apps: [], datasets: [], mcpProviders: [], plugins: [], apiKeys: []}
    const report = reconcileDifyCompliance({
      inventory,
      tickets: tickets.all(),
      applications: applications.records(),
      events: events.all(),
      now,
    })
    const byId = new Map(report.items.map(item => [item.findingId, item]))
    const at = new Date(now).toISOString()
    const created = []
    const skipped = []

    for (const fid of targetIds) {
      const finding = byId.get(fid)
      if (!finding) {
        skipped.push({findingId: fid, reason: 'NOT_FOUND'})
        continue
      }
      if (finding.linkedEventTicketNo && finding.linkedEventStatus !== '已关闭') {
        skipped.push({findingId: fid, reason: 'ALREADY_TICKETED', ticketNo: finding.linkedEventTicketNo})
        continue
      }
      const ticketNo = `EVT-01-REC-${id().slice(0, 8)}`
      const record = events.put(ticketNo, {
        ticketNo,
        account: identity.account,
        resourceId: finding.resourceId,
        resourceName: finding.resourceName,
        originDraft: null,
        facts: finding.detail,
        objectType: finding.objectType,
        creationMode: '自动巡检',
        alertId: 'AL-' + id(),
        ruleCode: finding.ruleCode,
        reconcileFindingId: finding.findingId,
        originalSeverity: finding.severity,
        firstOccurredAt: finding.detectedAt || at,
        lastOccurredAt: at,
        evidence: {facts: finding.detail},
        status: '未研判',
        version: types.activeVersion('EVT-01'),
        revision: 1,
        history: [{
          at,
          actor: identity.account,
          action: '合规对账建单',
          fromStatus: null,
          toStatus: '未研判',
          note: `${finding.categoryLabel}：${finding.resourceName}（工作区：${finding.workspaceName}）`,
        }],
      })
      created.push({findingId: fid, ticketNo: record.ticketNo})
    }

    return json(res, {ok: true, created, skipped}, 201)
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
