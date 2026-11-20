import {syncDifyApp} from '../adapters/syncDifyApp.mjs'
import {readAgentApprovedInput, saveSyncedApp} from '../adapters/agent-store.mjs'

export async function execute(context) {
  const {command, state, clients, openLedger} = context
  const appInfo = await syncDifyApp(command)
  const approved = await readAgentApprovedInput(clients, command)
  const workspaceId = approved?.fields?.['Dify workspace ID'] || approved?.fields?.workspaceId || command.payload?.workspaceId || 'ws-default'

  let revision = 1
  if (openLedger) {
    const saved = saveSyncedApp(openLedger, {
      resourceId: appInfo.appId,
      name: appInfo.name,
      workspaceId,
      mode: appInfo.mode,
      ownerAccount: command.account,
    })
    revision = saved.revision
  }

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: appInfo.appId,
    version: `v1.0.${revision}`,
    sha256: '',
    details: {
      appId: appInfo.appId,
      name: appInfo.name,
      workspaceId,
      revision,
      status: '已纳管',
    },
  }
}
