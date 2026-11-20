import {check} from '../../../runtime/http.mjs'
import {execute as install} from './handlers/install.mjs'
import {execute as publish_package} from './handlers/publish_package.mjs'
import {execute as revise_package} from './handlers/revise_package.mjs'
import {execute as upgrade, reconcileUpgrade} from './handlers/upgrade.mjs'
import {execute as uninstall} from './handlers/uninstall.mjs'
import {execute as safety_plugin} from './handlers/safety_plugin.mjs'
import {catalogItem, catalogVersions, listCatalog} from './queries/catalog.mjs'
import {getPluginIntake, uploadPluginIntake} from './queries/intake.mjs'
import {plg02Context, plg03Candidates, plg03Context, plg04Context} from './queries/execution-contexts.mjs'
import {resources as plugin} from './queries/resources-plugin.mjs'
import {installed} from './adapters/dify-install.mjs'
import {upsertInstallation} from './adapters/installations-store.mjs'

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

async function reconcileInstall({row, store, stamp, openLedger}) {
  if (!row.productTask) return
  if (await installed(row.productTask)) {
    let installationId = row.productTask.pluginUniqueIdentifier
    if (openLedger) {
      const saved = upsertInstallation(openLedger('installations'), {
        resourceId: row.command.resourceId,
        workspaceId: row.productTask.workspaceId || row.command.payload.workspaceId,
        version: row.command.payload.version,
        sha256: row.command.payload.sha256,
        uniqueIdentifier: row.productTask.pluginUniqueIdentifier,
        account: row.command.account,
        status: '已启用',
      })
      installationId = saved.installationId
    }
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
      details: {...row.productTask, installationId},
    }
    store.put(row.command.executionId, row)
  }
}

export const capabilityModule = Object.freeze({
  id: 'plugins',
  actions: [
    {ticketType: 'PLG-01', ticketTypeVersion: '1', action: 'publish_package', variants: [null], execute: publish_package},
    {ticketType: 'PLG-02', ticketTypeVersion: '1', action: 'revise_package', variants: [null], execute: revise_package},
    {
      ticketType: 'PLG-03',
      ticketTypeVersion: '1',
      action: 'install',
      variants: [null],
      execute: install,
      validatePayload: validateInstallPayload,
      reconcile: reconcileInstall,
    },
    {ticketType: 'PLG-03', ticketTypeVersion: '1', action: 'upgrade', variants: [null], execute: upgrade, reconcile: reconcileUpgrade},
    {ticketType: 'PLG-03', ticketTypeVersion: '1', action: 'uninstall', variants: [null], execute: uninstall},
    {ticketType: 'PLG-04', ticketTypeVersion: '1', action: 'disable_plugin', variants: [null], execute: safety_plugin},
    {ticketType: 'PLG-04', ticketTypeVersion: '1', action: 'restore_plugin', variants: [null], execute: safety_plugin},
  ],
  resources: {plugin},
  catalogs: {plugin: {list: listCatalog, detail: catalogItem, versions: catalogVersions}},
  routes: [
    {method: 'POST', path: '/internal/v1/intake/plugin', handle: uploadPluginIntake},
    {method: 'GET', path: '/internal/v1/intake/plugin/:intakeId', handle: getPluginIntake},
    {method: 'GET', path: '/internal/v1/execution-contexts/PLG-02', handle: plg02Context},
    {method: 'GET', path: '/internal/v1/execution-contexts/PLG-03/candidates', handle: plg03Candidates},
    {method: 'GET', path: '/internal/v1/execution-contexts/PLG-03', handle: plg03Context},
    {method: 'GET', path: '/internal/v1/execution-contexts/PLG-04', handle: plg04Context},
  ],
  reconcile: reconcileInstall,
})

export {installPlugin, installed} from './adapters/dify-install.mjs'
