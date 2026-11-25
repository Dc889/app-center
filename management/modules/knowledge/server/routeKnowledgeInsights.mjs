import {check, id, json} from '../../../../runtime/http.mjs'

const DAY_MS = 86_400_000

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function scoreDataset(ds, kb03GrantsCount, now) {
  // 1. Reuse & Heat (max 40): app mounts (up to 18) + 30d queries (up to 14) + KB-03 cross-dept grants (up to 8)
  const appPoints = clamp((ds.appCount || 0) * 6, 0, 18)
  const queryPoints = clamp(Math.round(Math.log1p(ds.queryCount30d || ds.totalQueries || 0) * 4.5), 0, 14)
  const grantPoints = clamp(kb03GrantsCount * 4, 0, 8)
  const reuseScore = appPoints + queryPoints + grantPoints

  // 2. Retrieval Quality (max 35): hitCount (up to 15) + avgScore (up to 20, or 10 baseline if docs indexed cleanly)
  const hitPoints = clamp(Math.round(Math.log1p(ds.hitCount || 0) * 5), 0, 15)
  const scorePoints = ds.avgScore !== null && ds.avgScore !== undefined
    ? clamp(Math.round(ds.avgScore * 20), 0, 20)
    : (ds.documentCount > 0 && ds.indexingHealthPct >= 90 ? 10 : 0)
  const qualityScore = hitPoints + scorePoints

  // 3. Scale & Maintenance Health (max 25): doc scale (up to 10) + indexing health (up to 10) + recent update within 30d (5)
  const scalePoints = clamp((ds.documentCount || 0) * 2, 0, 10)
  const healthPoints = Math.round(((ds.indexingHealthPct ?? 100) / 100) * 10)
  const lastMs = ds.lastDocUpdatedAt ? Date.parse(ds.lastDocUpdatedAt) : (ds.createdAt ? Date.parse(ds.createdAt) : 0)
  const daysSinceUpdate = lastMs ? Math.floor((now - lastMs) / DAY_MS) : 999
  const activePoints = daysSinceUpdate <= 30 ? 5 : daysSinceUpdate <= 90 ? 2 : 0
  const healthScore = scalePoints + healthPoints + activePoints

  const totalScore = clamp(reuseScore + qualityScore + healthScore, 0, 100)
  const isZombie = (ds.documentCount === 0)
    || ((ds.totalQueries || 0) === 0 && (ds.appCount || 0) === 0 && daysSinceUpdate > 90)
    || (ds.documentCount > 0 && (ds.indexingHealthPct ?? 100) < 50)

  return {
    reuseScore,
    qualityScore,
    healthScore,
    totalScore,
    daysSinceUpdate,
    isZombie,
  }
}

export async function routeKnowledgeInsights(services) {
  const {applications, directory, events, hasRole, identity, options, path, req, res, subsystems, tickets, types} = services
  check(identity?.active && (hasRole(identity, 'operator') || hasRole(identity, 'admin')), 403, 'ACCESS_DENIED')
  const now = (options.now ?? Date.now)()
  const store = directory.store

  const buildReport = async (refresh = false) => {
    const inv = refresh && subsystems?.refreshDifyInventory
      ? await subsystems.refreshDifyInventory()
      : (subsystems?.getDifyInventory?.() ?? {syncedAt: null, datasets: []})

    // Count KB-03 grants per dataset
    const grantsByDataset = new Map()
    for (const row of [...applications.records(), ...tickets.all()]) {
      const t = String(row.ticketType ?? row.command?.ticketType ?? '').toUpperCase()
      if (t !== 'KB-03') continue
      const rid = String(row.command?.resourceId ?? row.submission?.resourceId ?? '').trim()
      if (rid) grantsByDataset.set(rid, (grantsByDataset.get(rid) || 0) + 1)
    }

    const items = (inv.datasets ?? []).map(ds => {
      const grants = grantsByDataset.get(ds.resourceId) || 0
      const scores = scoreDataset(ds, grants, now)
      const baseline = store.get(`kb-fp:${ds.resourceId}`)
      const drifted = Boolean(baseline && baseline.fingerprint && ds.contentFingerprint && baseline.fingerprint !== ds.contentFingerprint)

      let tier = '正常活跃'
      if (drifted) tier = '变更待复审'
      else if (scores.isZombie) tier = '僵尸待治理'
      else if (scores.totalScore >= 55 && (ds.appCount > 0 || ds.totalQueries > 0 || ds.documentCount >= 2)) tier = '标杆推荐'

      return {
        resourceId: ds.resourceId,
        name: ds.name,
        workspaceId: ds.workspaceId,
        workspaceName: ds.workspaceName,
        ownerAccount: ds.ownerAccount,
        ownerName: ds.ownerName,
        org: ds.org,
        permission: ds.permission,
        documentCount: ds.documentCount ?? 0,
        completedDocCount: ds.completedDocCount ?? 0,
        indexingHealthPct: ds.indexingHealthPct ?? 100,
        segmentCount: ds.segmentCount ?? 0,
        appCount: ds.appCount ?? 0,
        queryCount30d: ds.queryCount30d ?? 0,
        totalQueries: ds.totalQueries ?? 0,
        hitCount: ds.hitCount ?? 0,
        avgScore: ds.avgScore ?? null,
        kb03Grants: grants,
        lastDocUpdatedAt: ds.lastDocUpdatedAt ?? null,
        contentFingerprint: ds.contentFingerprint ?? '',
        drifted,
        tier,
        ...scores,
      }
    }).sort((a, b) => (b.totalScore - a.totalScore) || (b.appCount - a.appCount) || (b.totalQueries - a.totalQueries))

    return {
      capturedAt: new Date(now).toISOString(),
      syncedAt: inv.syncedAt || null,
      summary: {
        total: items.length,
        featured: items.filter(i => i.tier === '标杆推荐').length,
        active: items.filter(i => i.tier === '正常活跃').length,
        zombie: items.filter(i => i.tier === '僵尸待治理').length,
        drifted: items.filter(i => i.drifted).length,
      },
      items,
    }
  }

  if (req.method === 'GET' && path === '/api/knowledge-insights') {
    const url = new URL(req.url, 'http://localhost')
    return json(res, await buildReport(url.searchParams.get('refresh') === '1'))
  }

  if (req.method === 'POST' && path === '/api/knowledge-insights/check-drift') {
    check(!req.headers.origin || new URL(req.headers.origin).host === req.headers.host, 403, 'ACCESS_DENIED')
    const report = await buildReport(true)
    const at = new Date(now).toISOString()
    let baselined = 0
    let driftedCount = 0
    let eventsCreated = 0

    for (const item of report.items) {
      if (!item.contentFingerprint) continue
      const key = `kb-fp:${item.resourceId}`
      const prev = store.get(key)
      if (!prev) {
        store.put(key, {kind: 'kb-fingerprint', resourceId: item.resourceId, fingerprint: item.contentFingerprint, documentCount: item.documentCount, recordedAt: at})
        baselined += 1
        continue
      }
      if (prev.fingerprint !== item.contentFingerprint) {
        driftedCount += 1
        const alreadyOpen = events.all().some(e => e.ruleCode === 'KB_SILENT_MODIFIED' && e.resourceId === item.resourceId && e.status !== '已关闭')
        if (!alreadyOpen) {
          const ticketNo = `EVT-01-KB-${id().slice(0, 8)}`
          const detail = `知识库「${item.name}」（${item.ownerName} · ${item.org}）在 Dify 后台发生文档变动（文档数 ${prev.documentCount} → ${item.documentCount}，指纹 ${prev.fingerprint.slice(0, 8)} → ${item.contentFingerprint.slice(0, 8)}），请复核内容合规性并走 KB-04 变更复审。`
          events.put(ticketNo, {
            ticketNo,
            account: identity.account,
            resourceId: item.resourceId,
            resourceName: item.name,
            originDraft: null,
            facts: detail,
            objectType: '知识库',
            creationMode: '自动巡检',
            alertId: 'AL-' + id(),
            ruleCode: 'KB_SILENT_MODIFIED',
            originalSeverity: '一般',
            firstOccurredAt: at,
            lastOccurredAt: at,
            evidence: {facts: detail},
            status: '未研判',
            version: types.activeVersion('EVT-01'),
            revision: 1,
            history: [{at, actor: identity.account, action: '知识库内容指纹漂移告警', fromStatus: null, toStatus: '未研判', note: detail}],
          })
          eventsCreated += 1
        }
        // Refresh baseline after alerting so repeated sweeps don't spam
        store.put(key, {kind: 'kb-fingerprint', resourceId: item.resourceId, fingerprint: item.contentFingerprint, documentCount: item.documentCount, recordedAt: at})
      }
    }

    return json(res, {ok: true, checked: report.items.length, baselined, driftedCount, eventsCreated})
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
