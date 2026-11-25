import {cpus, freemem, hostname, platform, totalmem} from 'node:os'
import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import http from 'node:http'

export function cpuPercent(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || !after.length) return null
  let idle = 0
  let total = 0
  for (let index = 0; index < after.length; index++) {
    const next = after[index]?.times
    const previous = before[index]?.times
    if (!next || !previous) continue
    const idleDiff = next.idle - previous.idle
    const totalDiff = ['user', 'nice', 'sys', 'idle', 'irq'].reduce((sum, key) => sum + (next[key] - previous[key]), 0)
    idle += idleDiff
    total += totalDiff
  }
  if (total <= 0) return null
  return Math.round((1 - idle / total) * 1000) / 10
}

export function memoryUsage(total = totalmem(), free = freemem()) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free) || free < 0) return null
  const used = Math.max(0, total - free)
  return {usedBytes: used, totalBytes: total, percent: Math.round(used / total * 1000) / 10}
}

function asBytes(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export function summarizeDisks(disks) {
  let total = 0
  let usedTotal = 0
  let count = 0
  for (const disk of disks ?? []) {
    const size = asBytes(disk.size ?? disk.Size)
    if (size === null || size <= 0) continue
    const explicitUsed = asBytes(disk.used ?? disk.Used)
    const freeBytes = asBytes(disk.free ?? disk.FreeSpace ?? disk.avail)
    let used = null
    if (explicitUsed !== null) used = Math.min(explicitUsed, size)
    else if (freeBytes !== null) used = Math.max(0, size - Math.min(freeBytes, size))
    if (used === null) continue
    total += size
    usedTotal += used
    count += 1
  }
  if (!count || total <= 0) return null
  return {usedBytes: usedTotal, totalBytes: total, percent: Math.round(usedTotal / total * 1000) / 10, volumes: count}
}

export function parseDiskText(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return []
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed)
    return (Array.isArray(parsed) ? parsed : [parsed]).map(row => ({size: row.Size ?? row.size, free: row.FreeSpace ?? row.free}))
  }
  const seenDevices = new Set()
  const blockDisks = []
  let rootOverlay = null
  for (const line of trimmed.split(/\r?\n/).slice(1)) {
    const cells = line.trim().split(/\s+/)
    if (cells.length < 5) continue
    const device = cells[0]
    const target = cells.at(-1) ?? ''
    if (target.startsWith('/dev') || target.startsWith('/sys') || target.startsWith('/proc') || target.startsWith('/run')) continue
    if (/^(tmpfs|devtmpfs|shm|efivarfs|proc|sysfs|cgroup|cgroup2|squashfs)$/.test(device)) continue
    const size = Number(cells[1]) * 1024
    const used = Number(cells[2]) * 1024
    const free = Number(cells[3]) * 1024
    if (!Number.isFinite(size) || size <= 0) continue
    if (device === 'overlay') {
      if (target === '/' && !rootOverlay) rootOverlay = {size, used, free}
      continue
    }
    if (seenDevices.has(device)) continue
    seenDevices.add(device)
    blockDisks.push({size, used, free})
  }
  // Inside a container, `/` is an overlay mount backed by the host's root/docker disk.
  // Include it only if its capacity differs from all already-counted block devices (avoiding single-disk double-count).
  if (rootOverlay && !blockDisks.some(d => d.size === rootOverlay.size)) {
    blockDisks.push(rootOverlay)
  }
  return blockDisks
}

function readDockerHostName(socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock', timeoutMs = 2000) {
  if (platform() === 'win32' || !existsSync(socketPath)) return Promise.resolve(null)
  return new Promise(resolve => {
    const req = http.request({socketPath, path: '/info', method: 'GET'}, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          const name = typeof parsed?.Name === 'string' && parsed.Name.trim() ? parsed.Name.trim() : null
          resolve(name)
        } catch {
          resolve(null)
        }
      })
    })
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
    req.end()
  })
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {windowsHide: true})
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('DISK_TIMEOUT'))
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
      else reject(new Error(err.trim() || 'DISK_EXIT_' + code))
    })
  })
}

export function readDiskText() {
  if (platform() === 'win32') {
    return runCommand('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object Size,FreeSpace | ConvertTo-Json -Compress'], 8000)
  }
  return runCommand('df', ['-kP'], 8000)
}

export async function probeHostResources({sampleMs = 200, diskText} = {}) {
  const before = cpus()
  await new Promise(resolve => setTimeout(resolve, sampleMs))
  const cpu = cpuPercent(before, cpus())
  const memory = memoryUsage()
  let storage = null
  try {
    storage = summarizeDisks(parseDiskText(diskText ?? await readDiskText()))
  } catch {
    storage = null
  }
  const collected = cpu !== null || memory !== null || storage !== null
  const hostName = (await readDockerHostName()) || hostname()
  return {
    availability: collected ? 'collected' : 'not_collected',
    hostname: hostName,
    cpuPercent: cpu,
    memory,
    storage,
  }
}
