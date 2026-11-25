import {createHash} from 'node:crypto'
import {body, check, id, json} from '../../../../runtime/http.mjs'

async function probeMcpUrl(rawUrl, timeoutMs = 4000) {
  const url = String(rawUrl ?? '').trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    return {status: '未配置地址', latencyMs: null, checkedAt: new Date().toISOString()}
  }
  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'app-center-probe', version: '1.0'}},
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const latencyMs = Date.now() - started
    const ok = res.status >= 200 && res.status < 500
    return {status: ok ? '健康' : '异常', latencyMs, httpStatus: res.status, checkedAt: new Date().toISOString()}
  } catch (err) {
    const latencyMs = Date.now() - started
    const timedOut = String(err?.name || '').includes('Timeout') || String(err?.message || '').includes('timeout')
    return {status: timedOut ? '超时' : '不可达', latencyMs, checkedAt: new Date().toISOString()}
  }
}

export async function routeMcpGovernance(services) {
  const {directory, hasRole, identity, options, path, req, res, subsystems} = services
  const now = (options.now ?? Date.now)()
  const store = directory.store

  // 1. Controlled MCP Proxy Gateway (/api/mcp-proxy/<token>) — real-time auth + call metrics
  if (path.startsWith('/api/mcp-proxy/') && req.method === 'POST') {
    const token = decodeURIComponent(path.slice('/api/mcp-proxy/'.length)).trim()
    const grant = store.get(`mcp-proxy-grant:${token}`)
    check(grant && grant.active && !grant.isolated, 403, 'MCP_ACCESS_DENIED', '该 MCP 代理令牌无效、已过期或已被 MCP-03/04 隔离吊销')

    const payload = await body(req)
    const started = Date.now()
    try {
      const upstream = await fetch(grant.upstreamUrl, {
        method: 'POST',
        headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream'},
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      })
      const latencyMs = Date.now() - started
      const text = await upstream.text()
      const statKey = `mcp-proxy-stat:${grant.serverIdentifier}`
      const prev = store.get(statKey) ?? {kind: 'mcp-proxy-stat', serverIdentifier: grant.serverIdentifier, calls: 0, errors: 0, totalLatencyMs: 0}
      store.put(statKey, {
        ...prev,
        calls: prev.calls + 1,
        errors: prev.errors + (upstream.ok ? 0 : 1),
        totalLatencyMs: prev.totalLatencyMs + latencyMs,
        lastCalledAt: new Date(now).toISOString(),
      })
      res.writeHead(upstream.status, {'content-type': upstream.headers.get('content-type') || 'application/json'})
      res.end(text)
      return
    } catch (err) {
      const statKey = `mcp-proxy-stat:${grant.serverIdentifier}`
      const prev = store.get(statKey) ?? {kind: 'mcp-proxy-stat', serverIdentifier: grant.serverIdentifier, calls: 0, errors: 0, totalLatencyMs: 0}
      store.put(statKey, {...prev, calls: prev.calls + 1, errors: prev.errors + 1, lastCalledAt: new Date(now).toISOString()})
      return json(res, {error: {code: 'MCP_UPSTREAM_FAILED', message: err?.message || '上游 MCP 调用失败'}}, 502)
    }
  }

  check(identity?.active && (hasRole(identity, 'admin') || hasRole(identity, 'operator')), 403, 'ACCESS_DENIED')

  const buildSnapshot = (inv) => {
    const wsMap = new Map()
    for (const p of directory.subjects()) {
      if (p.difyWorkspaceId) {
        wsMap.set(p.difyWorkspaceId, {
          workspaceId: p.difyWorkspaceId,
          workspaceName: p.difyWorkspaceName || `${p.name}的工作区`,
          ownerAccount: p.account,
          ownerName: p.name,
          org: p.org || '待归属',
          boundMcps: new Set(),
        })
      }
    }
    for (const item of [...(inv.apps ?? []), ...(inv.mcpProviders ?? [])]) {
      if (!item?.workspaceId) continue
      if (!wsMap.has(item.workspaceId)) {
        wsMap.set(item.workspaceId, {
          workspaceId: item.workspaceId,
          workspaceName: item.workspaceName || item.workspaceId.slice(0, 8),
          ownerAccount: item.ownerAccount || '',
          ownerName: item.ownerName || item.workspaceName || 'Dify 工作区',
          org: item.org || '待归属',
          boundMcps: new Set(),
        })
      }
    }

    const mcpMap = new Map()
    for (const m of inv.mcpProviders ?? []) {
      const sid = String(m.serverIdentifier || m.name || m.providerId || '').trim()
      if (!sid) continue
      if (m.workspaceId && wsMap.has(m.workspaceId)) wsMap.get(m.workspaceId).boundMcps.add(sid)
      if (!mcpMap.has(sid)) {
        const probe = store.get(`mcp-probe:${sid}`)
        const pStat = store.get(`mcp-proxy-stat:${sid}`)
        const isolated = Boolean(store.get(`mcp-isolated:${sid}`)?.isolated)
        mcpMap.set(sid, {
          serverIdentifier: sid,
          name: m.name || sid,
          rawUrl: m.serverUrl || '',
          boundWorkspaces: new Set(),
          probeStatus: probe?.status || '待探测',
          latencyMs: probe?.latencyMs ?? null,
          checkedAt: probe?.checkedAt || null,
          proxyCalls: pStat?.calls ?? 0,
          proxyErrors: pStat?.errors ?? 0,
          avgProxyLatencyMs: pStat?.calls ? Math.round(pStat.totalLatencyMs / pStat.calls) : null,
          isolated,
        })
      }
      if (m.workspaceId) mcpMap.get(sid).boundWorkspaces.add(m.workspaceId)
    }

    const totalWorkspaces = wsMap.size
    const uniqueMcps = [...mcpMap.values()].map(m => ({
      serverIdentifier: m.serverIdentifier,
      name: m.name,
      boundWorkspacesCount: m.boundWorkspaces.size,
      totalWorkspacesCount: totalWorkspaces,
      probeStatus: m.isolated ? '已隔离' : m.probeStatus,
      latencyMs: m.latencyMs,
      checkedAt: m.checkedAt,
      proxyCalls: m.proxyCalls,
      proxyErrors: m.proxyErrors,
      avgProxyLatencyMs: m.avgProxyLatencyMs,
      isolated: m.isolated,
      // Keep internal rawUrl hidden from public JSON; only internal probe uses it
      _rawUrl: m.rawUrl,
    })).sort((a, b) => b.boundWorkspacesCount - a.boundWorkspacesCount)

    const workspaces = [...wsMap.values()].map(w => ({
      workspaceId: w.workspaceId,
      workspaceName: w.workspaceName,
      ownerAccount: w.ownerAccount,
      ownerName: w.ownerName,
      org: w.org,
      boundCount: w.boundMcps.size,
    })).sort((a, b) => a.boundCount - b.boundCount)

    const tickets = store.all()
      .filter(r => r && r.kind === 'mcp-batch-ticket')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

    return {uniqueMcps, workspaces, tickets}
  }

  if (req.method === 'GET' && path === '/api/mcp-governance') {
    const inv = subsystems?.getDifyInventory?.() ?? {syncedAt: null, apps: [], mcpProviders: []}
    const snap = buildSnapshot(inv)
    return json(res, {
      capturedAt: new Date(now).toISOString(),
      syncedAt: inv.syncedAt || null,
      uniqueMcps: snap.uniqueMcps.map(({_rawUrl, ...pub}) => pub),
      workspaces: snap.workspaces,
      tickets: snap.tickets,
    })
  }

  check(req.method === 'POST' && (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host), 403, 'ACCESS_DENIED')
  const input = await body(req)
  const at = new Date(now).toISOString()

  if (path === '/api/mcp-governance/probe') {
    const inv = subsystems?.getDifyInventory?.() ?? {apps: [], mcpProviders: []}
    const snap = buildSnapshot(inv)
    let healthy = 0
    let unhealthy = 0
    for (const m of snap.uniqueMcps) {
      const result = await probeMcpUrl(m._rawUrl)
      store.put(`mcp-probe:${m.serverIdentifier}`, {kind: 'mcp-probe', serverIdentifier: m.serverIdentifier, ...result})
      if (result.status === '健康') healthy++; else unhealthy++
    }
    return json(res, {ok: true, probed: snap.uniqueMcps.length, healthy, unhealthy})
  }

  if (path === '/api/mcp-governance/request') {
    const operationType = String(input?.operationType ?? '').trim()
    check(['新户默认绑定公开MCP', '公开MCP全员推送', '高危MCP全员解绑下架'].includes(operationType), 400, 'INVALID_OPERATION_TYPE')
    const targetWorkspaceId = String(input?.targetWorkspaceId ?? '').trim()
    const targetWorkspaceName = String(input?.targetWorkspaceName ?? '').trim()
    const targetMcpId = String(input?.targetMcpId ?? '').trim()
    const targetMcpName = String(input?.targetMcpName ?? '').trim()
    const reason = String(input?.reason ?? '').trim()

    if (operationType === '新户默认绑定公开MCP') check(targetWorkspaceId, 400, 'WORKSPACE_REQUIRED', '请选择目标新租户工作区')
    if (operationType !== '新户默认绑定公开MCP') check(targetMcpId, 400, 'MCP_REQUIRED', '请选择目标 MCP 服务')
    check(reason.length >= 2 && reason.length <= 1000, 400, 'INVALID_REASON', '请输入工单申请原因')

    const ticketNo = `MCP-04-${id().slice(0, 8)}`
    const ticket = store.put(`mcp-batch:${ticketNo}`, {
      kind: 'mcp-batch-ticket',
      ticketNo,
      operationType,
      targetWorkspaceId: targetWorkspaceId || null,
      targetWorkspaceName: targetWorkspaceName || null,
      targetMcpId: targetMcpId || null,
      targetMcpName: targetMcpName || targetMcpId || null,
      reason,
      applicant: identity.account,
      applicantName: identity.name || identity.account,
      org: identity.org || '平台运营组',
      status: '待审批',
      createdAt: at,
      reviewedAt: null,
      reviewer: null,
      reviewNote: null,
      executionSummary: null,
    })
    return json(res, {ok: true, ticket}, 201)
  }

  if (path === '/api/mcp-governance/approve') {
    const ticketNo = String(input?.ticketNo ?? '').trim()
    const decision = input?.decision === 'reject' ? 'reject' : 'approve'
    const reviewNote = String(input?.reviewNote ?? (decision === 'approve' ? '审批通过并已执行' : '驳回申请')).trim()
    const existing = store.get(`mcp-batch:${ticketNo}`)
    check(existing && existing.status === '待审批', 404, 'TICKET_NOT_PENDING', '该工单不存在或已办理')

    if (decision === 'reject') {
      const updated = store.put(`mcp-batch:${ticketNo}`, {...existing, status: '已驳回', reviewedAt: at, reviewer: identity.account, reviewNote})
      return json(res, {ok: true, ticket: updated})
    }

    const inv = subsystems?.getDifyInventory?.() ?? {apps: [], mcpProviders: []}
    const snap = buildSnapshot(inv)
    let executionSummary = ''

    if (existing.operationType === '高危MCP全员解绑下架') {
      store.put(`mcp-isolated:${existing.targetMcpId}`, {kind: 'mcp-isolated', serverIdentifier: existing.targetMcpId, isolated: true, ticketNo, at})
      let revokedGrants = 0
      for (const row of store.all()) {
        if (row?.kind === 'mcp-proxy-grant' && row.serverIdentifier === existing.targetMcpId && row.active) {
          store.put(`mcp-proxy-grant:${row.token}`, {...row, active: false, isolated: true, revokedAt: at, revokedBy: identity.account})
          revokedGrants += 1
        }
      }
      executionSummary = `已全局隔离 MCP「${existing.targetMcpName}」，吊销代理令牌 ${revokedGrants} 个并禁止新工作区绑定`
    } else if (existing.operationType === '公开MCP全员推送') {
      const target = snap.uniqueMcps.find(m => m.serverIdentifier === existing.targetMcpId)
      let issued = 0
      for (const ws of snap.workspaces) {
        const token = createHash('sha256').update(`${ws.workspaceId}:${existing.targetMcpId}`).digest('hex').slice(0, 24)
        store.put(`mcp-proxy-grant:${token}`, {
          kind: 'mcp-proxy-grant',
          token,
          workspaceId: ws.workspaceId,
          workspaceName: ws.workspaceName,
          serverIdentifier: existing.targetMcpId,
          upstreamUrl: target?._rawUrl || '',
          ticketNo,
          active: true,
          isolated: false,
          issuedAt: at,
        })
        issued += 1
      }
      store.put(`mcp-isolated:${existing.targetMcpId}`, {kind: 'mcp-isolated', serverIdentifier: existing.targetMcpId, isolated: false, ticketNo, at})
      executionSummary = `已向全平台 ${issued} 个工作区下发「${existing.targetMcpName}」受控代理授权令牌（/api/mcp-proxy/...）`
    } else if (existing.operationType === '新户默认绑定公开MCP') {
      const activeMcps = snap.uniqueMcps.filter(m => !m.isolated)
      let issued = 0
      for (const m of activeMcps) {
        const token = createHash('sha256').update(`${existing.targetWorkspaceId}:${m.serverIdentifier}`).digest('hex').slice(0, 24)
        store.put(`mcp-proxy-grant:${token}`, {
          kind: 'mcp-proxy-grant',
          token,
          workspaceId: existing.targetWorkspaceId,
          workspaceName: existing.targetWorkspaceName,
          serverIdentifier: m.serverIdentifier,
          upstreamUrl: m._rawUrl || '',
          ticketNo,
          active: true,
          isolated: false,
          issuedAt: at,
        })
        issued += 1
      }
      executionSummary = `已为工作区「${existing.targetWorkspaceName}」批量开通 ${issued} 个内网公开 MCP 的受控代理授权`
    }

    const updated = store.put(`mcp-batch:${ticketNo}`, {
      ...existing,
      status: '已完成',
      reviewedAt: at,
      reviewer: identity.account,
      reviewNote,
      executionSummary,
    })
    return json(res, {ok: true, ticket: updated, executionSummary})
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
