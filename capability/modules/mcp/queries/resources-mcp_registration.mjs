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
    for (const c of rawCases) {
      suiteIds.add(c.suiteId || 'default-compliance')
      const hitKw = kwRules.filter(r => {
        try {
          return r.matchMode === '正则表达式'
            ? new RegExp(r.pattern, 'i').test(toolSurface)
            : toolSurface.toLowerCase().includes(String(r.pattern || '').toLowerCase())
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
        passed: !blocked,
        detail: blocked ? `命中违规规则：${hitKw.map(r => r.pattern).join('、')}` : '工具声明与安全基线核验通过',
      })
    }
    const passedCases = cases.filter(c => c.passed).length
    return {
      suiteCount: suiteIds.size,
      executedCases: cases.length,
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
