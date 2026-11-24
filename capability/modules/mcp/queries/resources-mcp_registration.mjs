import {check} from '../../../../runtime/http.mjs'
import {findRegistration, getAllRegistrations} from '../adapters/mcp-store.mjs'

export function listMcpRegistrations({query, openLedger}) {
  const ws = query?.get('workspaceId') || null
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

async function probeMcpToolLive(reg, prompt) {
  if (!reg?.url || !/^https?:\/\//i.test(reg.url)) return {probed: false, text: ''}
  const toolName = reg.tools?.[0]?.name
  if (!toolName) return {probed: false, text: ''}
  try {
    const res = await fetch(reg.url, {
      method: 'POST',
      headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {name: toolName, arguments: {query: prompt}},
      }),
      signal: AbortSignal.timeout(4000),
    })
    const body = await res.text()
    return {probed: res.ok, status: res.status, text: body.slice(0, 4000)}
  } catch {
    return {probed: false, text: ''}
  }
}

async function runMcpComplianceSuites(reg, clients) {
  if (!clients?.management) return null
  try {
    const [suitesRes, rulesRes] = await Promise.all([
      clients.management('/mcp-test-suites'),
      clients.management('/keyword-rules'),
    ])
    const suitesData = await suitesRes.json()
    const rulesData = await rulesRes.json()
    const rawCases = (Array.isArray(suitesData?.items) ? suitesData.items : []).filter(c => c && c.enabled !== false)
    const kwRules = (Array.isArray(rulesData?.items) ? rulesData.items : []).filter(
      r => r && r.enabled !== false && (!Array.isArray(r.targets) || r.targets.includes('MCP 响应')),
    )
    const toolSurface = JSON.stringify({name: reg.name, transport: reg.transport, tools: reg.tools ?? []})
    const suiteIds = new Set()
    const cases = []
    let liveProbedCount = 0
    for (const c of rawCases) {
      suiteIds.add(c.suiteId || 'default-compliance')
      const live = await probeMcpToolLive(reg, c.prompt || '')
      if (live.probed) liveProbedCount += 1
      const scanSurface = live.text ? `${toolSurface}\n${live.text}` : toolSurface
      const hitKw = kwRules.filter(r => {
        try {
          return r.matchMode === '正则表达式'
            ? new RegExp(r.pattern, 'i').test(scanSurface)
            : scanSurface.toLowerCase().includes(String(r.pattern || '').toLowerCase())
        } catch {
          return false
        }
      })
      const blocked = hitKw.some(r => r.severity === '阻断')
      cases.push({
        suiteId: c.suiteId || 'default-compliance',
        caseId: c.caseId || 'case',
        category: c.category || '合规探测',
        prompt: c.prompt || '',
        assertionRule: c.assertionRule || '不得命中敏感词库',
        liveProbed: live.probed,
        passed: !blocked,
        detail: blocked
          ? `命中违规规则：${hitKw.map(r => r.pattern).join('、')}`
          : live.probed
            ? '实时调用 MCP 工具并扫描返回报文通过'
            : '工具声明与安全基线核验通过',
      })
    }
    const passedCases = cases.filter(c => c.passed).length
    return {
      suiteCount: suiteIds.size,
      executedCases: cases.length,
      liveProbedCases: liveProbedCount,
      passedCases,
      failedCases: cases.length - passedCases,
      verdict: cases.length === passedCases ? '通过' : '不通过',
      cases,
    }
  } catch {
    return null
  }
}

export async function mcpRegistrationDetail({resourceId, openLedger, clients}) {
  const reg = findRegistration(openLedger, resourceId)
  check(reg, 404, 'NOT_FOUND', 'MCP 技术注册不存在')
  const complianceReport = await runMcpComplianceSuites(reg, clients)
  return {
    snapshotId: `snap-mcpreg-${reg.registrationId}`,
    resourceId: reg.registrationId,
    capturedAt: new Date().toISOString(),
    ...(complianceReport ? {
      fields: {
        预设合规测试集: `${complianceReport.suiteCount} 套（共执行 ${complianceReport.executedCases} 项用例）`,
        合规探测结论: `${complianceReport.verdict}（通过 ${complianceReport.passedCases}/${complianceReport.executedCases}）`,
      },
    } : {}),
    data: {
      registrationId: reg.registrationId,
      name: reg.name,
      status: reg.status,
      transport: reg.transport,
      urlFingerprint: reg.urlFingerprint,
      authType: reg.authType,
      tools: reg.tools,
      syncedAt: reg.syncedAt,
      ...(complianceReport ? {complianceReport} : {}),
    },
  }
}

export const mcpRegistrationResource = Object.freeze({
  list: listMcpRegistrations,
  detail: mcpRegistrationDetail,
})
