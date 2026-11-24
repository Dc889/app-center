import {spawn} from 'node:child_process'

const ONE_SHOT = new Set(['init_permissions', 'certbot'])

export function parseComposeLabels(text) {
  const map = {}
  if (typeof text !== 'string' || !text) return map
  for (const part of text.split(',')) {
    const index = part.indexOf('=')
    if (index > 0) map[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  }
  return map
}

export function classifyContainer(raw) {
  const labels = parseComposeLabels(raw.Labels)
  const service = labels['com.docker.compose.service'] || null
  const project = labels['com.docker.compose.project'] || null
  const name = String(raw.Names || '').replace(/^\//, '')
  const image = String(raw.Image || '')
  const state = String(raw.State || '').toLowerCase()
  const statusText = String(raw.Status || '')
  const exit = /Exited \((\d+)\)/.exec(statusText)
  const exitCode = exit ? Number(exit[1]) : null
  let status = '未采集'
  let restartable = false
  if (state === 'running' && /unhealthy/i.test(statusText)) {
    status = '不可用'
    restartable = true
  } else if (state === 'running' && /health: starting/i.test(statusText)) status = '启动中'
  else if (state === 'running') status = '运行中'
  else if (state === 'restarting') status = '重启中'
  else if (state === 'paused') status = '已暂停'
  else if ((state === 'exited' || state === 'dead') && exitCode === 0 && ONE_SHOT.has(service)) status = '已结束'
  else if (state === 'exited' || state === 'dead') {
    status = '不可用'
    restartable = true
  }
  return {
    containerId: String(raw.ID || raw.Id || '').toLowerCase(),
    containerName: name,
    image,
    service: service || name,
    project,
    status,
    restartable,
    detail: statusText,
  }
}

function productOf(item, difyProject, ragflowProject) {
  const blob = `${item.image} ${item.containerName} ${item.project || ''} ${item.service}`.toLowerCase()
  if (difyProject && item.project === difyProject) return 'Dify'
  if (ragflowProject && item.project === ragflowProject) return 'RAGFlow'
  if (/ragflow|infiniflow/.test(blob)) return 'RAGFlow'
  if (/dify|langgenius/.test(blob)) return 'Dify'
  return null
}

export function selectSubsystemServices(containers, env = process.env) {
  const difyProject = env.DIFY_COMPOSE_PROJECT || ''
  const ragflowProject = env.RAGFLOW_COMPOSE_PROJECT || ''
  const classified = containers.map(classifyContainer).filter(item => /^[a-f0-9]{12,64}$/.test(item.containerId))
  const projects = {Dify: new Set(), RAGFlow: new Set()}
  for (const item of classified) {
    const product = productOf(item, difyProject, ragflowProject)
    if (product && item.project) projects[product].add(item.project)
  }
  const services = []
  const seen = new Set()
  for (const item of classified) {
    let product = productOf(item, difyProject, ragflowProject)
    if (!product && item.project && projects.Dify.has(item.project) && !projects.RAGFlow.has(item.project)) product = 'Dify'
    if (!product && item.project && projects.RAGFlow.has(item.project) && !projects.Dify.has(item.project)) product = 'RAGFlow'
    if (difyProject && product === 'Dify' && item.project !== difyProject) product = null
    if (ragflowProject && product === 'RAGFlow' && item.project !== ragflowProject) product = null
    if (!product || seen.has(item.containerId)) continue
    seen.add(item.containerId)
    services.push({...item, product})
  }
  return services
}

export function parseDockerPs(text, env = process.env) {
  const containers = []
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    containers.push(JSON.parse(trimmed))
  }
  return selectSubsystemServices(containers, env)
}

export function parsePercent(value) {
  if (typeof value !== 'string') return null
  const matched = /^(-?\d+(?:\.\d+)?)%$/.exec(value.trim())
  if (!matched) return null
  const number = Number(matched[1])
  return Number.isFinite(number) ? number : null
}

export function parseDockerStats(text) {
  const byId = new Map()
  const byName = new Map()
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const row = JSON.parse(trimmed)
    const stat = {
      cpuPercent: parsePercent(row.CPUPerc),
      memory: typeof row.MemUsage === 'string' && row.MemUsage.trim() && !row.MemUsage.includes('--') ? row.MemUsage.trim() : null,
      memoryPercent: parsePercent(row.MemPerc),
      netIo: typeof row.NetIO === 'string' && row.NetIO.trim() && !row.NetIO.includes('--') ? row.NetIO.trim() : null,
      blockIo: typeof row.BlockIO === 'string' && row.BlockIO.trim() && !row.BlockIO.includes('--') ? row.BlockIO.trim() : null,
      pids: /^\d+$/.test(String(row.PIDs ?? '').trim()) ? Number(row.PIDs) : null,
    }
    const id = String(row.ID || row.Container || '').toLowerCase().replace(/^\//, '')
    const name = String(row.Name || '').replace(/^\//, '')
    if (id) byId.set(id.slice(0, 12), stat)
    if (name) byName.set(name, stat)
  }
  return {byId, byName}
}

export function attachDockerStats(services, stats) {
  return services.map(service => {
    const stat = stats.byId.get(service.containerId.slice(0, 12)) || stats.byName.get(service.containerName) || null
    return {
      ...service,
      cpuPercent: stat?.cpuPercent ?? null,
      memory: stat?.memory ?? null,
      memoryPercent: stat?.memoryPercent ?? null,
      netIo: stat?.netIo ?? null,
      blockIo: stat?.blockIo ?? null,
      pids: stat?.pids ?? null,
    }
  })
}

function dockerText(args, timeoutMs, timeoutCode) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {windowsHide: true})
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(timeoutCode))
    }, timeoutMs)
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { err += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || 'DOCKER_EXIT_' + code))
    })
  })
}

export function dockerPsText() {
  return dockerText(['ps', '-a', '--no-trunc', '--format', '{{json .}}'], 8000, 'DOCKER_TIMEOUT')
}

export function dockerStatsText() {
  return dockerText(['stats', '--no-stream', '--format', '{{json .}}'], 20000, 'DOCKER_STATS_TIMEOUT')
}

export async function probeSubsystemServices({run, stats} = {}) {
  try {
    const text = await (run ?? dockerPsText)()
    let services = parseDockerPs(text)
    const statsRunner = stats ?? (run ? null : dockerStatsText)
    if (statsRunner) {
      try {
        services = attachDockerStats(services, parseDockerStats(await statsRunner()))
      } catch {
        services = attachDockerStats(services, {byId: new Map(), byName: new Map()})
      }
    } else {
      services = attachDockerStats(services, {byId: new Map(), byName: new Map()})
    }
    return {availability: 'collected', reason: null, services}
  } catch {
    return {availability: 'not_collected', reason: 'Docker 未安装、未启动或当前进程没有权限', services: []}
  }
}

export function dockerRestart(containerId) {
  if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
    const error = new Error('容器标识不在本次巡检结果内')
    error.code = 'INVALID_CONTAINER'
    return Promise.reject(error)
  }
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['restart', '--time', '20', containerId], {windowsHide: true})
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      const error = new Error('重启超时')
      error.code = 'RESTART_TIMEOUT'
      reject(error)
    }, 30000)
    child.stderr.on('data', chunk => { err += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      error.code = error.code || 'RESTART_FAILED'
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve({ok: true})
      else {
        const error = new Error(err.trim() || '重启失败')
        error.code = 'RESTART_FAILED'
        reject(error)
      }
    })
  })
}
