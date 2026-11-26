import {existsSync} from 'node:fs'
import http from 'node:http'
import {body, check, id, json} from '../../../../runtime/http.mjs'

const DEFAULT_PROMPT_TEMPLATE = `你是一名资深 AI 应用架构师。下面是 Dify 平台上一个应用的 DSL 配置（YAML 格式）。
请用中文输出该应用的功能分析报告，包含以下部分（Markdown 格式）：

## 一、应用概述
应用类型（chat/agent/workflow/completion 等）与整体用途一句话概括。

## 二、核心功能点
逐条列出该应用实现的主要功能（3-6 条），说明"做什么、怎么做的"。

## 三、工作流程
描述输入从进入到产出结果的完整处理链路（涉及哪些节点/模型/工具及其职责）。

## 四、模型与提示词
使用的模型及分工，提示词的设计意图与特点。

## 五、知识库与外部工具
是否挂载知识库、调用了哪些外部工具/API 及各自作用。

## 六、总结与优化建议
2-3 条简评与可改进点。

要求：基于 YAML 真实内容分析，不要编造；简洁专业。

===== 应用 DSL (YAML) =====
{yaml}`

function dockerSockGet(path, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const req = http.request({socketPath: '/var/run/docker.sock', method: 'GET', path, timeout: timeoutMs}, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(buf)
        else reject(new Error(`DOCKER_SOCK_${res.statusCode || 500}`))
      })
    })
    req.on('timeout', () => req.destroy(new Error('DOCKER_TIMEOUT')))
    req.on('error', reject)
    req.end()
  })
}

function demuxDockerLogs(buf) {
  // Docker multiplexed stream uses 8-byte frames: [streamType, 0, 0, 0, size(4BE)]
  if (!buf || buf.length < 8) return buf ? buf.toString('utf8') : ''
  const first = buf[0]
  if ((first === 1 || first === 2) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0) {
    const parts = []
    let off = 0
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off + 4)
      off += 8
      if (off + len > buf.length) break
      parts.push(buf.subarray(off, off + len).toString('utf8'))
      off += len
    }
    return parts.join('')
  }
  return buf.toString('utf8')
}

async function probeDifyNginxCallerIps(appId = '') {
  if (!existsSync('/var/run/docker.sock')) {
    return {available: false, source: 'not_collected', appIps: [], gatewayIps: []}
  }
  try {
    const rawList = await dockerSockGet('/containers/json?all=false', 5000)
    const containers = JSON.parse(rawList.toString('utf8'))
    const nginx = containers.find(c => {
      const names = (c.Names || []).map(n => n.replace(/^\//, '').toLowerCase())
      const img = String(c.Image || '').toLowerCase()
      return !names.some(n => n.startsWith('app-center-')) && (names.some(n => n.includes('nginx')) || img.includes('nginx'))
    })
    if (!nginx?.Id) return {available: false, source: 'not_collected', appIps: [], gatewayIps: []}

    const logBuf = await dockerSockGet(`/containers/${encodeURIComponent(nginx.Id)}/logs?stdout=true&stderr=false&tail=2000`, 6000)
    const text = demuxDockerLogs(logBuf)
    const appIpMap = new Map()
    const gwIpMap = new Map()
    const lineRe = /^(\d{1,3}(?:\.\d{1,3}){3}|[a-f0-9:]+)\s+\S+\s+\S+\s+\[[^\]]+\]\s+"[A-Z]+\s+([^\s"]+)\s+HTTP\/[^"]+"\s+(\d{3})/i

    for (const line of text.split(/\r?\n/)) {
      const m = lineRe.exec(line.trim())
      if (!m) continue
      const ip = m[1]
      const urlPath = m[2]
      const status = Number(m[3])
      // Only count API / console / app interaction endpoints, ignore static assets
      if (!/^\/(v1|api|console\/api|chat|workflow|completion)\b/i.test(urlPath)) continue
      const gw = gwIpMap.get(ip) ?? {ip, count: 0, errors: 0}
      gw.count += 1
      if (status >= 400) gw.errors += 1
      gwIpMap.set(ip, gw)

      if (appId && urlPath.includes(appId)) {
        const ae = appIpMap.get(ip) ?? {ip, count: 0, errors: 0}
        ae.count += 1
        if (status >= 400) ae.errors += 1
        appIpMap.set(ip, ae)
      }
    }
    const sortDesc = map => [...map.values()].sort((a, b) => b.count - a.count).slice(0, 30)
    return {
      available: true,
      source: 'docker-nginx',
      containerName: (nginx.Names?.[0] || '').replace(/^\//, ''),
      appIps: sortDesc(appIpMap),
      gatewayIps: sortDesc(gwIpMap),
    }
  } catch {
    return {available: false, source: 'not_collected', appIps: [], gatewayIps: []}
  }
}

function getActiveAiConfig(store) {
  const cfg = store.get('agent-analysis-config:active')
  if (!cfg) {
    return {
      configured: false,
      aiBaseUrl: '',
      aiModel: '',
      aiApiKey: '',
      concurrency: 3,
      batchSize: 10,
      minRuns: 1,
      promptTemplate: DEFAULT_PROMPT_TEMPLATE,
      version: 0,
      updatedBy: null,
      updatedAt: null,
    }
  }
  return {
    configured: Boolean(cfg.aiBaseUrl && cfg.aiModel),
    ...cfg,
    promptTemplate: cfg.promptTemplate || DEFAULT_PROMPT_TEMPLATE,
  }
}

function sanitizeAiConfig(cfg) {
  const {aiApiKey, ...pub} = cfg
  return {...pub, hasApiKey: Boolean(aiApiKey)}
}

function sanitizeConfigTicket(t) {
  if (!t) return null
  const {aiApiKey, ...pub} = t
  return {...pub, hasApiKey: Boolean(aiApiKey)}
}

async function callAiAnalyzeYaml(cfg, yamlText) {
  check(cfg?.aiBaseUrl && cfg?.aiModel, 409, 'AI_CONFIG_REQUIRED', '尚未通过 CFG-04 工单配置 AI 分析大模型，请先提交并审批 CFG-04 配置工单')
  const base = String(cfg.aiBaseUrl).replace(/\/+$/, '')
  const endpoint = /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`
  const template = String(cfg.promptTemplate || DEFAULT_PROMPT_TEMPLATE)
  const truncatedYaml = String(yamlText || '').slice(0, 48000)
  const prompt = template.includes('{yaml}') ? template.replace('{yaml}', truncatedYaml) : `${template}\n\n${truncatedYaml}`

  const headers = {'content-type': 'application/json'}
  if (cfg.aiApiKey) headers.authorization = `Bearer ${cfg.aiApiKey}`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.aiModel,
      messages: [{role: 'user', content: prompt}],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(90000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `AI 模型接口返回 HTTP ${res.status}`
    const err = new Error(msg)
    err.status = 502
    throw err
  }
  const content = data?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    throw new Error('AI 模型未返回有效的分析报告正文')
  }
  return content.trim()
}

export async function routeAgentInsights(services) {
  const {directory, hasRole, identity, options, path, req, res, subsystems} = services
  check(identity?.active && (hasRole(identity, 'admin') || hasRole(identity, 'operator')), 403, 'ACCESS_DENIED')
  const now = (options.now ?? Date.now)()
  const at = new Date(now).toISOString()
  const store = directory.store
  const isAdmin = hasRole(identity, 'admin')
  const url = new URL(req.url, 'http://localhost')

  // 1. CFG-04 active config & ticket history
  if (req.method === 'GET' && path === '/api/agent-insights/config') {
    const active = getActiveAiConfig(store)
    const tickets = store.all()
      .filter(r => r && r.kind === 'cfg04-ticket')
      .map(sanitizeConfigTicket)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    return json(res, {
      canApprove: isAdmin,
      config: sanitizeAiConfig(active),
      tickets,
    })
  }

  // 2. Per-app deep insights (model breakdown + caller IPs + DSL/YAML static + latest AI report)
  if (req.method === 'GET' && path === '/api/agent-insights/app-detail') {
    const appId = String(url.searchParams.get('appId') ?? '').trim()
    const days = Number(url.searchParams.get('days') ?? 30) || 30
    check(appId, 400, 'APP_ID_REQUIRED', '请指定要分析的应用 ID')

    const [detail, ipInfo] = await Promise.all([
      subsystems.getDifyAppInsights({appId, days}),
      probeDifyNginxCallerIps(appId),
    ])
    check(detail?.ok, detail?.error === 'APP_NOT_FOUND' ? 404 : 502, detail?.error || 'APP_INSIGHTS_FAILED')

    const activeCfg = getActiveAiConfig(store)
    const latestReport = store.get(`agent-ai-report:${appId}`) ?? null

    return json(res, {
      ...detail,
      callerIps: ipInfo,
      aiReady: activeCfg.configured,
      aiModel: activeCfg.aiModel || null,
      latestReport,
    })
  }

  // 3. High-frequency apps list for batch AI analysis
  if (req.method === 'GET' && path === '/api/agent-insights/high-freq') {
    const minRuns = Number(url.searchParams.get('minRuns') ?? 0) || 0
    const days = Number(url.searchParams.get('days') ?? 30) || 30
    const resData = await subsystems.getDifyHighFreqApps({minRuns, days})
    const items = (resData.items || []).map(item => {
      const rep = store.get(`agent-ai-report:${item.appId}`)
      return {...item, hasReport: Boolean(rep), lastAnalyzedAt: rep?.analyzedAt || null}
    })
    return json(res, {ok: true, days, minRuns, items})
  }

  // 4. Historical AI analysis tasks
  if (req.method === 'GET' && path === '/api/agent-insights/tasks') {
    const tasks = store.all()
      .filter(r => r && r.kind === 'agent-ai-task')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 30)
    return json(res, {tasks})
  }

  // 5. Export task reports as CSV (UTF-8 BOM for Excel)
  if (req.method === 'GET' && path === '/api/agent-insights/export') {
    const taskId = String(url.searchParams.get('taskId') ?? '').trim()
    const task = store.get(`agent-ai-task:${taskId}`)
    check(task, 404, 'TASK_NOT_FOUND', '分析任务不存在')
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [
      ['序号', '应用名称', '应用ID', '模式', '分析状态', '耗时(秒)', '分析时间', 'AI功能分析报告'].map(esc).join(','),
      ...(task.items || []).map((it, idx) => {
        const rep = store.get(`agent-ai-report:${it.appId}`)
        return [idx + 1, it.appName, it.appId, it.mode || '', it.status, it.elapsedSec ?? '', it.finishedAt || task.createdAt, rep?.report || it.error || ''].map(esc).join(',')
      }),
    ]
    const csv = '\uFEFF' + lines.join('\r\n')
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="agent-ai-analysis-${taskId}.csv"`,
    })
    res.end(csv)
    return
  }

  check(req.method === 'POST' && (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host), 403, 'ACCESS_DENIED')
  const input = await body(req)

  // 6. CFG-04 work order request
  if (path === '/api/agent-insights/config/request') {
    const aiBaseUrl = String(input?.aiBaseUrl ?? '').trim()
    const aiModel = String(input?.aiModel ?? '').trim()
    const aiApiKey = String(input?.aiApiKey ?? '').trim()
    const concurrency = Math.max(1, Math.min(10, Number(input?.concurrency ?? 3) || 3))
    const batchSize = Math.max(1, Math.min(50, Number(input?.batchSize ?? 10) || 10))
    const minRuns = Math.max(0, Number(input?.minRuns ?? 1) || 0)
    const promptTemplate = String(input?.promptTemplate ?? '').trim() || DEFAULT_PROMPT_TEMPLATE
    const reason = String(input?.reason ?? '').trim()

    check(/^https?:\/\//i.test(aiBaseUrl), 400, 'INVALID_AI_BASE_URL', '请填写合法的 AI 分析模型 API 地址（http:// 或 https://）')
    check(aiModel.length >= 1 && aiModel.length <= 120, 400, 'INVALID_AI_MODEL', '请填写 AI 分析模型名称')
    check(reason.length >= 2 && reason.length <= 1000, 400, 'INVALID_REASON', '请输入配置变更申请原因')

    const prev = getActiveAiConfig(store)
    const ticketNo = `CFG-04-${id().slice(0, 8)}`
    const ticket = store.put(`cfg04:${ticketNo}`, {
      kind: 'cfg04-ticket',
      ticketNo,
      aiBaseUrl,
      aiModel,
      aiApiKey: aiApiKey || prev.aiApiKey || '',
      concurrency,
      batchSize,
      minRuns,
      promptTemplate,
      reason,
      applicant: identity.account,
      applicantName: identity.name || identity.account,
      org: identity.org || '平台运营组',
      status: '待审批',
      createdAt: at,
      reviewedAt: null,
      reviewer: null,
      reviewNote: null,
    })
    return json(res, {ok: true, ticket: sanitizeConfigTicket(ticket)}, 201)
  }

  // 7. CFG-04 work order approval (admin only)
  if (path === '/api/agent-insights/config/approve') {
    check(isAdmin, 403, 'ADMIN_ONLY', '仅系统管理员可审批 CFG-04 分析引擎配置工单')
    const ticketNo = String(input?.ticketNo ?? '').trim()
    const decision = input?.decision === 'reject' ? 'reject' : 'approve'
    const reviewNote = String(input?.reviewNote ?? (decision === 'approve' ? '审批通过并热生效' : '驳回配置变更')).trim()
    const existing = store.get(`cfg04:${ticketNo}`)
    check(existing && existing.status === '待审批', 404, 'TICKET_NOT_PENDING', '该工单不存在或已办理')

    if (decision === 'reject') {
      const updated = store.put(`cfg04:${ticketNo}`, {...existing, status: '已驳回', reviewedAt: at, reviewer: identity.account, reviewNote})
      return json(res, {ok: true, ticket: sanitizeConfigTicket(updated)})
    }

    const prev = getActiveAiConfig(store)
    const active = store.put('agent-analysis-config:active', {
      kind: 'agent-analysis-config',
      aiBaseUrl: existing.aiBaseUrl,
      aiModel: existing.aiModel,
      aiApiKey: existing.aiApiKey,
      concurrency: existing.concurrency,
      batchSize: existing.batchSize,
      minRuns: existing.minRuns,
      promptTemplate: existing.promptTemplate,
      version: Number(prev.version || 0) + 1,
      ticketNo,
      updatedBy: identity.account,
      updatedByName: identity.name || identity.account,
      updatedAt: at,
    })
    const updated = store.put(`cfg04:${ticketNo}`, {...existing, status: '已完成', reviewedAt: at, reviewer: identity.account, reviewNote})
    return json(res, {ok: true, ticket: sanitizeConfigTicket(updated), config: sanitizeAiConfig(active)})
  }

  // 8. Execute single or batch AI YAML analysis using active CFG-04 config
  if (path === '/api/agent-insights/analyze') {
    const activeCfg = getActiveAiConfig(store)
    check(activeCfg.configured, 409, 'AI_CONFIG_REQUIRED', '尚未通过 CFG-04 工单配置 AI 分析大模型，请先提交并审批 CFG-04 配置工单')

    const appIds = Array.isArray(input?.appIds)
      ? input.appIds.map(s => String(s || '').trim()).filter(Boolean)
      : (input?.appId ? [String(input.appId).trim()] : [])
    check(appIds.length > 0 && appIds.length <= 50, 400, 'INVALID_APP_IDS', '请选择 1～50 个应用进行分析')

    const taskId = `ai-${id().slice(0, 8)}`
    const results = []
    let succeeded = 0
    let failed = 0
    const conc = Math.max(1, Math.min(5, Number(activeCfg.concurrency || 3)))

    // Process in chunks of `conc`
    for (let i = 0; i < appIds.length; i += conc) {
      const slice = appIds.slice(i, i + conc)
      const batchOut = await Promise.all(slice.map(async appId => {
        const t0 = Date.now()
        try {
          const detail = await subsystems.getDifyAppInsights({appId, days: 30})
          if (!detail?.ok) throw new Error(detail?.error || '无法读取应用 DSL')
          const report = await callAiAnalyzeYaml(activeCfg, detail.dsl.yamlText)
          const elapsedSec = Math.round((Date.now() - t0) / 100) / 10
          const finAt = new Date().toISOString()
          const savedRep = store.put(`agent-ai-report:${appId}`, {
            kind: 'agent-ai-report',
            appId,
            appName: detail.app.name,
            mode: detail.app.mode,
            taskId,
            model: activeCfg.aiModel,
            report,
            elapsedSec,
            analyzedBy: identity.account,
            analyzedAt: finAt,
          })
          succeeded += 1
          return {appId, appName: detail.app.name, mode: detail.app.mode, status: '成功', elapsedSec, finishedAt: finAt, report: savedRep}
        } catch (err) {
          failed += 1
          return {appId, appName: appId, mode: '', status: '失败', elapsedSec: Math.round((Date.now() - t0) / 100) / 10, error: err?.message || '分析失败'}
        }
      }))
      results.push(...batchOut)
    }

    const task = store.put(`agent-ai-task:${taskId}`, {
      kind: 'agent-ai-task',
      taskId,
      model: activeCfg.aiModel,
      total: appIds.length,
      succeeded,
      failed,
      createdBy: identity.account,
      createdByName: identity.name || identity.account,
      createdAt: at,
      items: results.map(({report, ...meta}) => meta),
    })

    return json(res, {
      ok: failed === 0,
      task,
      latestReport: appIds.length === 1 ? (results[0]?.report ?? null) : null,
    })
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
