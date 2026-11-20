import {check} from '../../../runtime/http.mjs'
import {execute as install} from './handlers/install.mjs'
import {listCatalog, catalogItem} from './queries/legacy-catalog.mjs'
import {resources as plugin} from './queries/resources-plugin.mjs'
import {installed} from './adapters/dify-install.mjs'

function validateInstallPayload(payload) {
  const keys = ['version', 'sha256', 'workspaceId']
  check(
    Object.keys(payload).length === keys.length &&
      keys.every(k => typeof payload[k] === 'string' && payload[k]) &&
      /^[a-f0-9]{64}$/.test(payload.sha256),
    400,
    'INVALID_REQUEST',
  )
}

async function reconcileInstall({row, store, stamp}) {
  if (!row.productTask) return
  if (await installed(row.productTask)) {
    row.state.status = 'succeeded'
    row.state.updatedAt = stamp()
    row.state.result = {
      ok: true,
      failureCode: '',
      failureReason: '',
      retryable: false,
      resultId: row.productTask.pluginUniqueIdentifier,
      version: row.command.payload.version,
      sha256: row.command.payload.sha256,
      details: row.productTask,
    }
    store.put(row.command.executionId, row)
  }
}

export const capabilityModule = Object.freeze({
  id: 'plugins',
  actions: [
    {ticketType: 'PLG-01', ticketTypeVersion: '1', action: 'publish_package', variants: [null]},
    {ticketType: 'PLG-02', ticketTypeVersion: '1', action: 'revise_package', variants: [null]},
    {
      ticketType: 'PLG-03',
      ticketTypeVersion: '1',
      action: 'install',
      variants: [null],
      execute: install,
      validatePayload: validateInstallPayload,
      reconcile: reconcileInstall,
    },
    {ticketType: 'PLG-03', ticketTypeVersion: '1', action: 'upgrade', variants: [null]},
    {ticketType: 'PLG-03', ticketTypeVersion: '1', action: 'uninstall', variants: [null]},
    {ticketType: 'PLG-04', ticketTypeVersion: '1', action: 'disable_plugin', variants: [null]},
    {ticketType: 'PLG-04', ticketTypeVersion: '1', action: 'restore_plugin', variants: [null]},
  ],
  resources: {plugin},
  catalogs: {plugin: {list: listCatalog, detail: catalogItem}},
  routes: [],
  reconcile: reconcileInstall,
})

export {installPlugin, installed} from './adapters/dify-install.mjs'
