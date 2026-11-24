import {check} from '../../../../runtime/http.mjs'
export async function mcpRegistration(cap,headers,registrationId) {
  const raw=await(await cap('/resources/mcp_registration/'+encodeURIComponent(registrationId),'GET',undefined,headers)).json()
  const d=raw.data
  check(raw.resourceId===registrationId && typeof raw.snapshotId==='string' && raw.snapshotId && d &&
    d.registrationId===registrationId && ['active','registered'].includes(d.status) &&
    typeof d.transport==='string' && d.transport && /^[a-f0-9]{64}$/.test(d.urlFingerprint) &&
    typeof d.authType==='string' && Array.isArray(d.tools) &&
    d.tools.every(t=>typeof t.name==='string' && t.name && typeof t.description==='string' &&
      t.inputSchema && typeof t.inputSchema==='object') && Number.isFinite(Date.parse(d.syncedAt)),
    409,'INCOMPLETE_MCP_REGISTRATION')
  return {snapshotId:raw.snapshotId,resourceId:registrationId,capturedAt:raw.capturedAt,
    ...(raw.fields ? {fields:raw.fields} : {}),
    data:{
      registrationId:d.registrationId,name:d.name,status:d.status,transport:d.transport,urlFingerprint:d.urlFingerprint,
      authType:d.authType,tools:d.tools,syncedAt:d.syncedAt,
      ...(d.complianceReport ? {complianceReport:d.complianceReport} : {})}}
}
