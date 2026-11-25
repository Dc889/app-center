import {body, check, id, json} from '../../../../runtime/http.mjs'

function quotaKey(workspaceId, providerName, modelName) {
  return `${workspaceId}::${providerName}::${modelName}`
}

function evaluateRow(usage, policy) {
  const period = policy?.period === 'total' ? 'total' : 'monthly'
  const usedTokens = period === 'total' ? Number(usage.totalTokens || 0) : Number(usage.monthlyTokens || 0)
  const usedCalls = period === 'total' ? Number(usage.totalCalls || 0) : Number(usage.monthlyCalls || 0)
  const tokenLimit = policy?.tokenLimit > 0 ? Number(policy.tokenLimit) : null
  const callLimit = policy?.callLimit > 0 ? Number(policy.callLimit) : null
  const tokenPercent = tokenLimit ? Math.round((usedTokens / tokenLimit) * 1000) / 10 : null
  const callPercent = callLimit ? Math.round((usedCalls / callLimit) * 1000) / 10 : null
  const tokenExceeded = tokenLimit !== null && usedTokens >= tokenLimit
  const callExceeded = callLimit !== null && usedCalls >= callLimit
  const exceeded = tokenExceeded || callExceeded
  const warning = !exceeded && ((tokenPercent !== null && tokenPercent >= 80) || (callPercent !== null && callPercent >= 80))

  let quotaStatus = '未设限'
  if (tokenLimit !== null || callLimit !== null) {
    if (exceeded) quotaStatus = usage.enabled === false ? '已超限熔断' : '已超限待禁用'
    else if (warning) quotaStatus = '预警(≥80%)'
    else quotaStatus = '正常'
  } else if (usage.enabled === false) {
    quotaStatus = '已手动禁用'
  }

  return {
    key: quotaKey(usage.workspaceId, usage.providerName, usage.modelName),
    workspaceId: usage.workspaceId,
    workspaceName: usage.workspaceName,
    ownerAccount: usage.ownerAccount,
    ownerName: usage.ownerName,
    org: usage.org,
    providerName: usage.providerName,
    modelName: usage.modelName,
    modelType: usage.modelType || 'text-generation',
    enabled: usage.enabled !== false,
    period,
    usedTokens,
    usedCalls,
    monthlyTokens: Number(usage.monthlyTokens || 0),
    monthlyCalls: Number(usage.monthlyCalls || 0),
    totalTokens: Number(usage.totalTokens || 0),
    totalCalls: Number(usage.totalCalls || 0),
    tokenLimit,
    callLimit,
    tokenPercent,
    callPercent,
    autoDisable: policy ? policy.autoDisable !== false : true,
    exceeded,
    warning,
    quotaStatus,
    note: policy?.note || '',
    updatedAt: policy?.updatedAt || null,
    updatedBy: policy?.updatedBy || null,
  }
}

export function buildModelQuotaReport({inventory, directory, now = Date.now()}) {
  const store = directory.store
  const policies = new Map()
  const tickets = []
  for (const row of store.all()) {
    if (!row) continue
    if (row.kind === 'model-quota' && row.key) policies.set(row.key, row)
    else if (row.kind === 'model-quota-ticket') tickets.push(row)
  }
  tickets.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  const merged = new Map()
  for (const u of inventory?.modelUsage ?? []) {
    const k = quotaKey(u.workspaceId, u.providerName, u.modelName)
    merged.set(k, evaluateRow(u, policies.get(k) ?? null))
  }
  // Include policies whose model hasn't appeared in usage yet
  for (const [k, pol] of policies.entries()) {
    if (merged.has(k)) continue
    merged.set(k, evaluateRow({
      workspaceId: pol.workspaceId,
      workspaceName: pol.workspaceName || pol.workspaceId.slice(0, 8),
      ownerAccount: pol.ownerAccount || '',
      ownerName: pol.ownerName || pol.workspaceName || 'Dify 工作区',
      org: pol.org || '待归属',
      providerName: pol.providerName,
      modelName: pol.modelName,
      modelType: pol.modelType || 'text-generation',
      enabled: pol.lastKnownEnabled !== false,
      monthlyCalls: 0,
      monthlyTokens: 0,
      totalCalls: 0,
      totalTokens: 0,
    }, pol))
  }

  const items = [...merged.values()]
  const rank = {'已超限待禁用': 0, '已超限熔断': 1, '预警(≥80%)': 2, '正常': 3, '已手动禁用': 4, '未设限': 5}
  items.sort((a, b) => (rank[a.quotaStatus] - rank[b.quotaStatus]) || (b.usedTokens - a.usedTokens))

  // Aggregate per-account (tenant) full asset + model usage overview
  const norm = v => String(v ?? '').trim().toLowerCase()
  const tenantRows = new Map()
  const ensureTenant = (account, seed = {}) => {
    const key = norm(account) || norm(seed.workspaceId)
    if (!key) return null
    if (!tenantRows.has(key)) {
      tenantRows.set(key, {
        account: account || seed.workspaceId?.slice(0, 8) || 'unknown',
        name: seed.name || account || '未命名',
        email: seed.email || '',
        org: seed.org || '待归属',
        active: seed.active !== false,
        workspaceId: seed.workspaceId || '',
        workspaceName: seed.workspaceName || '',
        appsCount: 0,
        datasetsCount: 0,
        pluginsCount: 0,
        mcpCount: 0,
        apiKeysCount: 0,
        monthlyTokens: 0,
        totalTokens: 0,
        monthlyCalls: 0,
        totalCalls: 0,
        modelsCount: 0,
        exceededModels: 0,
        warningModels: 0,
        disabledModels: 0,
      })
    }
    return tenantRows.get(key)
  }

  const byWorkspace = new Map()
  for (const p of directory.subjects()) {
    const row = ensureTenant(p.account, {
      name: p.name,
      email: p.email,
      org: p.org,
      active: p.active,
      workspaceId: p.difyWorkspaceId || '',
      workspaceName: p.difyWorkspaceName || '',
    })
    if (row && p.difyWorkspaceId) byWorkspace.set(p.difyWorkspaceId, row)
  }

  const resolveRow = (item) => {
    if (item.workspaceId && byWorkspace.has(item.workspaceId)) return byWorkspace.get(item.workspaceId)
    if (item.ownerAccount && tenantRows.has(norm(item.ownerAccount))) return tenantRows.get(norm(item.ownerAccount))
    const row = ensureTenant(item.ownerAccount || `ws:${String(item.workspaceId || '').slice(0, 8)}`, {
      name: item.ownerName || item.workspaceName,
      org: item.org,
      workspaceId: item.workspaceId,
      workspaceName: item.workspaceName,
    })
    if (row && item.workspaceId) byWorkspace.set(item.workspaceId, row)
    return row
  }

  for (const a of inventory?.apps ?? []) {
    const row = resolveRow(a)
    if (row) {
      row.appsCount += 1
      if (!row.workspaceId && a.workspaceId) row.workspaceId = a.workspaceId
      if (!row.workspaceName && a.workspaceName) row.workspaceName = a.workspaceName
    }
  }
  for (const d of inventory?.datasets ?? []) {
    const row = resolveRow(d)
    if (row) row.datasetsCount += 1
  }
  for (const p of inventory?.plugins ?? []) {
    const row = resolveRow(p)
    if (row) row.pluginsCount += 1
  }
  for (const m of inventory?.mcpProviders ?? []) {
    const row = resolveRow(m)
    if (row) row.mcpCount += 1
  }
  for (const k of inventory?.apiKeys ?? []) {
    const row = resolveRow(k)
    if (row) row.apiKeysCount += 1
  }
  for (const m of items) {
    const row = resolveRow(m)
    if (!row) continue
    row.modelsCount += 1
    row.monthlyTokens += m.monthlyTokens
    row.totalTokens += m.totalTokens
    row.monthlyCalls += m.monthlyCalls
    row.totalCalls += m.totalCalls
    if (m.exceeded) row.exceededModels += 1
    if (m.warning) row.warningModels += 1
    if (!m.enabled) row.disabledModels += 1
    if (!row.workspaceId && m.workspaceId) row.workspaceId = m.workspaceId
    if (!row.workspaceName && m.workspaceName) row.workspaceName = m.workspaceName
  }

  const tenants = [...tenantRows.values()].sort(
    (a, b) => (b.monthlyTokens - a.monthlyTokens) || (b.appsCount - a.appsCount) || a.account.localeCompare(b.account),
  )

  return {
    capturedAt: new Date(now).toISOString(),
    syncedAt: inventory?.syncedAt || null,
    summary: {
      total: items.length,
      configured: items.filter(i => i.tokenLimit !== null || i.callLimit !== null).length,
      exceeded: items.filter(i => i.exceeded).length,
      warning: items.filter(i => i.warning).length,
      disabled: items.filter(i => !i.enabled).length,
      pendingTickets: tickets.filter(t => t.status === '待审批').length,
      totalTenants: tenants.length,
      totalMonthlyTokens: items.reduce((s, i) => s + i.monthlyTokens, 0),
      totalMonthlyCalls: items.reduce((s, i) => s + i.monthlyCalls, 0),
      totalApps: (inventory?.apps ?? []).length,
      totalDatasets: (inventory?.datasets ?? []).length,
    },
    tenants,
    items,
    tickets,
  }
}

export async function enforceModelQuotas({subsystems, directory, events, types, actor = 'system-quota-guard', now = Date.now(), refresh = false}) {
  const store = directory.store
  const hasAutoPolicies = store.all().some(r => r?.kind === 'model-quota' && r.autoDisable !== false && (r.tokenLimit > 0 || r.callLimit > 0))
  if (!hasAutoPolicies && !refresh) return {checked: 0, disabled: [], errors: []}

  const inventory = refresh && subsystems?.refreshDifyInventory
    ? await subsystems.refreshDifyInventory()
    : (subsystems?.getDifyInventory?.() ?? {syncedAt: null, modelUsage: []})
  const report = buildModelQuotaReport({inventory, directory, now})
  const disabled = []
  const errors = []
  const at = new Date(now).toISOString()

  for (const item of report.items) {
    if (!item.exceeded || !item.autoDisable || !item.enabled) continue
    const res = await subsystems.setDifyModelEnabled({
      workspaceId: item.workspaceId,
      providerName: item.providerName,
      modelName: item.modelName,
      modelType: item.modelType,
      enabled: false,
    })
    if (res.ok) {
      disabled.push({key: item.key, workspaceName: item.workspaceName, modelName: item.modelName})
      // Create an EVT-01 alert if not already open for this quota breach
      if (events && types) {
        const resourceId = `${item.workspaceId}:${item.modelName}`
        const alreadyOpen = events.all().some(e => e.ruleCode === 'MODEL_QUOTA_EXCEEDED' && e.resourceId === resourceId && e.status !== '已关闭')
        if (!alreadyOpen) {
          const ticketNo = `EVT-01-MQ-${id().slice(0, 8)}`
          const detail = `工作区「${item.workspaceName}」（${item.ownerName}）的模型 ${item.modelName} 已达配额上限（Token：${item.usedTokens}/${item.tokenLimit ?? '不限'}，调用次数：${item.usedCalls}/${item.callLimit ?? '不限'}），系统已自动在 Dify 禁用该模型。`
          events.put(ticketNo, {
            ticketNo,
            account: actor,
            resourceId,
            resourceName: `${item.workspaceName} / ${item.modelName}`,
            originDraft: null,
            facts: detail,
            objectType: '账号与集成',
            creationMode: '自动巡检',
            alertId: 'AL-' + id(),
            ruleCode: 'MODEL_QUOTA_EXCEEDED',
            originalSeverity: '一般',
            firstOccurredAt: at,
            lastOccurredAt: at,
            evidence: {facts: detail},
            status: '未研判',
            version: types.activeVersion('EVT-01'),
            revision: 1,
            history: [{at, actor, action: '模型超额自动熔断', fromStatus: null, toStatus: '未研判', note: detail}],
          })
        }
      }
    } else {
      errors.push({key: item.key, error: res.error})
    }
  }
  return {checked: report.items.length, disabled, errors}
}

export async function routeModelQuotas(services) {
  const {directory, events, hasRole, identity, options, path, req, res, subsystems, types} = services
  check(identity?.active, 403, 'ACCESS_DENIED')
  const isStaff = hasRole(identity, 'admin') || hasRole(identity, 'operator')
  const now = (options.now ?? Date.now)()
  const store = directory.store

  if (req.method === 'GET' && path === '/api/model-quotas') {
    const url = new URL(req.url, 'http://localhost')
    const refresh = isStaff && url.searchParams.get('refresh') === '1'
    const inventory = refresh && subsystems?.refreshDifyInventory
      ? await subsystems.refreshDifyInventory()
      : (subsystems?.getDifyInventory?.() ?? {syncedAt: null, modelUsage: []})
    const report = buildModelQuotaReport({inventory, directory, now})
    if (!isStaff) {
      const me = directory.get(identity.subjectId) ?? directory.byAccount(identity.account)
      const myWs = String(me?.difyWorkspaceId || '').trim()
      const myAcc = String(identity.account || '').toLowerCase()
      return json(res, {
        ...report,
        isStaff: false,
        tenants: report.tenants.filter(t => t.account.toLowerCase() === myAcc || (myWs && t.workspaceId === myWs)),
        items: report.items.filter(m => (myWs && m.workspaceId === myWs) || String(m.ownerAccount || '').toLowerCase() === myAcc),
        tickets: report.tickets.filter(t => String(t.applicant || '').toLowerCase() === myAcc || (myWs && t.workspaceId === myWs)),
      })
    }
    return json(res, {...report, isStaff: true})
  }

  check(req.method === 'POST' && (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host), 403, 'ACCESS_DENIED')
  const input = await body(req)
  const at = new Date(now).toISOString()

  if (path === '/api/model-quotas/policy') {
    check(isStaff, 403, 'ACCESS_DENIED')
    const workspaceId = String(input?.workspaceId ?? '').trim()
    const providerName = String(input?.providerName ?? '').trim()
    const modelName = String(input?.modelName ?? '').trim()
    const modelType = String(input?.modelType ?? 'text-generation').trim() || 'text-generation'
    const period = input?.period === 'total' ? 'total' : 'monthly'
    const tokenLimit = input?.tokenLimit === null || input?.tokenLimit === '' || input?.tokenLimit === undefined ? null : Number(input.tokenLimit)
    const callLimit = input?.callLimit === null || input?.callLimit === '' || input?.callLimit === undefined ? null : Number(input.callLimit)
    const autoDisable = input?.autoDisable !== false
    const note = String(input?.note ?? '').trim().slice(0, 500)

    check(workspaceId && providerName && modelName, 400, 'INVALID_MODEL_TARGET', '请选择有效的工作区和模型')
    check(tokenLimit === null || (Number.isFinite(tokenLimit) && tokenLimit >= 0), 400, 'INVALID_TOKEN_LIMIT')
    check(callLimit === null || (Number.isFinite(callLimit) && callLimit >= 0), 400, 'INVALID_CALL_LIMIT')

    const key = quotaKey(workspaceId, providerName, modelName)
    const inv = subsystems?.getDifyInventory?.() ?? {modelUsage: []}
    const currentUsage = (inv.modelUsage ?? []).find(u => quotaKey(u.workspaceId, u.providerName, u.modelName) === key)

    const saved = store.put(`model-quota:${key}`, {
      kind: 'model-quota',
      key,
      workspaceId,
      workspaceName: currentUsage?.workspaceName || String(input?.workspaceName || ''),
      ownerAccount: currentUsage?.ownerAccount || '',
      ownerName: currentUsage?.ownerName || '',
      org: currentUsage?.org || '待归属',
      providerName,
      modelName,
      modelType,
      period,
      tokenLimit: tokenLimit && tokenLimit > 0 ? Math.floor(tokenLimit) : null,
      callLimit: callLimit && callLimit > 0 ? Math.floor(callLimit) : null,
      autoDisable,
      note,
      updatedAt: at,
      updatedBy: identity.account,
    })

    // Immediately enforce or restore based on new quota
    let actionTaken = null
    if (currentUsage) {
      const evaluated = evaluateRow(currentUsage, saved)
      if (evaluated.exceeded && autoDisable && evaluated.enabled) {
        const r = await subsystems.setDifyModelEnabled({workspaceId, providerName, modelName, modelType, enabled: false})
        actionTaken = r.ok ? 'auto_disabled' : `disable_failed:${r.error}`
      } else if (!evaluated.exceeded && !evaluated.enabled) {
        const r = await subsystems.setDifyModelEnabled({workspaceId, providerName, modelName, modelType, enabled: true})
        actionTaken = r.ok ? 'auto_enabled' : `enable_failed:${r.error}`
      }
    }

    return json(res, {ok: true, policy: saved, actionTaken})
  }

  if (path === '/api/model-quotas/enforce') {
    check(isStaff, 403, 'ACCESS_DENIED')
    if (input?.workspaceId && input?.providerName && input?.modelName && (input?.action === 'disable' || input?.action === 'enable')) {
      const enabled = input.action === 'enable'
      const result = await subsystems.setDifyModelEnabled({
        workspaceId: String(input.workspaceId).trim(),
        providerName: String(input.providerName).trim(),
        modelName: String(input.modelName).trim(),
        modelType: String(input.modelType || 'text-generation').trim(),
        enabled,
      })
      check(result.ok, 502, 'DIFY_MODEL_TOGGLE_FAILED', result.error || 'Dify 模型开关切换失败')
      return json(res, {ok: true, enabled})
    }
    const sweep = await enforceModelQuotas({subsystems, directory, events, types, actor: identity.account, now, refresh: true})
    return json(res, {ok: true, ...sweep})
  }

  if (path === '/api/model-quotas/request') {
    const workspaceId = String(input?.workspaceId ?? '').trim()
    const providerName = String(input?.providerName ?? '').trim()
    const modelName = String(input?.modelName ?? '').trim()
    const modelType = String(input?.modelType ?? 'text-generation').trim() || 'text-generation'
    const operationType = ['配置额度', '禁用模型', '恢复启用'].includes(String(input?.operationType ?? '配置额度'))
      ? String(input?.operationType ?? '配置额度')
      : '配置额度'
    const period = input?.period === 'total' ? 'total' : 'monthly'
    const autoDisable = input?.autoDisable !== false
    const requestedTokenLimit = input?.requestedTokenLimit ? Math.floor(Number(input.requestedTokenLimit)) : null
    const requestedCallLimit = input?.requestedCallLimit ? Math.floor(Number(input.requestedCallLimit)) : null
    const reason = String(input?.reason ?? '').trim()

    check(workspaceId && providerName && modelName, 400, 'INVALID_MODEL_TARGET', '请选择有效的工作区与模型')
    if (operationType !== '配置额度') {
      check(isStaff, 403, 'ACCESS_DENIED', '仅运维或管理员可发起模型禁启工单')
    } else {
      check((requestedTokenLimit && requestedTokenLimit > 0) || (requestedCallLimit && requestedCallLimit > 0), 400, 'INVALID_LIMIT', '请填写 Token 额度上限或调用次数上限')
    }
    check(reason.length >= 2 && reason.length <= 1000, 400, 'INVALID_REASON', '请填写工单申请原因')

    const key = quotaKey(workspaceId, providerName, modelName)
    const inv = subsystems?.getDifyInventory?.() ?? {modelUsage: []}
    const currentUsage = (inv.modelUsage ?? []).find(u => quotaKey(u.workspaceId, u.providerName, u.modelName) === key)
    const ticketNo = `MOD-01-${id().slice(0, 8)}`
    const ticket = store.put(`model-quota-ticket:${ticketNo}`, {
      kind: 'model-quota-ticket',
      ticketNo,
      key,
      operationType,
      period,
      autoDisable,
      workspaceId,
      workspaceName: currentUsage?.workspaceName || workspaceId.slice(0, 8),
      providerName,
      modelName,
      modelType,
      requestedTokenLimit,
      requestedCallLimit,
      reason,
      applicant: identity.account,
      applicantName: identity.name || identity.account,
      org: identity.org || '待归属',
      status: '待审批',
      createdAt: at,
      reviewedAt: null,
      reviewer: null,
      reviewNote: null,
    })
    return json(res, {ok: true, ticket}, 201)
  }

  if (path === '/api/model-quotas/approve') {
    check(isStaff, 403, 'ACCESS_DENIED')
    const ticketNo = String(input?.ticketNo ?? '').trim()
    const decision = input?.decision === 'reject' ? 'reject' : 'approve'
    const reviewNote = String(input?.reviewNote ?? (decision === 'approve' ? '审批通过并执行生效' : '驳回申请')).trim()
    const existing = store.get(`model-quota-ticket:${ticketNo}`)
    check(existing && existing.status === '待审批', 404, 'TICKET_NOT_PENDING', '该工单不存在或已办理')

    let actionResult = null
    if (decision === 'approve') {
      const op = existing.operationType || '配置额度'
      if (op === '禁用模型' || op === '恢复启用') {
        const enabled = op === '恢复启用'
        const r = await subsystems.setDifyModelEnabled({
          workspaceId: existing.workspaceId,
          providerName: existing.providerName,
          modelName: existing.modelName,
          modelType: existing.modelType || 'text-generation',
          enabled,
        })
        actionResult = r.ok ? (enabled ? 'enabled' : 'disabled') : `failed:${r.error}`
      } else {
        const prevPol = store.get(`model-quota:${existing.key}`)
        const savedPol = store.put(`model-quota:${existing.key}`, {
          kind: 'model-quota',
          key: existing.key,
          workspaceId: existing.workspaceId,
          workspaceName: existing.workspaceName,
          ownerAccount: prevPol?.ownerAccount || existing.applicant,
          ownerName: prevPol?.ownerName || existing.applicantName,
          org: prevPol?.org || existing.org,
          providerName: existing.providerName,
          modelName: existing.modelName,
          modelType: existing.modelType || 'text-generation',
          period: existing.period || prevPol?.period || 'monthly',
          tokenLimit: existing.requestedTokenLimit ?? prevPol?.tokenLimit ?? null,
          callLimit: existing.requestedCallLimit ?? prevPol?.callLimit ?? null,
          autoDisable: existing.autoDisable !== false,
          note: `依据工单 ${ticketNo}：${existing.reason}`,
          updatedAt: at,
          updatedBy: identity.account,
        })
        const inv = subsystems?.getDifyInventory?.() ?? {modelUsage: []}
        const currentUsage = (inv.modelUsage ?? []).find(u => quotaKey(u.workspaceId, u.providerName, u.modelName) === existing.key)
        if (currentUsage) {
          const evaluated = evaluateRow(currentUsage, savedPol)
          const targetEnabled = !(evaluated.exceeded && savedPol.autoDisable)
          const r = await subsystems.setDifyModelEnabled({
            workspaceId: existing.workspaceId,
            providerName: existing.providerName,
            modelName: existing.modelName,
            modelType: existing.modelType || 'text-generation',
            enabled: targetEnabled,
          })
          actionResult = r.ok ? (targetEnabled ? 'enabled' : 'auto_disabled') : `failed:${r.error}`
        } else {
          const r = await subsystems.setDifyModelEnabled({
            workspaceId: existing.workspaceId,
            providerName: existing.providerName,
            modelName: existing.modelName,
            modelType: existing.modelType || 'text-generation',
            enabled: true,
          })
          actionResult = r.ok ? 'enabled' : `failed:${r.error}`
        }
      }
    }

    const updated = store.put(`model-quota-ticket:${ticketNo}`, {
      ...existing,
      status: decision === 'approve' ? '已批准' : '已驳回',
      reviewedAt: at,
      reviewer: identity.account,
      reviewNote,
      actionResult,
      modelRestored: actionResult === 'enabled',
    })
    return json(res, {ok: true, ticket: updated, actionResult, modelRestored: actionResult === 'enabled'})
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
