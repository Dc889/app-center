import test from 'node:test'
import assert from 'node:assert/strict'
import {attachDockerStats, parseDockerStats, parsePercent} from '../../server/service-probe.mjs'
import {cpuPercent, memoryUsage, parseDiskText, summarizeDisks} from '../../server/host-resources.mjs'

test('Docker stats 解析 CPU、内存、网络和磁盘 IO，缺失不用 0 代替', () => {
  const text = [
    JSON.stringify({ID: 'abc123def456', Name: 'dify171-nginx-1', CPUPerc: '1.25%', MemUsage: '20MiB / 1GiB', MemPerc: '2.00%', NetIO: '1kB / 2kB', BlockIO: '3kB / 4kB', PIDs: '7'}),
    JSON.stringify({ID: 'fff111222333', Name: 'stopped', CPUPerc: '--', MemUsage: '-- / --', MemPerc: '--', NetIO: '--', BlockIO: '--', PIDs: '--'}),
  ].join('\n')
  const stats = parseDockerStats(text)
  const [running, stopped] = attachDockerStats([
    {containerId: 'abc123def4567890', containerName: 'dify171-nginx-1'},
    {containerId: 'fff111222333aaaa', containerName: 'stopped'},
  ], stats)
  assert.equal(parsePercent('1.25%'), 1.25)
  assert.equal(parsePercent('--'), null)
  assert.equal(running.cpuPercent, 1.25)
  assert.equal(running.memory, '20MiB / 1GiB')
  assert.equal(running.memoryPercent, 2)
  assert.equal(running.netIo, '1kB / 2kB')
  assert.equal(running.blockIo, '3kB / 4kB')
  assert.equal(running.pids, 7)
  assert.equal(stopped.cpuPercent, null)
  assert.equal(stopped.memory, null)
  assert.equal(stopped.pids, null)
})

test('部署服务器 CPU、内存和磁盘按采样与卷容量汇总', () => {
  const before = [{times: {user: 10, nice: 0, sys: 5, idle: 85, irq: 0}}]
  const after = [{times: {user: 20, nice: 0, sys: 10, idle: 165, irq: 5}}]
  assert.equal(cpuPercent(before, after), 20)
  assert.deepEqual(memoryUsage(1000, 250), {usedBytes: 750, totalBytes: 1000, percent: 75})
  const disks = summarizeDisks(parseDiskText(JSON.stringify([{Size: 2000, FreeSpace: 500}, {Size: 1000, FreeSpace: 1000}])))
  assert.equal(disks.totalBytes, 3000)
  assert.equal(disks.usedBytes, 1500)
  assert.equal(disks.percent, 50)
})
