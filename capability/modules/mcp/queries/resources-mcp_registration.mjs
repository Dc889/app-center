import {check} from '../../../../runtime/http.mjs'
import {findRegistration, getAllRegistrations} from '../adapters/mcp-store.mjs'

export function listMcpRegistrations({query, openLedger}) {
  const ws = query?.get('workspaceId') || 'ws-default'
  const q = (query?.get('q') ?? '').trim().toLowerCase()
  const items = getAllRegistrations(openLedger)
    .filter(r => ['active', 'registered'].includes(r.status))
    .map(r => ({
      resourceId: r.registrationId,
      name: r.name,
      source: r.source || 'mcp',
      workspaceId: ws,
    }))
    .filter(r => !q || (r.name + r.resourceId).toLowerCase().includes(q))
  return {items, nextCursor: null}
}

export function mcpRegistrationDetail({resourceId, openLedger}) {
  const reg = findRegistration(openLedger, resourceId)
  check(reg, 404, 'NOT_FOUND', 'MCP 技术注册不存在')
  return {
    snapshotId: `snap-mcpreg-${reg.registrationId}`,
    resourceId: reg.registrationId,
    capturedAt: new Date().toISOString(),
    data: {
      registrationId: reg.registrationId,
      name: reg.name,
      status: reg.status,
      transport: reg.transport,
      urlFingerprint: reg.urlFingerprint,
      authType: reg.authType,
      tools: reg.tools,
      syncedAt: reg.syncedAt,
    },
  }
}

export const mcpRegistrationResource = Object.freeze({
  list: listMcpRegistrations,
  detail: mcpRegistrationDetail,
})
