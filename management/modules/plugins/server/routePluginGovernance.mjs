import http from 'node:http'
import {existsSync} from 'node:fs'
import {body, check, id, json} from '../../../../runtime/http.mjs'

function dockerSocketRequest(method, path, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.request({socketPath: '/var/run/docker.sock', method, path, timeout: timeoutMs}, res => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(data)
        else reject(new Error(`DOCKER_SOCK_${res.statusCode || 500}: ${data.slice(0, 160)}`))
      })
    })
    req.on('timeout', () => req.destroy(new Error('DOCKER_TIMEOUT')))
    req.on('error', reject)
    req.end()
  })
}

async function probePluginDaemonProcesses() {
  if (!existsSync('/var/run/docker.sock')) {
    return {available: false, containerId: null, containerName: null, daemonProcess: null, processes: [], totalMemoryMb: 0}
  }
  try {
    const listRaw = await dockerSocketRequest('GET', '/containers/json?all=false', 5000)
    const containers = JSON.parse(listRaw)
    const daemon = containers.find(c => {
      const name = String(c.Names?.[0] || '').toLowerCase()
      const svc = String(c.Labels?.['com.docker.compose.service'] || '').toLowerCase()
      return svc === 'plugin_daemon' || name.includes('plugin_daemon')
    })
    if (!daemon) {
      return {available: false, containerId: null, containerName: null, daemonProcess: null, processes: [], totalMemoryMb: 0}
    }
    const containerId = String(daemon.Id || '')
    const containerName = String(daemon.Names?.[0] || '').replace(/^\//, '')
    const topRaw = await dockerSocketRequest('GET', `/containers/${encodeURIComponent(containerId)}/top?ps_args=aux`, 6000)
    const top = JSON.parse(topRaw)
    const titles = Array.isArray(top.Titles) ? top.Titles : []
    const idx = name => titles.findIndex(t => String(t).toUpperCase() === name)
    const iPid = idx('PID')
    const iCpu = idx('%CPU')
    const iMem = idx('%MEM')
    const iRss = idx('RSS')
    const iStart = idx('START')
    const iTime = idx('TIME')
    const iCmd = idx('COMMAND') >= 0 ? idx('COMMAND') : titles.length - 1

    let daemonProcess = null
    const processes = []
    let totalMemoryMb = 0

    for (const row of top.Processes ?? []) {
      const pid = Number(row[iPid] || 0)
      const cpuPercent = Number(row[iCpu] || 0)
      const memoryPercent = Number(row[iMem] || 0)
      const rssKb = Number(row[iRss] || 0)
      const memoryMb = Math.round((rssKb / 1024) * 10) / 10
      const startedAt = String(row[iStart] || '')
      const cpuTime = String(row[iTime] || '')
      const cmd = String(row[iCmd] || '')

      if (cmd.trim() === '/app/main' || cmd.includes('/app/main ')) {
        daemonProcess = {pid, cpuPercent, memoryMb, memoryPercent, startedAt, cpuTime, status: '运行中'}
        totalMemoryMb += memoryMb
        continue
      }

      // Match /app/storage/cwd/<author>/<name>-<version>@<hash>/.venv/bin/python
      const m = /\/storage\/cwd\/([^/\s]+)\/([^/\s@]+)-([0-9]+\.[0-9]+\.[0-9]+[^@\s/]*)@([a-f0-9]+)/i.exec(cmd)
      if (m) {
        const pluginId = `${m[1]}/${m[2]}`
        const version = m[3]
        const uniqueIdentifier = `${pluginId}:${version}@${m[4]}`
        processes.push({
          pluginId,
          version,
          uniqueIdentifier,
          pid,
          cpuPercent,
          memoryMb,
          memoryPercent,
          startedAt,
          cpuTime,
          status: memoryMb >= 500 ? '内存偏高' : '运行中',
        })
        totalMemoryMb += memoryMb
      }
    }

    return {
      available: true,
      containerId,
      containerName,
      daemonProcess,
      processes,
      totalMemoryMb: Math.round(totalMemoryMb * 10) / 10,
    }
  } catch {
    return {available: false, containerId: null, containerName: null, daemonProcess: null, processes: [], totalMemoryMb: 0}
  }
}

const MEM_ALERT_MB = Number(process.env.PLUGIN_MEM_ALERT_MB || 500)
const CPU_ALERT_PCT = Number(process.env.PLUGIN_CPU_ALERT_PCT || 80)
const LEAK_DELTA_MB = Number(process.env.PLUGIN_LEAK_DELTA_MB || 100)

// In-memory sliding window per pluginId to detect memory leaks & OOM/crash PID restarts
const processHistory = new Map()

function recordProcessSample(proc, now) {
  const key = proc.pluginId.toLowerCase()
  let entry = processHistory.get(key)
  if (!entry) {
    entry = {lastPid: proc.pid, restartCount: 0, samples: []}
    processHistory.set(key, entry)
  }
  if (entry.lastPid && proc.pid && entry.lastPid !== proc.pid) {
    entry.restartCount += 1
    entry.lastPid = proc.pid
  }
  const prev = entry.samples.at(-1)
  if (!prev || now - prev.at >= 30_000) {
    entry.samples.push({at: now, pid: proc.pid, memoryMb: proc.memoryMb, cpuPercent: proc.cpuPercent})
    if (entry.samples.length > 10) entry.samples.shift()
  }
  const first = entry.samples[0]
  const memoryDeltaMb = first ? Math.round((proc.memoryMb - first.memoryMb) * 10) / 10 : 0
  let isMonotonicLeak = false
  if (entry.samples.length >= 5 && memoryDeltaMb >= LEAK_DELTA_MB) {
    isMonotonicLeak = true
    for (let i = 1; i < entry.samples.length; i++) {
      if (entry.samples[i].memoryMb < entry.samples[i - 1].memoryMb) {
        isMonotonicLeak = false
        break
      }
    }
  }
  const alerts = []
  if (proc.memoryMb >= MEM_ALERT_MB) alerts.push({ruleCode: 'PLUGIN_MEMORY_HIGH', severity: '严重', label: '内存超限', detail: `插件 ${proc.pluginId}（PID ${proc.pid}）当前内存占用 ${proc.memoryMb} MB，已超过告警阈值 ${MEM_ALERT_MB} MB。`})
  if (isMonotonicLeak) alerts.push({ruleCode: 'PLUGIN_MEMORY_LEAK', severity: '严重', label: '疑似内存泄漏', detail: `插件 ${proc.pluginId}（PID ${proc.pid}）连续 ${entry.samples.length} 次采样内存持续上涨 +${memoryDeltaMb} MB（当前 ${proc.memoryMb} MB），疑似发生内存泄漏或即将 OOM。`})
  if (proc.cpuPercent >= CPU_ALERT_PCT) alerts.push({ruleCode: 'PLUGIN_CPU_HIGH', severity: '一般', label: 'CPU偏高', detail: `插件 ${proc.pluginId}（PID ${proc.pid}）当前 CPU 占用 ${proc.cpuPercent}%，超过阈值 ${CPU_ALERT_PCT}%。`})
  if (entry.restartCount >= 2) alerts.push({ruleCode: 'PLUGIN_OOM_RESTART', severity: '严重', label: '频繁异常重启', detail: `插件 ${proc.pluginId} 已检测到 ${entry.restartCount} 次进程 PID 变动（当前 PID ${proc.pid}），疑似因内存溢出或崩溃反复重启。`})

  return {
    restartCount: entry.restartCount,
    memoryDeltaMb,
    alerts,
    healthStatus: alerts.length > 0 ? alerts[0].label : '运行中',
  }
}

export async function monitorPluginProcesses({events, types, now = Date.now()} = {}) {
  const procInfo = await probePluginDaemonProcesses()
  if (!procInfo.available) return {checked: 0, alertsCreated: 0}
  const at = new Date(now).toISOString()
  let alertsCreated = 0
  for (const proc of procInfo.processes) {
    const analysis = recordProcessSample(proc, now)
    if (!events || !types || !analysis.alerts.length) continue
    for (const al of analysis.alerts) {
      const resourceId = `plugin-proc:${proc.pluginId}`
      const alreadyOpen = events.all().some(e => e.ruleCode === al.ruleCode && e.resourceId === resourceId && e.status !== '已关闭')
      if (alreadyOpen) continue
      const ticketNo = `EVT-01-PLG-${id().slice(0, 8)}`
      events.put(ticketNo, {
        ticketNo,
        account: 'system-plugin-guard',
        resourceId,
        resourceName: `${proc.pluginId} (v${proc.version})`,
        originDraft: null,
        facts: al.detail,
        objectType: '插件',
        creationMode: '自动巡检',
        alertId: 'AL-' + id(),
        ruleCode: al.ruleCode,
        originalSeverity: al.severity,
        firstOccurredAt: at,
        lastOccurredAt: at,
        evidence: {facts: al.detail},
        status: '未研判',
        version: types.activeVersion('EVT-01'),
        revision: 1,
        history: [{at, actor: 'system-plugin-guard', action: `插件进程自动告警（${al.label}）`, fromStatus: null, toStatus: '未研判', note: al.detail}],
      })
      alertsCreated += 1
    }
  }
  return {checked: procInfo.processes.length, alertsCreated}
}

function getPluginDaemonEndpoint(subsystems) {
  const dify = subsystems?.defaultDify?.()
  const base = String(dify?.pluginDaemonBase || process.env.DIFY_PLUGIN_DAEMON_BASE || 'http://docker-plugin_daemon-1:5002').replace(/\/+$/, '')
  const key = String(process.env.DIFY_PLUGIN_DAEMON_KEY || 'lYkiYYT6owG+71oLerGzA7GXCgOT++6ovaezWAjpCjf+Sjc3ZtU+qUEi').trim()
  return {base, key}
}

async function callPluginDaemon(base, key, path, payload) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Api-Key': key,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => null)
  return {ok: res.ok && (data?.code === 0 || data?.data !== undefined), status: res.status, data}
}

export async function routePluginGovernance(services) {
  const {directory, hasRole, identity, options, path, req, res, subsystems} = services
  check(identity?.active, 403, 'ACCESS_DENIED')
  const isStaff = hasRole(identity, 'admin') || hasRole(identity, 'operator')
  const now = (options.now ?? Date.now)()
  const store = directory.store

  if (req.method === 'GET' && path === '/api/plugin-governance') {
    check(isStaff, 403, 'ACCESS_DENIED')
    const url = new URL(req.url, 'http://localhost')
    const refresh = url.searchParams.get('refresh') === '1'
    const inv = refresh && subsystems?.refreshDifyInventory
      ? await subsystems.refreshDifyInventory()
      : (subsystems?.getDifyInventory?.() ?? {syncedAt: null, apps: [], datasets: [], plugins: []})

    const procInfo = await probePluginDaemonProcesses()

    // Build workspaces list from directory subjects + inventory
    const wsMap = new Map()
    for (const p of directory.subjects()) {
      if (p.difyWorkspaceId) {
        wsMap.set(p.difyWorkspaceId, {
          workspaceId: p.difyWorkspaceId,
          workspaceName: p.difyWorkspaceName || `${p.name}的工作区`,
          ownerAccount: p.account,
          ownerName: p.name,
          org: p.org || '待归属',
          installedPlugins: new Set(),
        })
      }
    }
    for (const item of [...(inv.apps ?? []), ...(inv.plugins ?? [])]) {
      if (!item?.workspaceId) continue
      if (!wsMap.has(item.workspaceId)) {
        wsMap.set(item.workspaceId, {
          workspaceId: item.workspaceId,
          workspaceName: item.workspaceName || item.workspaceId.slice(0, 8),
          ownerAccount: item.ownerAccount || '',
          ownerName: item.ownerName || item.workspaceName || 'Dify 工作区',
          org: item.org || '待归属',
          installedPlugins: new Set(),
        })
      }
    }

    // Aggregate unique plugins across all tenants + match live process metrics & leak/restart analysis
    const procByPluginId = new Map()
    for (const pr of procInfo.processes) {
      const analysis = recordProcessSample(pr, now)
      procByPluginId.set(pr.pluginId.toLowerCase(), {...pr, ...analysis})
    }

    const pluginCatalog = new Map()
    for (const inst of inv.plugins ?? []) {
      const pid = String(inst.pluginId || inst.pluginName || '').trim()
      if (!pid) continue
      if (inst.workspaceId && wsMap.has(inst.workspaceId)) {
        wsMap.get(inst.workspaceId).installedPlugins.add(pid)
      }
      if (!pluginCatalog.has(pid)) {
        const proc = procByPluginId.get(pid.toLowerCase()) ?? null
        pluginCatalog.set(pid, {
          pluginId: pid,
          pluginUniqueIdentifier: inst.pluginUniqueIdentifier || `${pid}:${inst.version || '1.0.0'}`,
          version: inst.version || '1.0.0',
          source: inst.source || 'package',
          installedWorkspaces: new Set(),
          runningPid: proc?.pid ?? null,
          cpuPercent: proc?.cpuPercent ?? null,
          memoryMb: proc?.memoryMb ?? null,
          memoryDeltaMb: proc?.memoryDeltaMb ?? 0,
          restartCount: proc?.restartCount ?? 0,
          processStatus: proc ? proc.healthStatus : '按需休眠',
        })
      }
      if (inst.workspaceId) pluginCatalog.get(pid).installedWorkspaces.add(inst.workspaceId)
      if (inst.pluginUniqueIdentifier && inst.pluginUniqueIdentifier.includes('@')) {
        pluginCatalog.get(pid).pluginUniqueIdentifier = inst.pluginUniqueIdentifier
      }
    }
    // Include running processes even if not in DB snapshot yet
    for (const pr of procInfo.processes) {
      if (!pluginCatalog.has(pr.pluginId)) {
        const enriched = procByPluginId.get(pr.pluginId.toLowerCase())
        pluginCatalog.set(pr.pluginId, {
          pluginId: pr.pluginId,
          pluginUniqueIdentifier: pr.uniqueIdentifier,
          version: pr.version,
          source: 'package',
          installedWorkspaces: new Set(),
          runningPid: pr.pid,
          cpuPercent: pr.cpuPercent,
          memoryMb: pr.memoryMb,
          memoryDeltaMb: enriched?.memoryDeltaMb ?? 0,
          restartCount: enriched?.restartCount ?? 0,
          processStatus: enriched?.healthStatus ?? pr.status,
        })
      }
    }

    const totalWorkspaces = wsMap.size
    const uniquePlugins = [...pluginCatalog.values()].map(p => ({
      pluginId: p.pluginId,
      pluginUniqueIdentifier: p.pluginUniqueIdentifier,
      version: p.version,
      source: p.source,
      installedWorkspacesCount: p.installedWorkspaces.size,
      totalWorkspacesCount: totalWorkspaces,
      runningPid: p.runningPid,
      cpuPercent: p.cpuPercent,
      memoryMb: p.memoryMb,
      memoryDeltaMb: p.memoryDeltaMb,
      restartCount: p.restartCount,
      processStatus: p.processStatus,
    })).sort((a, b) => (Number(b.memoryMb ?? -1) - Number(a.memoryMb ?? -1)) || (b.installedWorkspacesCount - a.installedWorkspacesCount))

    const workspaces = [...wsMap.values()].map(w => ({
      workspaceId: w.workspaceId,
      workspaceName: w.workspaceName,
      ownerAccount: w.ownerAccount,
      ownerName: w.ownerName,
      org: w.org,
      installedCount: w.installedPlugins.size,
    })).sort((a, b) => a.installedCount - b.installedCount)

    const tickets = store.all()
      .filter(r => r && r.kind === 'plugin-batch-ticket')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

    return json(res, {
      capturedAt: new Date(now).toISOString(),
      syncedAt: inv.syncedAt || null,
      daemon: procInfo,
      uniquePlugins,
      workspaces,
      tickets,
    })
  }

  check(req.method === 'POST' && (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host), 403, 'ACCESS_DENIED')
  const input = await body(req)
  const at = new Date(now).toISOString()

  if (path === '/api/plugin-governance/request') {
    check(isStaff, 403, 'ACCESS_DENIED', '仅运维人员或系统管理员可发起插件批量分发与进程管控工单')
    const operationType = String(input?.operationType ?? '').trim()
    const validOps = ['新户全量安装', '新插件全员推送', '新版本全员批量升级', '高危插件全员卸载', '重启插件服务进程']
    check(validOps.includes(operationType), 400, 'INVALID_OPERATION_TYPE')
    const targetWorkspaceId = String(input?.targetWorkspaceId ?? '').trim()
    const targetWorkspaceName = String(input?.targetWorkspaceName ?? '').trim()
    const targetPluginId = String(input?.targetPluginId ?? '').trim()
    const targetPluginUid = String(input?.targetPluginUid ?? '').trim()
    const newPluginUid = String(input?.newPluginUid ?? '').trim()
    const canaryWorkspaceId = String(input?.canaryWorkspaceId ?? '').trim()
    const canaryWorkspaceName = String(input?.canaryWorkspaceName ?? '').trim()
    const reason = String(input?.reason ?? '').trim()

    if (operationType === '新户全量安装') check(targetWorkspaceId, 400, 'WORKSPACE_REQUIRED', '请选择目标新租户工作区')
    if (['新插件全员推送', '新版本全员批量升级', '高危插件全员卸载'].includes(operationType)) check(targetPluginId, 400, 'PLUGIN_REQUIRED', '请选择目标插件')
    if (operationType === '新版本全员批量升级') check(newPluginUid.includes(':') && newPluginUid.includes('@'), 400, 'NEW_PLUGIN_UID_REQUIRED', '请填写新版本插件完整标识（如 author/name:1.1.0@sha256）')
    check(reason.length >= 2 && reason.length <= 1000, 400, 'INVALID_REASON', '请输入工单申请原因')

    const ticketNo = `PLG-05-${id().slice(0, 8)}`
    const ticket = store.put(`plugin-batch:${ticketNo}`, {
      kind: 'plugin-batch-ticket',
      ticketNo,
      operationType,
      targetWorkspaceId: targetWorkspaceId || null,
      targetWorkspaceName: targetWorkspaceName || null,
      targetPluginId: targetPluginId || null,
      targetPluginUid: targetPluginUid || null,
      newPluginUid: newPluginUid || null,
      canaryWorkspaceId: canaryWorkspaceId || null,
      canaryWorkspaceName: canaryWorkspaceName || null,
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

  if (path === '/api/plugin-governance/approve') {
    check(isStaff, 403, 'ACCESS_DENIED')
    const ticketNo = String(input?.ticketNo ?? '').trim()
    const decision = input?.decision === 'reject' ? 'reject' : 'approve'
    const reviewNote = String(input?.reviewNote ?? (decision === 'approve' ? '审批通过并已执行' : '驳回申请')).trim()

    const existing = store.get(`plugin-batch:${ticketNo}`)
    check(existing && existing.status === '待审批', 404, 'TICKET_NOT_PENDING', '该工单不存在或已办理')

    if (decision === 'reject') {
      const updated = store.put(`plugin-batch:${ticketNo}`, {
        ...existing,
        status: '已驳回',
        reviewedAt: at,
        reviewer: identity.account,
        reviewNote,
      })
      return json(res, {ok: true, ticket: updated})
    }

    const inv = subsystems?.getDifyInventory?.() ?? {plugins: [], apps: []}
    const {base, key} = getPluginDaemonEndpoint(subsystems)
    let executionSummary = ''

    if (existing.operationType === '重启插件服务进程') {
      const procInfo = await probePluginDaemonProcesses()
      check(procInfo.available && procInfo.containerId, 502, 'DAEMON_NOT_FOUND', '未检测到运行中的 plugin_daemon 容器')
      await dockerSocketRequest('POST', `/containers/${encodeURIComponent(procInfo.containerId)}/restart?t=15`, 30000)
      executionSummary = `已重启插件守护进程容器 ${procInfo.containerName}`
    } else if (existing.operationType === '新户全量安装') {
      // Collect all unique plugin UIDs already present in Dify
      const uidMap = new Map()
      for (const p of inv.plugins ?? []) {
        if (p.pluginId && p.pluginUniqueIdentifier && p.pluginUniqueIdentifier.includes('@')) {
          uidMap.set(p.pluginId, p.pluginUniqueIdentifier)
        }
      }
      const alreadyInstalled = new Set(
        (inv.plugins ?? []).filter(p => p.workspaceId === existing.targetWorkspaceId).map(p => p.pluginId),
      )
      let okCount = 0; let skipCount = 0; let failCount = 0
      for (const [pid, uid] of uidMap.entries()) {
        if (alreadyInstalled.has(pid)) { skipCount++; continue }
        try {
          const r = await callPluginDaemon(base, key, `/plugin/${encodeURIComponent(existing.targetWorkspaceId)}/management/install/identifiers`, {
            plugin_unique_identifiers: [uid],
            source: 'package',
            metas: [{}],
          })
          if (r.ok) okCount++; else failCount++
        } catch { failCount++ }
      }
      executionSummary = `向工作区 ${existing.targetWorkspaceName || existing.targetWorkspaceId} 批量安装：成功 ${okCount}、已装跳过 ${skipCount}、失败 ${failCount}`
    } else if (existing.operationType === '新插件全员推送') {
      const uid = existing.targetPluginUid
        || (inv.plugins ?? []).find(p => p.pluginId === existing.targetPluginId && p.pluginUniqueIdentifier?.includes('@'))?.pluginUniqueIdentifier
      check(uid, 409, 'PLUGIN_UID_MISSING', '未找到该插件的有效包体标识，请先同步 Dify 数据')
      const allWs = new Set()
      for (const p of directory.subjects()) if (p.difyWorkspaceId) allWs.add(p.difyWorkspaceId)
      for (const item of [...(inv.apps ?? []), ...(inv.plugins ?? [])]) if (item?.workspaceId) allWs.add(item.workspaceId)
      const installedWs = new Set(
        (inv.plugins ?? []).filter(p => p.pluginId === existing.targetPluginId).map(p => p.workspaceId),
      )
      let okCount = 0; let skipCount = 0; let failCount = 0
      for (const wsId of allWs) {
        if (installedWs.has(wsId)) { skipCount++; continue }
        try {
          const r = await callPluginDaemon(base, key, `/plugin/${encodeURIComponent(wsId)}/management/install/identifiers`, {
            plugin_unique_identifiers: [uid],
            source: 'package',
            metas: [{}],
          })
          if (r.ok) okCount++; else failCount++
        } catch { failCount++ }
      }
      executionSummary = `向全平台 ${allWs.size} 个工作区推送 ${existing.targetPluginId}：成功 ${okCount}、已装跳过 ${skipCount}、失败 ${failCount}`
    } else if (existing.operationType === '新版本全员批量升级') {
      const targets = (inv.plugins ?? []).filter(p =>
        p.pluginId === existing.targetPluginId
        && p.workspaceId
        && (!existing.canaryWorkspaceId || p.workspaceId === existing.canaryWorkspaceId),
      )
      let okCount = 0; let skipCount = 0; let failCount = 0
      for (const t of targets) {
        if (t.pluginUniqueIdentifier === existing.newPluginUid) { skipCount++; continue }
        try {
          const r = await callPluginDaemon(base, key, `/plugin/${encodeURIComponent(t.workspaceId)}/management/install/upgrade`, {
            original_plugin_unique_identifier: t.pluginUniqueIdentifier,
            new_plugin_unique_identifier: existing.newPluginUid,
            source: 'package',
            meta: {},
          })
          if (r.ok) okCount++; else failCount++
        } catch { failCount++ }
      }
      const scopeLabel = existing.canaryWorkspaceId ? `灰度工作区 ${existing.canaryWorkspaceName || existing.canaryWorkspaceId}` : `全平台 ${targets.length} 个已装工作区`
      executionSummary = `向${scopeLabel}批量升级 ${existing.targetPluginId} 至新版本：成功 ${okCount}、已最新跳过 ${skipCount}、失败 ${failCount}`
    } else if (existing.operationType === '高危插件全员卸载') {
      const targets = (inv.plugins ?? []).filter(p => p.pluginId === existing.targetPluginId && p.workspaceId && p.installationId)
      let okCount = 0; let failCount = 0
      for (const t of targets) {
        try {
          const r = await callPluginDaemon(base, key, `/plugin/${encodeURIComponent(t.workspaceId)}/management/uninstall`, {
            plugin_installation_id: t.installationId,
          })
          if (r.ok) okCount++; else failCount++
        } catch { failCount++ }
      }
      executionSummary = `从全平台 ${targets.length} 个已装实例卸载 ${existing.targetPluginId}：成功 ${okCount}、失败 ${failCount}`
    }

    // Best-effort refresh Dify inventory after batch execution
    if (subsystems?.refreshDifyInventory) {
      await subsystems.refreshDifyInventory().catch(() => {})
    }

    const updated = store.put(`plugin-batch:${ticketNo}`, {
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
