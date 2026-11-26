import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {writeFileSync, unlinkSync, chmodSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {body, check, id, json} from '../../../../runtime/http.mjs'
import {dockerRestart, probeSubsystemServices} from './service-probe.mjs'

const DEFAULT_DIFY_API_SCRIPT = `# Dify 应用层有序重启（通过本机 Docker Engine API 执行，无需依赖 compose 版本）
# 每行定义一个重启分层（按顺序逐层重启并等待容器就绪，不动数据库与 Redis）
layer: sandbox,plugin_daemon
layer: api,worker,worker_beat
layer: web
layer: nginx`

const DEFAULT_DIFY_SSH_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

# 请由系统管理员根据现场 Dify 部署目录修改以下路径
COMPOSE_DIR="/data/dify/docker"
cd "$COMPOSE_DIR"

# 自动兼容 docker compose (v2) 与 docker-compose (v1)
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "[ERROR] 目标服务器未检测到 docker compose 或 docker-compose" >&2
  exit 1
fi

echo "[INFO] 检测到编排命令: $COMPOSE_CMD"
echo "[INFO] 1/4 检查底层依赖 (db/redis/weaviate/ssrf_proxy)..."
$COMPOSE_CMD up -d db redis weaviate ssrf_proxy

echo "[INFO] 2/4 重启沙箱与插件守护进程..."
$COMPOSE_CMD restart sandbox plugin_daemon || true
sleep 3

echo "[INFO] 3/4 重启核心业务服务 (api/worker/worker_beat)..."
$COMPOSE_CMD restart api worker worker_beat || true
sleep 5

echo "[INFO] 4/4 重启前端与入口网关 (web/nginx)..."
$COMPOSE_CMD restart web nginx || true

# 若管理平台跨网络挂载了 docker_default，自动确保桥接完好
docker network connect docker_default app-center-management 2>/dev/null || true
echo "[INFO] Dify 有序重启完成"
`

const DEFAULT_RAGFLOW_API_SCRIPT = `# RAGFlow 应用层有序重启（通过本机 Docker Engine API 执行）
layer: ragflow-server
layer: nginx`

function computeScriptHash(rec) {
  const payload = JSON.stringify({
    product: rec.product || '',
    execMode: rec.execMode || 'docker-api',
    sshHost: rec.sshHost || '',
    sshPort: Number(rec.sshPort || 22),
    sshUser: rec.sshUser || '',
    scriptContent: String(rec.scriptContent || '').replace(/\r\n/g, '\n'),
  })
  return createHash('sha256').update(payload).digest('hex')
}

function sanitizeScript(rec) {
  if (!rec) return null
  const {sshPassword, sshPrivateKey, ...pub} = rec
  return {
    ...pub,
    hasSshSecret: Boolean(sshPassword || sshPrivateKey),
    sshAuthType: sshPrivateKey ? 'key' : 'password',
  }
}

export function ensureDefaultScripts(store, nowIso) {
  const existing = store.all().filter(r => r && r.kind === 'service-restart-script')
  if (existing.length > 0) return existing
  const seeds = [
    {
      kind: 'service-restart-script',
      scriptId: 'dify-app-ordered',
      name: 'Dify 应用层有序重启',
      product: 'Dify',
      execMode: 'docker-api',
      description: '按 sandbox/plugin_daemon → api/worker → web → nginx 顺序逐层重启，不动数据库与 Redis，天然兼容任意 Compose 版本',
      scriptContent: DEFAULT_DIFY_API_SCRIPT,
      sshHost: '',
      sshPort: 22,
      sshUser: 'root',
      sshPassword: '',
      sshPrivateKey: '',
      enabled: true,
      autoHealEnabled: false,
      failThreshold: 3,
      cooldownMinutes: 10,
      maxAutoPerHour: 2,
      version: 1,
      updatedBy: 'system',
      updatedByName: '系统预置',
      updatedAt: nowIso,
    },
    {
      kind: 'service-restart-script',
      scriptId: 'dify-compose-ssh',
      name: 'Dify 目标机 Compose 固定脚本',
      product: 'Dify',
      execMode: 'ssh-shell',
      description: '通过 SSH 登录子系统部署服务器执行管理员固定 Shell 脚本，自动兼容 docker compose 与 docker-compose，强制人工审批',
      scriptContent: DEFAULT_DIFY_SSH_SCRIPT,
      sshHost: '192.168.0.7',
      sshPort: 22,
      sshUser: 'root',
      sshPassword: '',
      sshPrivateKey: '',
      enabled: true,
      autoHealEnabled: false,
      failThreshold: 3,
      cooldownMinutes: 15,
      maxAutoPerHour: 1,
      version: 1,
      updatedBy: 'system',
      updatedByName: '系统预置',
      updatedAt: nowIso,
    },
    {
      kind: 'service-restart-script',
      scriptId: 'ragflow-app-ordered',
      name: 'RAGFlow 应用层有序重启',
      product: 'RAGFlow',
      execMode: 'docker-api',
      description: '通过 Docker Engine API 按顺序重启 RAGFlow 应用层与入口服务',
      scriptContent: DEFAULT_RAGFLOW_API_SCRIPT,
      sshHost: '',
      sshPort: 22,
      sshUser: 'root',
      sshPassword: '',
      sshPrivateKey: '',
      enabled: true,
      autoHealEnabled: false,
      failThreshold: 3,
      cooldownMinutes: 10,
      maxAutoPerHour: 2,
      version: 1,
      updatedBy: 'system',
      updatedByName: '系统预置',
      updatedAt: nowIso,
    },
  ]
  return seeds.map(s => {
    const withHash = {...s, scriptHash: computeScriptHash(s)}
    return store.put(`svc-script:${s.scriptId}`, withHash)
  })
}

function parseLayers(scriptContent, product) {
  const layers = []
  for (const rawLine of String(scriptContent || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^layer\s*:\s*(.+)$/i.exec(line)
    if (match) {
      const names = match[1].split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
      if (names.length > 0) layers.push(names)
    }
  }
  if (layers.length > 0) return layers
  if (product === 'Dify') {
    return [['sandbox', 'plugin_daemon'], ['api', 'worker', 'worker_beat'], ['web'], ['nginx']]
  }
  return [['ragflow-server'], ['nginx']]
}

async function waitForRunning(product, containerIds, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const probe = await probeSubsystemServices()
    const map = new Map((probe.services || []).filter(s => s.product === product).map(s => [s.containerId, s]))
    const allReady = containerIds.every(cid => {
      const s = map.get(cid)
      return s && (s.status === '运行中' || s.status === '启动中')
    })
    if (allReady) return true
    await new Promise(r => setTimeout(r, 1500))
  }
  return false
}

async function runDockerApiScript(script, targetContainer) {
  const started = Date.now()
  const logs = []
  const probe = await probeSubsystemServices()
  if (probe.availability !== 'collected') {
    return {
      ok: false,
      exitCode: 1,
      durationMs: Date.now() - started,
      log: `[ERROR] 无法连接 Docker Daemon: ${probe.reason || '未采集'}`,
      recheckSummary: 'Docker 探测不可用',
    }
  }
  const productServices = (probe.services || []).filter(s => s.product === script.product)
  if (productServices.length === 0) {
    return {
      ok: false,
      exitCode: 1,
      durationMs: Date.now() - started,
      log: `[ERROR] 未在宿主机发现 ${script.product} 的纳管容器`,
      recheckSummary: `未发现 ${script.product} 容器`,
    }
  }

  let planLayers
  if (targetContainer) {
    const hit = productServices.find(s => s.containerName === targetContainer || s.service === targetContainer)
    if (!hit) {
      return {
        ok: false,
        exitCode: 1,
        durationMs: Date.now() - started,
        log: `[ERROR] 目标容器 ${targetContainer} 不在 ${script.product} 纳管白名单中`,
        recheckSummary: '目标容器不在白名单',
      }
    }
    planLayers = [[hit.service.toLowerCase()]]
    // If restarting api or web, also gently restart nginx last to avoid stale upstream 502
    if (['api', 'web'].includes(hit.service.toLowerCase()) && productServices.some(s => s.service.toLowerCase() === 'nginx')) {
      planLayers.push(['nginx'])
    }
    logs.push(`[INFO] 单容器定点重启模式：目标 ${hit.containerName} (${hit.service})`)
  } else {
    planLayers = parseLayers(script.scriptContent, script.product)
    logs.push(`[INFO] 按固定脚本「${script.name} v${script.version}」执行 ${planLayers.length} 层有序重启`)
  }

  let totalRestarted = 0
  let failures = 0
  for (let i = 0; i < planLayers.length; i++) {
    const layerNames = planLayers[i]
    const matched = productServices.filter(s => layerNames.includes(String(s.service || '').toLowerCase()) || layerNames.includes(String(s.containerName || '').toLowerCase()))
    if (matched.length === 0) {
      logs.push(`[Layer ${i + 1}/${planLayers.length}] 跳过（未匹配容器: ${layerNames.join(', ')}）`)
      continue
    }
    logs.push(`[Layer ${i + 1}/${planLayers.length}] 开始重启: ${matched.map(m => m.containerName).join(', ')}`)
    const restartedIds = []
    for (const svc of matched) {
      const t0 = Date.now()
      try {
        await dockerRestart(svc.containerId)
        restartedIds.push(svc.containerId)
        totalRestarted += 1
        logs.push(`  ✓ ${svc.containerName} 重启指令成功 (${Date.now() - t0}ms)`)
      } catch (err) {
        failures += 1
        logs.push(`  ✗ ${svc.containerName} 重启失败: ${err?.message || err}`)
      }
    }
    if (restartedIds.length > 0 && i < planLayers.length - 1) {
      const ready = await waitForRunning(script.product, restartedIds, 18000)
      logs.push(`  → 本层就绪检查: ${ready ? '全部已运行' : '等待超时，继续下一层'}`)
    }
  }

  // Post-restart health recheck
  const after = await probeSubsystemServices()
  const afterProduct = (after.services || []).filter(s => s.product === script.product)
  const runningCount = afterProduct.filter(s => s.status === '运行中').length
  const unavailableCount = afterProduct.filter(s => s.status === '不可用').length
  const recheckSummary = `${script.product} 复检：运行中 ${runningCount} / 不可用 ${unavailableCount}（本次重启 ${totalRestarted} 个容器）`
  logs.push(`[RECHECK] ${recheckSummary}`)

  const ok = failures === 0 && totalRestarted > 0
  return {
    ok,
    exitCode: ok ? 0 : 1,
    durationMs: Date.now() - started,
    log: logs.join('\n').slice(0, 16000),
    recheckSummary,
  }
}

async function runSshShellScript(script) {
  const started = Date.now()
  const host = String(script.sshHost || '').trim()
  const port = Number(script.sshPort || 22)
  const user = String(script.sshUser || 'root').trim()
  if (!host) {
    return {ok: false, exitCode: 1, durationMs: 0, log: '[ERROR] 未配置目标服务器 SSH 主机地址', recheckSummary: '缺少 SSH 主机配置'}
  }
  if (!script.sshPassword && !script.sshPrivateKey) {
    return {ok: false, exitCode: 1, durationMs: 0, log: '[ERROR] 未配置 SSH 登录密码或私钥，请由系统管理员在固定脚本中补充认证信息', recheckSummary: '缺少 SSH 认证信息'}
  }

  const normalizedScript = String(script.scriptContent || '').replace(/\r\n/g, '\n')
  let keyFilePath = null
  try {
    let cmd = 'ssh'
    let args = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=10',
      '-p', String(port),
    ]
    const env = {...process.env}
    if (script.sshPrivateKey) {
      keyFilePath = join(tmpdir(), `svc-key-${id().slice(0, 10)}.pem`)
      writeFileSync(keyFilePath, String(script.sshPrivateKey).replace(/\r\n/g, '\n') + '\n', {mode: 0o600})
      try { chmodSync(keyFilePath, 0o600) } catch {}
      args.push('-i', keyFilePath, `${user}@${host}`, 'bash -s')
    } else {
      cmd = 'sshpass'
      env.SSHPASS = String(script.sshPassword)
      args = ['-e', 'ssh', ...args, `${user}@${host}`, 'bash -s']
    }

    const result = await new Promise(resolve => {
      const child = spawn(cmd, args, {env, windowsHide: true})
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        resolve({code: 124, out, err: err + '\n[ERROR] 脚本执行超时（超过 120 秒）'})
      }, 120000)
      child.stdout.on('data', c => { if (out.length < 16000) out += c.toString() })
      child.stderr.on('data', c => { if (err.length < 16000) err += c.toString() })
      child.on('error', e => {
        clearTimeout(timer)
        resolve({code: 127, out, err: err + `\n[ERROR] 启动 SSH 失败: ${e.message}`})
      })
      child.on('close', code => {
        clearTimeout(timer)
        resolve({code: code ?? 1, out, err})
      })
      child.stdin.write(normalizedScript + '\n')
      child.stdin.end()
    })

    const combined = [result.out.trim(), result.err.trim()].filter(Boolean).join('\n').slice(0, 16000)
    const after = await probeSubsystemServices()
    const afterProduct = (after.services || []).filter(s => s.product === script.product)
    const recheckSummary = after.availability === 'collected' && afterProduct.length > 0
      ? `${script.product} 复检：运行中 ${afterProduct.filter(s => s.status === '运行中').length} / 不可用 ${afterProduct.filter(s => s.status === '不可用').length}`
      : `远端脚本退出码 ${result.code}`
    return {
      ok: result.code === 0,
      exitCode: result.code,
      durationMs: Date.now() - started,
      log: combined || '(无输出)',
      recheckSummary,
    }
  } finally {
    if (keyFilePath) {
      try { unlinkSync(keyFilePath) } catch {}
    }
  }
}

export async function executeFixedRestartScript({script, targetContainer = null}) {
  if (script.execMode === 'ssh-shell') {
    return runSshShellScript(script)
  }
  return runDockerApiScript(script, targetContainer)
}

// Background auto-heal engine with debounce, cooldown, circuit breaker & unified SVC-01 ticket trail
const failStreakMap = new Map()
const lastAutoHealAtMap = new Map()

export async function monitorSubsystemAutoHeal({directory, events, now = Date.now}) {
  const store = directory?.store
  if (!store) return {checked: false}
  const nowMs = now()
  const at = new Date(nowMs).toISOString()
  const scripts = ensureDefaultScripts(store, at)

  const probe = await probeSubsystemServices()
  if (probe.availability !== 'collected') return {checked: false, reason: probe.reason}

  const products = ['Dify', 'RAGFlow']
  const actions = []
  for (const product of products) {
    const svcs = (probe.services || []).filter(s => s.product === product)
    if (svcs.length === 0) continue
    const broken = svcs.filter(s => s.status === '不可用' && s.restartable)
    if (broken.length === 0) {
      failStreakMap.set(product, 0)
      continue
    }

    const streak = (failStreakMap.get(product) ?? 0) + 1
    failStreakMap.set(product, streak)

    // Find an enabled script for this product with autoHealEnabled === true
    const autoScript = scripts.find(s => s.product === product && s.enabled && s.autoHealEnabled)
    if (!autoScript) continue

    const threshold = Math.max(1, Number(autoScript.failThreshold || 3))
    if (streak < threshold) continue

    const cooldownMs = Math.max(1, Number(autoScript.cooldownMinutes || 10)) * 60 * 1000
    const lastAt = lastAutoHealAtMap.get(product) ?? 0
    if (nowMs - lastAt < cooldownMs) continue

    // Circuit breaker: count SVC-01 auto-heal tickets for this product in the last 60 minutes
    const oneHourAgo = nowMs - 60 * 60 * 1000
    const recentAutoTickets = store.all().filter(r =>
      r && r.kind === 'svc-restart-ticket' &&
      r.product === product &&
      r.triggerSource === '系统自动自愈' &&
      new Date(r.createdAt || 0).getTime() >= oneHourAgo
    )
    const maxPerHour = Math.max(1, Number(autoScript.maxAutoPerHour || 2))

    if (recentAutoTickets.length >= maxPerHour) {
      // Circuit breaker tripped -> stop auto restart & raise high-severity EVT-01 alert
      const breakerId = `EVT-01-SRV-BREAKER-${product}-${Math.floor(nowMs / (60 * 60 * 1000))}`
      if (events && !events.get(breakerId)) {
        events.put(breakerId, {
          ticketNo: breakerId,
          account: 'system_event',
          org: '系统服务',
          resourceId: `${product}:auto-heal`,
          facts: `纳管子系统 ${product} 在 1 小时内已自动自愈 ${recentAutoTickets.length} 次仍存在不可用容器（${broken.map(b => b.containerName).join(', ')}），已触发自动熔断停止重启，请运维立即人工介入排查根因`,
          objectType: '服务',
          creationMode: '系统告警',
          alertId: `AL-SRV-BREAKER-${product}`,
          ruleCode: 'SERVICE_AUTOHEAL_CIRCUIT_OPEN',
          originalSeverity: '紧急',
          firstOccurredAt: at,
          lastOccurredAt: at,
          status: '未研判',
          version: '1',
          revision: 1,
          history: [{at, actor: 'system_event', action: '子系统自愈触发熔断升级紧急告警', fromStatus: null, toStatus: '未研判'}],
        })
      }
      continue
    }

    // Trigger unified SVC-01 work order as system actor!
    lastAutoHealAtMap.set(product, nowMs)
    failStreakMap.set(product, 0)
    const ticketNo = `SVC-01-AUTO-${id().slice(0, 8)}`
    const baseTicket = store.put(`svc-restart:${ticketNo}`, {
      kind: 'svc-restart-ticket',
      ticketNo,
      product,
      targetContainer: null,
      scriptId: autoScript.scriptId,
      scriptName: autoScript.name,
      scriptVersion: autoScript.version,
      scriptHash: autoScript.scriptHash,
      execMode: autoScript.execMode,
      triggerSource: '系统自动自愈',
      applicant: 'system',
      applicantName: '系统（自动监控）',
      org: '系统服务',
      reason: `连续 ${streak} 次巡检发现不可用容器：${broken.map(b => `${b.containerName}(${b.detail || '不可用'})`).join('、')}，命中自愈策略自动执行固定脚本`,
      status: '执行中',
      approvalMode: '自动审批',
      reviewer: 'system',
      reviewerName: '系统（自愈策略放行）',
      reviewNote: `符合自愈策略（连续失败 ${threshold} 次触发，近 1 小时第 ${recentAutoTickets.length + 1}/${maxPerHour} 次）`,
      createdAt: at,
      reviewedAt: at,
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      executionLog: null,
      recheckSummary: null,
    })

    const execRes = await executeFixedRestartScript({script: autoScript})
    const finishedAt = new Date(now()).toISOString()
    const saved = store.put(`svc-restart:${ticketNo}`, {
      ...baseTicket,
      status: execRes.ok ? '已完成' : '执行失败',
      finishedAt,
      durationMs: execRes.durationMs,
      exitCode: execRes.exitCode,
      executionLog: execRes.log,
      recheckSummary: execRes.recheckSummary,
    })
    actions.push({ticketNo: saved.ticketNo, product, status: saved.status})
  }
  return {checked: true, actions}
}

export async function routeServiceRestart(services) {
  const {directory, hasRole, identity, options, path, req, res} = services
  check(identity?.active && (hasRole(identity, 'admin') || hasRole(identity, 'operator')), 403, 'ACCESS_DENIED')
  const now = (options.now ?? Date.now)()
  const at = new Date(now).toISOString()
  const store = directory.store
  const isAdmin = hasRole(identity, 'admin')

  ensureDefaultScripts(store, at)

  if (req.method === 'GET' && path === '/api/service-restart') {
    const scripts = store.all()
      .filter(r => r && r.kind === 'service-restart-script')
      .map(sanitizeScript)
      .sort((a, b) => String(a.product).localeCompare(String(b.product)) || String(a.scriptId).localeCompare(String(b.scriptId)))
    const tickets = store.all()
      .filter(r => r && r.kind === 'svc-restart-ticket')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    return json(res, {
      canEditScripts: isAdmin,
      canApprove: isAdmin,
      scripts,
      tickets,
    })
  }

  check(req.method === 'POST' && (!req.headers.origin || new URL(req.headers.origin).host === req.headers.host), 403, 'ACCESS_DENIED')
  const input = await body(req)

  // 1. Admin-only: create or update fixed restart script
  if (path === '/api/service-restart/scripts') {
    check(isAdmin, 403, 'ADMIN_ONLY', '仅系统管理员可编辑和保存固定重启脚本')
    const scriptId = String(input?.scriptId ?? '').trim() || `script-${id().slice(0, 8)}`
    const name = String(input?.name ?? '').trim()
    const product = String(input?.product ?? 'Dify').trim()
    const execMode = input?.execMode === 'ssh-shell' ? 'ssh-shell' : 'docker-api'
    const description = String(input?.description ?? '').trim()
    const scriptContent = String(input?.scriptContent ?? '').replace(/\r\n/g, '\n').trim()

    check(name.length >= 2 && name.length <= 80, 400, 'INVALID_NAME', '请输入 2～80 字的脚本名称')
    check(['Dify', 'RAGFlow'].includes(product), 400, 'INVALID_PRODUCT', '目标子系统仅支持 Dify 或 RAGFlow')
    check(scriptContent.length >= 4 && scriptContent.length <= 20000, 400, 'INVALID_SCRIPT', '固定脚本内容不能为空')

    const existing = store.get(`svc-script:${scriptId}`)
    const sshHost = String(input?.sshHost ?? existing?.sshHost ?? '').trim()
    const sshPort = Math.max(1, Math.min(65535, Number(input?.sshPort ?? existing?.sshPort ?? 22)))
    const sshUser = String(input?.sshUser ?? existing?.sshUser ?? 'root').trim()
    const sshPassword = input?.sshPassword ? String(input.sshPassword) : (existing?.sshPassword || '')
    const sshPrivateKey = input?.sshPrivateKey ? String(input.sshPrivateKey) : (existing?.sshPrivateKey || '')
    const enabled = input?.enabled !== false
    const autoHealEnabled = Boolean(input?.autoHealEnabled)
    const failThreshold = Math.max(1, Math.min(20, Number(input?.failThreshold ?? existing?.failThreshold ?? 3)))
    const cooldownMinutes = Math.max(1, Math.min(180, Number(input?.cooldownMinutes ?? existing?.cooldownMinutes ?? 10)))
    const maxAutoPerHour = Math.max(1, Math.min(6, Number(input?.maxAutoPerHour ?? existing?.maxAutoPerHour ?? 2)))

    const nextRecord = {
      kind: 'service-restart-script',
      scriptId,
      name,
      product,
      execMode,
      description,
      scriptContent,
      sshHost,
      sshPort,
      sshUser,
      sshPassword,
      sshPrivateKey,
      enabled,
      autoHealEnabled,
      failThreshold,
      cooldownMinutes,
      maxAutoPerHour,
      version: existing ? Number(existing.version || 1) + 1 : 1,
      updatedBy: identity.account,
      updatedByName: identity.name || identity.account,
      updatedAt: at,
    }
    nextRecord.scriptHash = computeScriptHash(nextRecord)
    const saved = store.put(`svc-script:${scriptId}`, nextRecord)
    return json(res, {ok: true, script: sanitizeScript(saved)})
  }

  // 2. Manual SVC-01 ticket submission (operator or admin selects a fixed script, read-only)
  if (path === '/api/service-restart/request') {
    const scriptId = String(input?.scriptId ?? '').trim()
    const targetContainer = String(input?.targetContainer ?? '').trim() || null
    const reason = String(input?.reason ?? '').trim()
    const script = store.get(`svc-script:${scriptId}`)
    check(script && script.enabled, 404, 'SCRIPT_NOT_FOUND', '所选固定脚本不存在或已停用')
    check(reason.length >= 2 && reason.length <= 1000, 400, 'INVALID_REASON', '请输入重启申请原因')

    const ticketNo = `SVC-01-${id().slice(0, 8)}`
    const ticket = store.put(`svc-restart:${ticketNo}`, {
      kind: 'svc-restart-ticket',
      ticketNo,
      product: script.product,
      targetContainer,
      scriptId: script.scriptId,
      scriptName: script.name,
      scriptVersion: script.version,
      scriptHash: script.scriptHash,
      execMode: script.execMode,
      triggerSource: '人工发起',
      applicant: identity.account,
      applicantName: identity.name || identity.account,
      org: identity.org || '平台运营组',
      reason,
      status: '待审批',
      approvalMode: '人工审批',
      reviewer: null,
      reviewerName: null,
      reviewNote: null,
      createdAt: at,
      reviewedAt: null,
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      executionLog: null,
      recheckSummary: null,
    })
    return json(res, {ok: true, ticket}, 201)
  }

  // 3. Admin approves or rejects a pending SVC-01 ticket & executes locked fixed script
  if (path === '/api/service-restart/approve') {
    check(isAdmin, 403, 'ADMIN_ONLY', '仅系统管理员可审批执行服务重启工单')
    const ticketNo = String(input?.ticketNo ?? '').trim()
    const decision = input?.decision === 'reject' ? 'reject' : 'approve'
    const reviewNote = String(input?.reviewNote ?? (decision === 'approve' ? '审批通过并执行固定脚本' : '驳回重启申请')).trim()
    const existing = store.get(`svc-restart:${ticketNo}`)
    check(existing && existing.status === '待审批', 404, 'TICKET_NOT_PENDING', '该工单不存在或已办理')

    if (decision === 'reject') {
      const updated = store.put(`svc-restart:${ticketNo}`, {
        ...existing,
        status: '已驳回',
        reviewer: identity.account,
        reviewerName: identity.name || identity.account,
        reviewNote,
        reviewedAt: at,
        finishedAt: at,
      })
      return json(res, {ok: true, ticket: updated})
    }

    const script = store.get(`svc-script:${existing.scriptId}`)
    check(script && script.enabled, 409, 'SCRIPT_UNAVAILABLE', '关联固定脚本已停用或被删除，无法执行')
    check(script.scriptHash === existing.scriptHash, 409, 'SCRIPT_HASH_MISMATCH', '固定脚本在工单提交后已被修改（哈希不一致），请重新提交工单确认后再执行')

    const running = store.put(`svc-restart:${ticketNo}`, {
      ...existing,
      status: '执行中',
      reviewer: identity.account,
      reviewerName: identity.name || identity.account,
      reviewNote,
      reviewedAt: at,
    })

    const execRes = await executeFixedRestartScript({script, targetContainer: existing.targetContainer})
    const finishedAt = new Date((options.now ?? Date.now)()).toISOString()
    const saved = store.put(`svc-restart:${ticketNo}`, {
      ...running,
      status: execRes.ok ? '已完成' : '执行失败',
      finishedAt,
      durationMs: execRes.durationMs,
      exitCode: execRes.exitCode,
      executionLog: execRes.log,
      recheckSummary: execRes.recheckSummary,
    })
    return json(res, {ok: true, ticket: saved})
  }

  check(false, 405, 'METHOD_NOT_ALLOWED')
}
