import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {resolve} from 'node:path'
import {writeFileSync} from 'node:fs'
import {liveProducts, readLocalProducts} from './live-verification/products.mjs'
import {buildLivePlugin} from './live-verification/plugin-package.mjs'
import {inspectPluginArchive} from '../capability/modules/plugins/adapters/package-archive.mjs'

const dir = resolve(process.env.APP_DATA_DIR ?? '.local-data')
const products = liveProducts({dir, credentials: readLocalProducts(resolve(dir, 'local-products.json'))})
const name = `capfin_${randomUUID().slice(0, 8)}`
const report = {runId: products.runId, generatedAt: new Date().toISOString(), pluginName: name, checks: [], ok: false}
let uniqueIdentifier, taskId, installationId
const save = () => writeFileSync(resolve(dir, 'live-plugin-native-report.json'), JSON.stringify(report, null, 2) + '\n')
try {
  const bytes = buildLivePlugin(name, '1.0.0')
  const metadata = inspectPluginArchive(bytes)
  assert.equal(metadata.uniqueIdentifier, `appcenter/${name}`)
  writeFileSync(resolve(dir, `${name}-1.0.0.difypkg`), bytes)
  const form = new FormData(); form.append('pkg', new Blob([bytes]), `${name}.difypkg`)
  const upload = await products.api('dify', '/console/api/workspaces/current/plugin/upload/pkg', {method: 'POST', body: form})
  uniqueIdentifier = upload.unique_identifier
  assert.ok(typeof uniqueIdentifier === 'string' && uniqueIdentifier.startsWith(`appcenter/${name}:1.0.0@`))
  report.uniqueIdentifier = uniqueIdentifier
  report.checks.push({name: 'actual difypkg metadata and native Dify upload validation', ok: true}); save()
  const accepted = await products.api('dify', '/console/api/workspaces/current/plugin/install/pkg', {method: 'POST', body: {plugin_unique_identifiers: [uniqueIdentifier]}})
  taskId = accepted.task_id; report.taskId = taskId; save()
  const deadline = Date.now() + 300000
  for (;;) {
    const list = await products.api('dify', '/console/api/workspaces/current/plugin/list?page=1&page_size=100')
    const found = list.plugins.find(item => item.plugin_unique_identifier === uniqueIdentifier)
    if (found) {
      installationId = found.id; assert.ok(installationId)
      report.installationState = 'installed'
      report.installationId = installationId
      report.checks.push({name: 'native installation and actual product instance ID readback', ok: true, fieldNames: Object.keys(found)})
      break
    }
    if (taskId) {
      const state = await products.api('dify', `/console/api/workspaces/current/plugin/tasks/${taskId}`)
      report.lastTaskStatus = state.status ?? state.task?.status ?? 'unknown'
      report.taskFieldNames = Object.keys(state)
      if (['failed', 'failure'].includes(report.lastTaskStatus)) throw new Error('Native plugin install task failed')
    }
    save()
    if (Date.now() >= deadline) {report.pendingInstallTask = true; throw new Error('Native plugin installation still pending; retain resource journal for followup')}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  report.ok = true
} catch (error) {report.error = {message: error.code === 'ERR_ASSERTION' ? 'Native plugin protocol assertion failed' : error.message, status: error.status}}
finally {
  if (uniqueIdentifier) {
    try {
      const list = await products.api('dify', '/console/api/workspaces/current/plugin/list?page=1&page_size=100')
      const own = list.plugins.find(item => item.plugin_unique_identifier === uniqueIdentifier)
      if (own) {
        const result = await products.api('dify', '/console/api/workspaces/current/plugin/uninstall', {method: 'POST', body: {plugin_installation_id: own.id}})
        assert.equal(result.success, true)
      }
      const after = await products.api('dify', '/console/api/workspaces/current/plugin/list?page=1&page_size=100')
      report.cleanupOk = !report.pendingInstallTask && !after.plugins.some(item => item.plugin_unique_identifier === uniqueIdentifier)
      if (report.cleanupOk && installationId) report.installationState = 'installed_then_uninstalled'
    } catch {report.cleanupOk = false}
  } else report.cleanupOk = true
  report.finishedAt = new Date().toISOString(); save()
}
console.log(`Native plugin checks ${report.checks.length}/2; status ${report.installationState ?? report.lastTaskStatus ?? 'not-started'}; cleanup ${report.cleanupOk ? 'PASS' : 'FAIL'}; ${report.ok ? 'PASS' : 'FAIL'}`)
if (!report.ok) {console.error(report.error?.message); process.exitCode = 1}
