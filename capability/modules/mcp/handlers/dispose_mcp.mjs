import {check} from '../../../../runtime/http.mjs'
import {deactivateBindings, readMcpApprovedInput} from '../adapters/mcp-store.mjs'
import {unbindMcpFromDifyWorkspace} from '../adapters/dify-mcp.mjs'

export async function execute(context) {
  const {command, state, clients, openLedger} = context
  const approved = await readMcpApprovedInput(clients, command)
  const fields = approved?.fields ?? {}
  const precondition = approved?.preconditions?.find(p => p && p.kind === 'mcp' && p.id === command.resourceId)
  const expectedRevision = precondition?.revision

  const item = await (await clients.mcp('/mcps/' + encodeURIComponent(command.resourceId))).json()
  if (expectedRevision !== undefined && expectedRevision !== null) {
    check(item.revision === expectedRevision, 409, 'STALE_SNAPSHOT', 'MCP 目录修订已变化')
  }

  const frozenBindings = Array.isArray(fields['绑定清单']) ? fields['绑定清单'] : []
  const db = openLedger('bindings')
  const deactivated = deactivateBindings(db, item.resourceId, frozenBindings)
  const unboundCount = deactivated.length

  let difyRemovedCount = 0
  for (const row of deactivated) {
    const res = await unbindMcpFromDifyWorkspace({
      account: row.account,
      difyProviderId: row.difyProviderId || '',
      serverIdentifier: row.serverIdentifier || row.providerId || '',
    }).catch(() => ({removed: false}))
    if (res?.removed) difyRemovedCount++
  }

  let nextStatus = item.status
  let nextRevision = item.revision
  if (command.action === 'isolate_mcp' || command.action === 'withdraw_mcp') {
    const targetStatus = command.action === 'isolate_mcp' ? 'isolated' : 'withdrawn'
    const updated = await (
      await clients.mcp('/mcps/' + encodeURIComponent(item.resourceId) + '/status', 'POST', {
        status: targetStatus,
        expectedRevision: item.revision,
      })
    ).json()
    nextStatus = updated.status
    nextRevision = updated.revision
  }

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: item.resourceId,
    version: String(nextRevision),
    sha256: item.urlFingerprint,
    details: {
      resourceId: item.resourceId,
      action: command.action,
      unboundCount,
      difyRemovedCount,
      status: nextStatus,
      revision: nextRevision,
    },
  }
}
