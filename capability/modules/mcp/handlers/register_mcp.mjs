import {check} from '../../../../runtime/http.mjs'
import {findRegistration, readMcpApprovedInput} from '../adapters/mcp-store.mjs'

export async function execute(context) {
  const {command, state, clients, openLedger} = context
  const approved = await readMcpApprovedInput(clients, command)
  const fields = approved?.fields ?? {}
  const registrationId = fields['技术注册ID'] || fields.registrationId
  check(typeof registrationId === 'string' && registrationId, 409, 'MISSING_MCP_REGISTRATION', '获准输入缺少技术注册 ID')

  let reg = findRegistration(openLedger, registrationId)
  if (!reg && fields['服务地址'] && fields['URL指纹']) {
    const directReg = {
      registrationId,
      name: fields['MCP名称'] || registrationId,
      status: 'registered',
      transport: fields['传输方式'] || 'streamable-http',
      endpointUrl: fields['服务地址'],
      urlFingerprint: fields['URL指纹'],
      authType: 'none',
      tools: Array.isArray(fields['工具清单']) ? fields['工具清单'] : [],
      syncedAt: new Date().toISOString(),
    }
    if (openLedger) {
      openLedger('mcp_registrations').put(registrationId, directReg)
    }
    reg = directReg
  }
  check(reg && ['active', 'registered'].includes(reg.status), 409, 'INCOMPLETE_MCP_REGISTRATION', '技术注册不可用')
  const frozenFingerprint = fields['URL指纹'] || fields.urlFingerprint
  if (frozenFingerprint) {
    check(reg.urlFingerprint === frozenFingerprint, 409, 'STALE_SNAPSHOT', 'MCP 技术注册 URL 指纹已变化')
  }

  const created = await (
    await clients.mcp('/mcps', 'POST', {
      resourceId: command.resourceId,
      name: fields['MCP名称'] || reg.name,
      transport: reg.transport,
      urlFingerprint: reg.urlFingerprint,
      toolNames: reg.tools.map(t => t.name),
      registrationId: reg.registrationId,
      bindingAccess: fields['绑定方式'] === '免审绑定' || fields.bindingAccess === 'instant' ? 'instant' : 'approval',
      ownerAccount: command.account,
    })
  ).json()

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: created.resourceId,
    version: String(created.revision),
    sha256: created.urlFingerprint,
    details: {
      resourceId: created.resourceId,
      registrationId: reg.registrationId,
      status: created.status,
      revision: created.revision,
    },
  }
}
