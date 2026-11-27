import {body, check, id, json} from '../../../../runtime/http.mjs'
import {reconcileDifyCompliance} from './compliance-reconcile.mjs'

export const DEFAULT_GOVERNANCE_POLICY = Object.freeze({
  version: 0,
  patrols: Object.freeze({
    enableDatasetSensitiveScan: true,
    enableShadowPluginScan: true,
    enableShadowMcpScan: true,
    enableExternalExposureScan: true,
    enableChatSensitiveScan: true,
    highFreqIpThresholdPerMin: 60,
    patrolIntervalMinutes: 30,
  }),
  cutoffSwitches: Object.freeze({
    // 默认严格关闭：必须经由 CFG-05 配置变更工单审批通过后方可开启
    enableWebAppCutoff: false,
    enableApiKeyCutoff: false,
  }),
  updatedBy: null,
  updatedByName: null,
  updatedAt: null,
})

export function getActiveGovernancePolicy(store) {
  const saved = store?.get?.('governance-policy:active')
  if (!saved) {
    return {
      version: 0,
      patrols: {...DEFAULT_GOVERNANCE_POLICY.patrols},
      cutoffSwitches: {...DEFAULT_GOVERNANCE_POLICY.cutoffSwitches},
      updatedBy: null,
      updatedByName: null,
      updatedAt: null,
    }
  }
  return {
    version: Number(saved.version || 0),
    patrols: {
      ...DEFAULT_GOVERNANCE_POLICY.patrols,
      ...(saved.patrols || {}),
    },
    cutoffSwitches: {
      enableWebAppCutoff: Boolean(saved.cutoffSwitches?.enableWebAppCutoff),
      enableApiKeyCutoff: Boolean(saved.cutoffSwitches?.enableApiKeyCutoff),
    },
    updatedBy: saved.updatedBy || null,
    updatedByName: saved.updatedByName || null,
    updatedAt: saved.updatedAt || null,
  }
}

const CUTOFF_ACTION_LABELS = {
  pause_webapp: '暂停 WebApp / iframe 公开访问',
  resume_webapp: '恢复 WebApp / iframe 公开访问',
  pause_api: '暂停外部 API 访问通道',
  resume_api: '恢复外部 API 访问通道',
  revoke_api_key: '吊销指定未备案 API 密钥',
}

function isWebAppCutoffAction(action) {
  return action === 'pause_webapp' || action === 'resume_webapp'
}

function isApiCutoffAction(action) {
  return action === 'pause_api' || action === 'resume_api' || action === 'revoke_api_key'
}

function assertCutoffSwitchAllowed(policy, action) {
  if (isWebAppCutoffAction(action)) {
    check(
      policy.cutoffSwitches.enableWebAppCutoff === true,
      403,
      'CUTOFF_SWITCH_DISABLED',
      'WebApp / iframe 断流反制总开关默认处于关闭状态，请先提交并审批 CFG-05 配置工单开启后再操作',
    )
  } else if (isApiCutoffAction(action)) {
    check(
      policy.cutoffSwitches.enableApiKeyCutoff === true,
      403,
      'CUTOFF_SWITCH_DISABLED',
      '外部 API / 密钥断流反制总开关默认处于关闭状态，请先提交并审批 CFG-05 配置工单开启后再操作',
    )
  } else {
    check(false, 400, 'INVALID_CUTOFF_ACTION', '不支持的断流/恢复操作类型')
  }
}

export async function routeGovernancePolicy(services) {
  const {applications, configs, directory, events, hasRole, identity, options, path, req, res, subsystems, tickets, types} = services
  check(identity?.active && (hasRole(identity, 'admin') || hasRole(identity, 'operator')), 403, 'ACCESS_DENIED')

  const now = (options.now ?? Date.now)()
  const at = new Date(now).toISOString()
  const store = directory.store
  const isAdmin = hasRole(identity, 'admin')

  // 1. Read active policy, CFG-05 history, SEC-01 history, last patrol summary
  if (req.method === 'GET' && path === '/api/governance-policy') {
    const policy = getActiveGovernancePolicy(store)
    const all = store.all()
    const configTickets = all
      .filter(r => r && r.kind === 'cfg05-ticket')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 30)
    const cutoffTickets = all
      .filter(r => r && r.kind === 'sec01-ticket')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 50)
    const lastPatrol = store.get('governance-patrol:last') ?? null
    return json(res, {
      canApprove: isAdmin,
      policy,
      configTickets,
      cutoffTickets,
      lastPatrol,
    })
  }

  // 2. Live exposure inspection for a single Dify app (used by SEC-01 form)
  if (req.method === 'GET' && path === '/api/governance-policy/app-exposure') {
    const url = new URL(req.url, 'http://localhost')
    const appId = String(url.searchParams.get('appId') ?? '').trim()
    check(appId, 400, 'APP_ID_REQUIRED', '请指定应用 ID')
    const exposure = await subsystems.getDifyAppExposure({appId})
    check(exposure?.ok, 404, exposure?.error || 'APP_NOT_FOUND', '读取应用对外暴露状态失败')
    const policy = getActiveGovernancePolicy(store)
    return json(res, {
      exposure,
      cutoffSwitches: policy.cutoffSwitches,
    })
  }

  // CSRF check for mutating requests
  check(!req.headers.origin || new URL(req.headers.origin).host === req.headers.host, 403, 'ACCESS_DENIED')

  // 3. Submit CFG-05 policy configuration ticket (idempotent pending check)
  if (req.method === 'POST' && path === '/api/governance-policy/config/request') {
    const input = await body(req)
    const reason = String(input?.reason ?? '').trim()
    check(reason && reason.length <= 2000, 400, 'REASON_REQUIRED', '请填写策略配置变更原因')

    const existingPending = store.all().find(r => r && r.kind === 'cfg05-ticket' && r.status === '待审批')
    check(
      !existingPending,
      409,
      'CONFIG_CHANGE_PENDING',
      `已存在待审批的巡检与反制策略变更工单（${existingPending?.ticketNo}），请先完成审批或驳回后再提交新申请`,
    )

    const current = getActiveGovernancePolicy(store)
    const nextPatrols = {
      enableDatasetSensitiveScan: input?.patrols?.enableDatasetSensitiveScan !== undefined ? Boolean(input.patrols.enableDatasetSensitiveScan) : current.patrols.enableDatasetSensitiveScan,
      enableShadowPluginScan: input?.patrols?.enableShadowPluginScan !== undefined ? Boolean(input.patrols.enableShadowPluginScan) : current.patrols.enableShadowPluginScan,
      enableShadowMcpScan: input?.patrols?.enableShadowMcpScan !== undefined ? Boolean(input.patrols.enableShadowMcpScan) : current.patrols.enableShadowMcpScan,
      enableExternalExposureScan: input?.patrols?.enableExternalExposureScan !== undefined ? Boolean(input.patrols.enableExternalExposureScan) : current.patrols.enableExternalExposureScan,
      enableChatSensitiveScan: input?.patrols?.enableChatSensitiveScan !== undefined ? Boolean(input.patrols.enableChatSensitiveScan) : current.patrols.enableChatSensitiveScan,
      highFreqIpThresholdPerMin: Math.max(5, Math.min(10000, Number(input?.patrols?.highFreqIpThresholdPerMin ?? current.patrols.highFreqIpThresholdPerMin) || 60)),
      patrolIntervalMinutes: Math.max(5, Math.min(1440, Number(input?.patrols?.patrolIntervalMinutes ?? current.patrols.patrolIntervalMinutes) || 30)),
    }
    const nextCutoff = {
      enableWebAppCutoff: input?.cutoffSwitches?.enableWebAppCutoff !== undefined ? Boolean(input.cutoffSwitches.enableWebAppCutoff) : current.cutoffSwitches.enableWebAppCutoff,
      enableApiKeyCutoff: input?.cutoffSwitches?.enableApiKeyCutoff !== undefined ? Boolean(input.cutoffSwitches.enableApiKeyCutoff) : current.cutoffSwitches.enableApiKeyCutoff,
    }

    const ticketNo = `CFG-05-${id().slice(0, 8)}`
    const ticket = {
      kind: 'cfg05-ticket',
      ticketNo,
      ticketType: 'CFG-05',
      status: '待审批',
      before: {patrols: current.patrols, cutoffSwitches: current.cutoffSwitches},
      after: {patrols: nextPatrols, cutoffSwitches: nextCutoff},
      reason,
      applicant: identity.account,
      applicantName: identity.name || identity.account,
      createdAt: at,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    }
    store.put(`cfg05-ticket:${ticketNo}`, ticket)
    return json(res, {ok: true, ticket}, 201)
  }

  // 4. Approve or reject CFG-05 policy ticket (admin only)
  if (req.method === 'POST' && path === '/api/governance-policy/config/approve') {
    check(isAdmin, 403, 'ADMIN_REQUIRED', '仅系统管理员可审批巡检与断流反制策略变更工单')
    const input = await body(req)
    const ticketNo = String(input?.ticketNo ?? '').trim()
    const decision = String(input?.decision ?? 'approve').trim()
    const reviewNote = String(input?.reviewNote ?? '').trim()
    check(ticketNo && ['approve', 'reject'].includes(decision), 400, 'INVALID_REQUEST')

    const key = `cfg05-ticket:${ticketNo}`
    const ticket = store.get(key)
    check(ticket && ticket.kind === 'cfg05-ticket', 404, 'TICKET_NOT_FOUND', '未找到对应的 CFG-05 工单')
    check(ticket.status === '待审批', 409, 'TICKET_ALREADY_DECIDED', '该工单已处理，不能重复审批')

    if (decision === 'reject') {
      const updated = {
        ...ticket,
        status: '已驳回',
        reviewedBy: identity.account,
        reviewedByName: identity.name || identity.account,
        reviewedAt: at,
        reviewNote: reviewNote || '管理员驳回策略变更申请',
      }
      store.put(key, updated)
      return json(res, {ok: true, ticket: updated, policy: getActiveGovernancePolicy(store)})
    }

    const prev = getActiveGovernancePolicy(store)
    const nextPolicy = {
      version: prev.version + 1,
      patrols: ticket.after.patrols,
      cutoffSwitches: ticket.after.cutoffSwitches,
      updatedBy: identity.account,
      updatedByName: identity.name || identity.account,
      updatedAt: at,
      sourceTicketNo: ticketNo,
    }
    store.put('governance-policy:active', nextPolicy)
    const updated = {
      ...ticket,
      status: '已完成',
      reviewedBy: identity.account,
      reviewedByName: identity.name || identity.account,
      reviewedAt: at,
      reviewNote: reviewNote || '管理员已批准，策略配置已热生效',
    }
    store.put(key, updated)
    return json(res, {ok: true, ticket: updated, policy: nextPolicy})
  }

  // 5. Run read-only bypass patrol (ALERT ONLY — zero blocking or modifying of Dify!)
  if (req.method === 'POST' && path === '/api/governance-policy/patrol/run') {
    const policy = getActiveGovernancePolicy(store)
    const p = policy.patrols

    const inventory = subsystems?.refreshDifyInventory
      ? await subsystems.refreshDifyInventory()
      : (subsystems?.getDifyInventory?.() ?? {syncedAt: null, apps: [], datasets: [], mcpProviders: [], plugins: [], apiKeys: []})

    const createdAlerts = []
    const skippedDuplicates = []

    const activeEvents = events.all().filter(e => e && e.status !== '已关闭')
    const hasOpenAlert = (ruleCode, resourceId) =>
      activeEvents.some(e => e.ruleCode === ruleCode && e.resourceId === resourceId)

    const raiseAlert = ({ruleCode, objectType, severity, resourceId, resourceName, facts, detectedAt, findingId = null, note = ''}) => {
      if (hasOpenAlert(ruleCode, resourceId)) {
        skippedDuplicates.push({ruleCode, resourceId, resourceName})
        return
      }
      const ticketNo = `EVT-01-PTL-${id().slice(0, 8)}`
      const rec = events.put(ticketNo, {
        ticketNo,
        account: identity.account,
        resourceId,
        resourceName,
        originDraft: null,
        facts,
        objectType,
        creationMode: '旁路告警巡检',
        alertId: 'AL-' + id(),
        ruleCode,
        ...(findingId ? {reconcileFindingId: findingId} : {}),
        originalSeverity: severity || '一般',
        firstOccurredAt: detectedAt || at,
        lastOccurredAt: at,
        evidence: {facts, mode: 'alert_only'},
        status: '未研判',
        version: types.activeVersion('EVT-01'),
        revision: 1,
        history: [{
          at,
          actor: identity.account,
          action: '旁路自动告警',
          fromStatus: null,
          toStatus: '未研判',
          note: note || `旁路合规巡检自动触发告警（仅告警模式，未修改原平台资源）`,
        }],
      })
      activeEvents.push(rec)
      createdAlerts.push({ticketNo: rec.ticketNo, ruleCode, resourceName, severity: rec.originalSeverity})
    }

    // (a) Shadow plugins / MCP / keys / shared datasets via reconcile
    const reconcile = reconcileDifyCompliance({
      inventory,
      tickets: tickets.all(),
      applications: applications.records(),
      events: events.all(),
      now,
    })
    for (const item of reconcile.items) {
      if (item.category === 'plugin' && !p.enableShadowPluginScan) continue
      if (item.category === 'mcp' && !p.enableShadowMcpScan) continue
      if (item.category === 'key' && !p.enableExternalExposureScan) continue
      if (item.category === 'dataset' && !p.enableDatasetSensitiveScan) continue
      if (item.remediationStatus !== '待处置') continue
      raiseAlert({
        ruleCode: item.ruleCode,
        objectType: item.objectType,
        severity: item.severity,
        resourceId: item.resourceId,
        resourceName: item.resourceName,
        facts: item.detail,
        detectedAt: item.detectedAt,
        findingId: item.findingId,
        note: `${item.categoryLabel}：${item.resourceName}（工作区：${item.workspaceName}）`,
      })
    }

    // (b) Deep read-only scan of Dify dataset segments, external WebApp/API exposure, and external chat messages
    const kwList = configs?.listKeywords ? (configs.listKeywords().items || []) : []
    const deepScan = subsystems?.scanDifySensitiveAlerts
      ? await subsystems.scanDifySensitiveAlerts({
        keywordRules: kwList,
        enableDatasetScan: p.enableDatasetSensitiveScan,
        enableChatScan: p.enableChatSensitiveScan,
        enableWebAppScan: p.enableExternalExposureScan,
      })
      : {ok: true, findings: []}

    // Exclude already-approved AG-02/AG-04 apps from PATROL_EXTERNAL_EXPOSURE noise
    const approvedAppIds = new Set(
      applications.records()
        .filter(a => ['AG-02', 'AG-04'].includes(a.ticketType) && ['已完成', '已通过', '待结果确认'].includes(a.status))
        .map(a => String(a.submission?.resourceId || a.snapshot?.resourceId || '').toLowerCase())
        .filter(Boolean),
    )

    for (const f of deepScan.findings ?? []) {
      if (f.ruleCode === 'PATROL_EXTERNAL_EXPOSURE' && approvedAppIds.has(String(f.resourceId).toLowerCase())) continue
      raiseAlert({
        ruleCode: f.ruleCode,
        objectType: f.objectType,
        severity: f.severity,
        resourceId: f.resourceId,
        resourceName: f.resourceName,
        facts: f.facts,
        detectedAt: f.detectedAt,
        note: `旁路只读巡检命中：${f.resourceName}`,
      })
    }

    const summary = {
      ranAt: at,
      ranBy: identity.name || identity.account,
      createdCount: createdAlerts.length,
      skippedCount: skippedDuplicates.length,
      totalScannedFindings: reconcile.items.length + (deepScan.findings?.length || 0),
      createdAlerts: createdAlerts.slice(0, 30),
    }
    store.put('governance-patrol:last', summary)
    return json(res, {ok: true, summary}, 201)
  }

  // 6. Submit SEC-01 external exposure cutoff/resume ticket (STRICTLY gated by CFG-05 switch!)
  if (req.method === 'POST' && path === '/api/governance-policy/cutoff/request') {
    const input = await body(req)
    const action = String(input?.action ?? '').trim()
    const appId = String(input?.appId ?? '').trim()
    const keyId = String(input?.keyId ?? '').trim()
    const keyMask = String(input?.keyMask ?? '').trim()
    const reason = String(input?.reason ?? '').trim()
    check(appId, 400, 'APP_ID_REQUIRED', '请选择目标智能体应用')
    check(reason && reason.length <= 2000, 400, 'REASON_REQUIRED', '请填写断流或恢复原因说明')
    if (action === 'revoke_api_key') {
      check(keyId, 400, 'KEY_ID_REQUIRED', '请选择要吊销的具体 API 密钥')
    }

    const policy = getActiveGovernancePolicy(store)
    assertCutoffSwitchAllowed(policy, action)

    const exposure = await subsystems.getDifyAppExposure({appId})
    check(exposure?.ok, 404, exposure?.error || 'APP_NOT_FOUND', '未在 Dify 中找到该应用')

    const ticketNo = `SEC-01-${id().slice(0, 8)}`
    const ticket = {
      kind: 'sec01-ticket',
      ticketNo,
      ticketType: 'SEC-01',
      status: '待审批',
      action,
      actionLabel: CUTOFF_ACTION_LABELS[action] || action,
      appId,
      appName: exposure.appName || appId,
      workspaceName: exposure.workspaceName || '',
      ownerName: exposure.ownerName || '',
      keyId: keyId || null,
      keyMask: keyMask || null,
      reason,
      applicant: identity.account,
      applicantName: identity.name || identity.account,
      createdAt: at,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      execution: null,
    }
    store.put(`sec01-ticket:${ticketNo}`, ticket)
    return json(res, {ok: true, ticket}, 201)
  }

  // 7. Approve or reject SEC-01 cutoff/resume ticket (admin only + re-verify CFG-05 switch!)
  if (req.method === 'POST' && path === '/api/governance-policy/cutoff/approve') {
    check(isAdmin, 403, 'ADMIN_REQUIRED', '仅系统管理员可审批外部访问断流/恢复工单')
    const input = await body(req)
    const ticketNo = String(input?.ticketNo ?? '').trim()
    const decision = String(input?.decision ?? 'approve').trim()
    const reviewNote = String(input?.reviewNote ?? '').trim()
    check(ticketNo && ['approve', 'reject'].includes(decision), 400, 'INVALID_REQUEST')

    const key = `sec01-ticket:${ticketNo}`
    const ticket = store.get(key)
    check(ticket && ticket.kind === 'sec01-ticket', 404, 'TICKET_NOT_FOUND', '未找到对应的 SEC-01 工单')
    check(ticket.status === '待审批', 409, 'TICKET_ALREADY_DECIDED', '该工单已处理，不能重复审批')

    if (decision === 'reject') {
      const updated = {
        ...ticket,
        status: '已驳回',
        reviewedBy: identity.account,
        reviewedByName: identity.name || identity.account,
        reviewedAt: at,
        reviewNote: reviewNote || '管理员驳回断流申请',
      }
      store.put(key, updated)
      return json(res, {ok: true, ticket: updated})
    }

    // Re-check CFG-05 switch at execution time!
    const policy = getActiveGovernancePolicy(store)
    assertCutoffSwitchAllowed(policy, ticket.action)

    const exec = await subsystems.executeDifyAppCutoff({
      action: ticket.action,
      appId: ticket.appId,
      keyId: ticket.keyId || undefined,
    })
    check(exec?.ok, 502, exec?.error || 'CUTOFF_EXECUTION_FAILED', `断流动作执行失败：${exec?.error || '未知错误'}`)

    const updated = {
      ...ticket,
      status: '已完成',
      reviewedBy: identity.account,
      reviewedByName: identity.name || identity.account,
      reviewedAt: at,
      reviewNote: reviewNote || '管理员审批通过并已执行',
      execution: {...exec, executedAt: at},
    }
    store.put(key, updated)
    return json(res, {ok: true, ticket: updated})
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
