import {check} from '../../../../runtime/http.mjs'
import {createBinding, findRegistration, readMcpApprovedInput} from '../adapters/mcp-store.mjs'
import {bindMcpToDifyWorkspace} from '../adapters/dify-mcp.mjs'

export async function execute(context) {
  const {command, state, clients, openLedger} = context
  const {workspaceId, startsAt, expiresAt, expectedUrlFingerprint} = command.payload
  const startMs = Date.parse(startsAt)
  const endMs = Date.parse(expiresAt)
  check(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs, 400, 'INVALID_TIME_RANGE')

  const item = await (await clients.mcp('/mcps/' + encodeURIComponent(command.resourceId))).json()
  check(item.status === 'active', 409, 'MCP_UNAVAILABLE', '当前 MCP 状态不允许新增绑定')
  check(item.urlFingerprint === expectedUrlFingerprint, 409, 'STALE_SNAPSHOT', 'MCP 地址指纹已变化，请重新申请')

  const approved = command.payload?.decisionRef ? await readMcpApprovedInput(clients, command) : null
  const targetAppId = approved?.fields?.['目标应用ID'] || approved?.fields?.targetAppId || command.payload?.targetAppId || ''

  const reg = item.registrationId ? findRegistration(openLedger, item.registrationId) : null
  const serverUrl = item.endpoint || item.serverUrl || reg?.endpoint || reg?.serverUrl || ''
  const providerKey = item.provider || `mcp-${item.resourceId}`
  const difySync = await bindMcpToDifyWorkspace({
    account: command.account,
    serverUrl,
    name: item.name || reg?.name || item.resourceId,
    serverIdentifier: providerKey,
  })

  const db = openLedger('bindings')
  const binding = createBinding(db, {
    resourceId: item.resourceId,
    account: command.account,
    workspaceId,
    providerId: providerKey,
    difyProviderId: difySync.difyProviderId || '',
    serverIdentifier: difySync.serverIdentifier || '',
    targetAppId,
    startsAt,
    expiresAt,
  })

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: binding.bindingId,
    version: String(item.revision),
    sha256: item.urlFingerprint,
    details: {
      bindingId: binding.bindingId,
      workspaceId: binding.workspaceId,
      targetAppId: binding.targetAppId,
      difySynced: difySync.synced,
      difyProviderId: difySync.difyProviderId || '',
      status: '已绑定',
    },
  }
}
