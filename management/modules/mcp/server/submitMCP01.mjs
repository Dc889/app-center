import {createHash} from 'node:crypto'
import {mcpRegistration} from './mcp-registration.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'

async function probeDirectMcpEndpoint(endpointUrl, name, transport, authType) {
  const url = String(endpointUrl ?? '').trim()
  check(/^https?:\/\/[^\s]+$/i.test(url), 400, 'INVALID_MCP_URL', '请输入有效的 http:// 或 https:// MCP 服务地址')
  const urlFingerprint = createHash('sha256').update(url).digest('hex')
  const started = Date.now()
  let tools = []
  let probeStatus = '健康'
  let httpStatus = 200
  let probeError = ''
  try {
    const initRes = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'app-center-mcp01', version: '1.0'}},
      }),
      signal: AbortSignal.timeout(8000),
    })
    httpStatus = initRes.status
    check(initRes.status >= 200 && initRes.status < 500, 422, 'MCP_PROBE_FAILED', `MCP 连通性测试失败（HTTP ${initRes.status}）`)
    const toolsRes = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream'},
      body: JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}}),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null)
    if (toolsRes?.ok) {
      const text = await toolsRes.text()
      let parsed = null
      try { parsed = JSON.parse(text) } catch {
        const dataLine = text.split('\n').find(l => l.startsWith('data:'))
        if (dataLine) try { parsed = JSON.parse(dataLine.slice(5).trim()) } catch {}
      }
      const rawTools = parsed?.result?.tools ?? parsed?.tools ?? []
      if (Array.isArray(rawTools)) {
        tools = rawTools.filter(t => t && typeof t.name === 'string').map(t => ({
          name: t.name,
          description: typeof t.description === 'string' ? t.description : '',
          inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : {type: 'object', properties: {}},
        }))
      }
    }
  } catch (err) {
    if (err?.status) throw err
    probeStatus = '不可达'
    probeError = err?.message || '连接超时或被拒绝'
    check(false, 422, 'MCP_PROBE_FAILED', `MCP 服务不可达：${probeError}`)
  }
  const latencyMs = Date.now() - started
  const registrationId = 'mcp-reg-' + urlFingerprint.slice(0, 12)
  const syncedAt = new Date().toISOString()
  return {
    snapshotId: 'mcp-direct-' + id(),
    resourceId: registrationId,
    capturedAt: syncedAt,
    data: {
      registrationId,
      name: name || registrationId,
      status: 'registered',
      endpointUrl: url,
      transport: transport || 'streamable-http',
      urlFingerprint,
      authType: authType || 'none',
      tools,
      syncedAt,
      complianceReport: {
        probeStatus,
        httpStatus,
        latencyMs,
        toolCount: tools.length,
        checkedAt: syncedAt,
      },
    },
  }
}

// Injected services retain the owning transaction and identity snapshot.
export async function submitMCP01(services) {
  const {accounts,actor,applications,at,cap,headersFor,identity,input,owns,save,send,submission,types,version}=services;

      const endpointUrl = String(input.fields?.endpointUrl ?? '').trim()
      const snapshot = endpointUrl
        ? await probeDirectMcpEndpoint(endpointUrl, input.fields?.name, input.fields?.transport, input.fields?.authType)
        : await mcpRegistration(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),input.resourceId)
      const effectiveRegId = snapshot.data.registrationId
      check(types.activeVersion(input.ticketType)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      const catalogId='mcp-'+id()
      return send(save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'MCP-01',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission:{...submission,resourceId:effectiveRegId},snapshot,catalogId,policySourceResourceId:catalogId,status:'待受理',revision:1,
        preconditions:[{kind:'mcp',id:catalogId,revision:0},{kind:'mcp_registration',id:effectiveRegId,sha256:snapshot.data.urlFingerprint}],
        history:[{at,actor,action:'提交MCP上架登记'}]}),201)
    

}
