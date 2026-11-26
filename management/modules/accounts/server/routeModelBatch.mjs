import {body, check, id, json} from '../../../../runtime/http.mjs'

const ALLOWED_OPS = ['全员统一配置模型', '新户默认配齐公共模型', '全员统一删除模型', '全员批量禁用模型', '全员批量启用模型']

function sanitizeTicket(t) {
  if (!t) return null
  const {apiKey, ...pub} = t
  return {...pub, hasApiKey: Boolean(apiKey)}
}

function sanitizeTemplate(t) {
  if (!t) return null
  const {apiKey, ...pub} = t
  return {...pub, hasApiKey: Boolean(apiKey)}
}

export async function routeModelBatch(services) {
  const {directory, hasRole, identity, options, path, req, res, subsystems} = services
  check(identity?.active && (hasRole(identity, 'admin') || hasRole(identity, 'operator')), 403, 'ACCESS_DENIED')
  const now = (options.now ?? Date.now)()
  const at = new Date(now).toISOString()
  const store = directory.store
  const isAdmin = hasRole(identity, 'admin')

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
          modelsCount: 0,
        })
      }
    }
    for (const item of [...(inv.apps ?? []), ...(inv.modelUsage ?? [])]) {
      if (!item?.workspaceId) continue
      if (!wsMap.has(item.workspaceId)) {
        wsMap.set(item.workspaceId, {
          workspaceId: item.workspaceId,
          workspaceName: item.workspaceName || item.workspaceId.slice(0, 8),
          ownerAccount: item.ownerAccount || '',
          ownerName: item.ownerName || item.workspaceName || 'Dify 工作区',
          org: item.org || '待归属',
          modelsCount: 0,
        })
      }
    }

    const modelMap = new Map()
    for (const u of inv.modelUsage ?? []) {
      const providerName = String(u.providerName || '').trim()
      const modelName = String(u.modelName || '').trim()
      const modelType = String(u.modelType || 'text-generation').trim()
      if (!providerName || !modelName) continue
      if (u.workspaceId && wsMap.has(u.workspaceId)) wsMap.get(u.workspaceId).modelsCount += 1
      const key = `${providerName}::${modelName}::${modelType}`
      if (!modelMap.has(key)) {
        modelMap.set(key, {
          key,
          providerName,
          modelName,
          modelType,
          workspaces: new Set(),
          enabledWorkspaces: new Set(),
          monthlyTokens: 0,
          monthlyCalls: 0,
        })
      }
      const entry = modelMap.get(key)
      if (u.workspaceId) {
        entry.workspaces.add(u.workspaceId)
        if (u.enabled !== false) entry.enabledWorkspaces.add(u.workspaceId)
      }
      entry.monthlyTokens += Number(u.monthlyTokens || 0)
      entry.monthlyCalls += Number(u.monthlyCalls || 0)
    }

    const totalWorkspacesCount = wsMap.size
    const uniqueModels = [...modelMap.values()].map(m => ({
      key: m.key,
      providerName: m.providerName,
      modelName: m.modelName,
      modelType: m.modelType,
      configuredWorkspacesCount: m.workspaces.size,
      enabledWorkspacesCount: m.enabledWorkspaces.size,
      totalWorkspacesCount,
      monthlyTokens: m.monthlyTokens,
      monthlyCalls: m.monthlyCalls,
    })).sort((a, b) => b.configuredWorkspacesCount - a.configuredWorkspacesCount || b.monthlyTokens - a.monthlyTokens)

    const workspaces = [...wsMap.values()].sort((a, b) => a.modelsCount - b.modelsCount)
    const templates = store.all()
      .filter(r => r && r.kind === 'public-model-template')
      .map(sanitizeTemplate)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    const tickets = store.all()
      .filter(r => r && r.kind === 'model-batch-ticket')
      .map(sanitizeTicket)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

    return {uniqueModels, workspaces, templates, tickets}
  }

  if (req.method === 'GET' && path === '/api/model-batch') {
    const inv = subsystems?.getDifyInventory?.() ?? {apps: [], modelUsage: []}
    const snap = buildSnapshot(inv)
    return json(res, {
      canApprove: isAdmin,
      syncedAt: inv.syncedAt || null,
      ...snap,
    })
  }

  check(req.method === 'POST' && (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host), 403, 'ACCESS_DENIED')
  const input = await body(req)

  if (path === '/api/model-batch/request') {
    const operationType = String(input?.operationType ?? '').trim()
    check(ALLOWED_OPS.includes(operationType), 400, 'INVALID_OPERATION_TYPE', '无效的模型批量操作类型')

    const providerName = String(input?.providerName ?? 'langgenius/openai_api_compatible/openai_api_compatible').trim()
    const modelName = String(input?.modelName ?? '').trim()
    const modelType = String(input?.modelType ?? 'text-generation').trim() || 'text-generation'
    const displayName = String(input?.displayName ?? '').trim() || modelName
    const endpointUrl = String(input?.endpointUrl ?? '').trim()
    const apiKey = String(input?.apiKey ?? '').trim()
    const contextSize = String(input?.contextSize ?? '4096').trim() || '4096'
    const maxTokens = String(input?.maxTokens ?? '4096').trim() || '4096'
    const mode = String(input?.mode ?? 'chat').trim() || 'chat'
    const targetWorkspaceId = String(input?.targetWorkspaceId ?? '').trim()
    const targetWorkspaceName = String(input?.targetWorkspaceName ?? '').trim()
    const reason = String(input?.reason ?? '').trim()

    if (operationType === '全员统一配置模型') {
      check(providerName && modelName, 400, 'MODEL_REQUIRED', '请填写供应商与模型名称')
      check(/^https?:\/\//i.test(endpointUrl), 400, 'INVALID_ENDPOINT', '请填写合法的模型 API 地址（http:// 或 https://）')
    } else if (operationType === '新户默认配齐公共模型') {
      check(targetWorkspaceId, 400, 'WORKSPACE_REQUIRED', '请选择目标租户工作区')
    } else {
      check(providerName && modelName, 400, 'MODEL_REQUIRED', '请选择目标模型')
    }
    check(reason.length >= 2 && reason.length <= 1000, 400, 'INVALID_REASON', '请输入工单申请原因')

    const ticketNo = `MOD-02-${id().slice(0, 8)}`
    const saved = store.put(`model-batch:${ticketNo}`, {
      kind: 'model-batch-ticket',
      ticketNo,
      operationType,
      providerName: operationType === '新户默认配齐公共模型' ? null : providerName,
      modelName: operationType === '新户默认配齐公共模型' ? null : modelName,
      modelType,
      displayName: operationType === '新户默认配齐公共模型' ? null : displayName,
      endpointUrl: operationType === '全员统一配置模型' ? endpointUrl : null,
      apiKey: operationType === '全员统一配置模型' ? apiKey : '',
      contextSize,
      maxTokens,
      mode,
      targetWorkspaceId: targetWorkspaceId || null,
      targetWorkspaceName: targetWorkspaceName || null,
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
    return json(res, {ok: true, ticket: sanitizeTicket(saved)}, 201)
  }

  if (path === '/api/model-batch/approve') {
    check(isAdmin, 403, 'ADMIN_ONLY', '仅系统管理员可审批执行全员模型批量工单')
    const ticketNo = String(input?.ticketNo ?? '').trim()
    const decision = input?.decision === 'reject' ? 'reject' : 'approve'
    const reviewNote = String(input?.reviewNote ?? (decision === 'approve' ? '审批通过并批量生效' : '驳回申请')).trim()
    const existing = store.get(`model-batch:${ticketNo}`)
    check(existing && existing.status === '待审批', 404, 'TICKET_NOT_PENDING', '该工单不存在或已办理')

    if (decision === 'reject') {
      const updated = store.put(`model-batch:${ticketNo}`, {
        ...existing,
        status: '已驳回',
        reviewedAt: at,
        reviewer: identity.account,
        reviewNote,
      })
      return json(res, {ok: true, ticket: sanitizeTicket(updated)})
    }

    let executionSummary = ''
    let ok = true

    if (existing.operationType === '全员统一配置模型') {
      const r = await subsystems.batchUpsertDifyModel({
        workspaceIds: null,
        providerName: existing.providerName,
        modelName: existing.modelName,
        modelType: existing.modelType,
        displayName: existing.displayName,
        endpointUrl: existing.endpointUrl,
        apiKey: existing.apiKey,
        contextSize: existing.contextSize,
        maxTokens: existing.maxTokens,
        mode: existing.mode,
      })
      ok = Boolean(r?.ok)
      if (ok) {
        const tplKey = `public-model-template:${existing.providerName}::${existing.modelName}::${existing.modelType}`
        store.put(tplKey, {
          kind: 'public-model-template',
          templateKey: tplKey,
          providerName: existing.providerName,
          modelName: existing.modelName,
          modelType: existing.modelType,
          displayName: existing.displayName,
          endpointUrl: existing.endpointUrl,
          apiKey: existing.apiKey,
          contextSize: existing.contextSize,
          maxTokens: existing.maxTokens,
          mode: existing.mode,
          updatedBy: identity.account,
          updatedAt: at,
        })
        executionSummary = `已向全平台 ${r.totalTenants} 个租户工作区统一配置模型「${existing.modelName}」并按租户公钥加密密钥：成功 ${r.succeeded}、失败 ${r.failed}，已同步登记为公共模型模板`
      } else {
        executionSummary = `全员配置失败：${r?.error || (r?.errors || []).join('；') || '未知错误'}`
      }
    } else if (existing.operationType === '新户默认配齐公共模型') {
      const templates = store.all().filter(r => r && r.kind === 'public-model-template')
      if (templates.length === 0) {
        ok = false
        executionSummary = '当前尚未登记任何内网公共模型模板，请先执行一次「全员统一配置模型」'
      } else {
        let okCount = 0
        let failCount = 0
        for (const tpl of templates) {
          const r = await subsystems.batchUpsertDifyModel({
            workspaceIds: [existing.targetWorkspaceId],
            providerName: tpl.providerName,
            modelName: tpl.modelName,
            modelType: tpl.modelType,
            displayName: tpl.displayName,
            endpointUrl: tpl.endpointUrl,
            apiKey: tpl.apiKey,
            contextSize: tpl.contextSize,
            maxTokens: tpl.maxTokens,
            mode: tpl.mode,
          })
          if (r?.ok) okCount++; else failCount++
        }
        ok = failCount === 0 && okCount > 0
        executionSummary = `已为工作区「${existing.targetWorkspaceName || existing.targetWorkspaceId}」批量配齐公共模型：成功 ${okCount}、失败 ${failCount}`
      }
    } else if (existing.operationType === '全员统一删除模型') {
      const r = await subsystems.batchDeleteDifyModel({
        workspaceIds: null,
        providerName: existing.providerName,
        modelName: existing.modelName,
        modelType: existing.modelType,
      })
      ok = Boolean(r?.ok)
      if (ok) {
        // Also clean up any matching public template
        for (const tpl of store.all()) {
          if (tpl?.kind === 'public-model-template' && tpl.providerName === existing.providerName && tpl.modelName === existing.modelName) {
            store.put(tpl.templateKey, {...tpl, kind: 'public-model-template-deleted', deletedAt: at})
          }
        }
        executionSummary = `已从全平台所有工作区彻底删除模型「${existing.modelName}」：清理模型配置 ${r.deletedModels} 条、开关记录 ${r.deletedSettings} 条`
      } else {
        executionSummary = `全员删除失败：${r?.error || '未知错误'}`
      }
    } else if (existing.operationType === '全员批量禁用模型' || existing.operationType === '全员批量启用模型') {
      const targetEnabled = existing.operationType === '全员批量启用模型'
      const r = await subsystems.batchToggleDifyModel({
        workspaceIds: null,
        providerName: existing.providerName,
        modelName: existing.modelName,
        modelType: existing.modelType,
        enabled: targetEnabled,
      })
      ok = Boolean(r?.ok)
      executionSummary = ok
        ? `已对全平台 ${r.affected} 个工作区执行「${existing.modelName}」${targetEnabled ? '批量启用' : '批量禁用'}`
        : `全员${targetEnabled ? '启用' : '禁用'}失败：${r?.error || '未知错误'}`
    }

    if (subsystems?.refreshDifyInventory) {
      await subsystems.refreshDifyInventory().catch(() => {})
    }

    const updated = store.put(`model-batch:${ticketNo}`, {
      ...existing,
      status: ok ? '已完成' : '执行失败',
      reviewedAt: at,
      reviewer: identity.account,
      reviewNote,
      executionSummary,
    })
    return json(res, {ok, ticket: sanitizeTicket(updated), executionSummary})
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
