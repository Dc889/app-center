import {check} from '../../../runtime/http.mjs'
import {execute as register_mcp} from './handlers/register_mcp.mjs'
import {execute as bind} from './handlers/bind.mjs'
import {execute as dispose_mcp} from './handlers/dispose_mcp.mjs'
import {listCatalog, catalogItem} from './queries/legacy-catalog.mjs'
import {mcpRegistrationResource} from './queries/resources-mcp_registration.mjs'
import {bindingContext, mcp03Context} from './queries/execution-contexts.mjs'

function validateBindPayload(payload) {
  check(
    ['workspaceId', 'startsAt', 'expiresAt', 'expectedUrlFingerprint'].every(
      k => typeof payload[k] === 'string' && payload[k],
    ),
    400,
    'INVALID_REQUEST',
  )
}

export const capabilityModule = Object.freeze({
  id: 'mcp',
  actions: [
    {ticketType: 'MCP-01', ticketTypeVersion: '1', action: 'register_mcp', variants: [null], execute: register_mcp},
    {
      ticketType: 'MCP-02',
      ticketTypeVersion: '1',
      action: 'bind',
      variants: [null],
      execute: bind,
      validatePayload: validateBindPayload,
    },
    {ticketType: 'MCP-03', ticketTypeVersion: '1', action: 'unbind_mcp', variants: [null], execute: dispose_mcp},
    {ticketType: 'MCP-03', ticketTypeVersion: '1', action: 'isolate_mcp', variants: [null], execute: dispose_mcp},
    {ticketType: 'MCP-03', ticketTypeVersion: '1', action: 'withdraw_mcp', variants: [null], execute: dispose_mcp},
  ],
  resources: {mcp_registration: mcpRegistrationResource},
  catalogs: {mcp: {list: listCatalog, detail: catalogItem}},
  routes: [
    {method: 'GET', path: '/internal/v1/binding-contexts/:resourceId', handle: bindingContext},
    {method: 'GET', path: '/internal/v1/execution-contexts/MCP-03', handle: mcp03Context},
  ],
})
