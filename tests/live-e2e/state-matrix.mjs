import {LIVE_BASE} from './helpers.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

export async function runStateMatrix(sessions, reporter) {
  const {user, ops, admin} = sessions

  // 1. RBAC Access Matrix: Role × Protected Endpoint -> Expected Status
  const rbacMatrix = [
    ['user', '/api/agent-monitor', 403],
    ['user', '/api/knowledge-monitor', 403],
    ['user', '/api/plugin-monitor', 403],
    ['user', '/api/skill-monitor', 403],
    ['user', '/api/governance-policy', 403],
    ['user', '/api/audit-report', 403],
    ['ops', '/api/agent-monitor', 200],
    ['ops', '/api/knowledge-monitor', 200],
    ['ops', '/api/skill-monitor?window=7d', 200],
    ['ops', '/api/compliance-reconcile', 200],
    ['ops', '/api/governance-policy', 200],
    ['admin', '/api/organizations', 200],
    ['admin', '/api/keyword-rules', 200],
    ['admin', '/api/subsystems', 200],
    ['admin', '/api/governance-policy', 200],
  ]

  await reporter.run('状态矩阵', 'RBAC 角色越权与访问权限矩阵（15组组合）', async () => {
    const mismatches = []
    for (const [roleKey, path, expected] of rbacMatrix) {
      const res = await sessions[roleKey].request.get(`${LIVE_BASE}${path}`)
      if (res.status() !== expected) {
        mismatches.push(`${roleKey} GET ${path}: 期望 ${expected} 实际 ${res.status()}`)
      }
    }
    assert(mismatches.length === 0, mismatches.join(' ; '))
    return `${rbacMatrix.length}/${rbacMatrix.length} 命中预期`
  })

  // 2. Admin-only approval endpoints MUST reject ops with 403
  await reporter.run('状态矩阵', '运维越权审批管理员配置/断流工单拦截（403）', async () => {
    const r1 = await ops.request.post(`${LIVE_BASE}/api/governance-policy/config/approve`, {
      data: {ticketNo: 'CFG-05-nonexistent', decision: 'approve'},
    })
    assert(r1.status() === 403, `ops 审批 CFG-05 期望 403，实际 ${r1.status()}`)

    const r2 = await ops.request.post(`${LIVE_BASE}/api/governance-policy/cutoff/approve`, {
      data: {ticketNo: 'SEC-01-nonexistent', decision: 'approve'},
    })
    assert(r2.status() === 403, `ops 审批 SEC-01 期望 403，实际 ${r2.status()}`)
    return 'CFG-05 & SEC-01 均严格拦截非管理员审批'
  })

  // 3. Default-OFF cutoff switch guard
  await reporter.run('状态矩阵', '断流总开关默认关闭时调用 SEC-01 严格阻断（403）', async () => {
    const gov = await (await ops.request.get(`${LIVE_BASE}/api/governance-policy`)).json()
    const sw = gov.policy?.cutoffSwitches
    if (sw?.enableWebAppCutoff) return '跳过（当前线上环境已显式开启 WebApp 断流开关）'
    const res = await ops.request.post(`${LIVE_BASE}/api/governance-policy/cutoff/request`, {
      data: {appId: 'dummy-app-id', action: 'pause_webapp', reason: '[E2E-MATRIX] 校验关闭阻断'},
    })
    const body = await res.json().catch(() => ({}))
    assert(res.status() === 403 && body?.error?.code === 'CUTOFF_SWITCH_DISABLED',
      `期望 403 CUTOFF_SWITCH_DISABLED，实际 ${res.status()} ${JSON.stringify(body)}`)
    return '403 CUTOFF_SWITCH_DISABLED'
  })

  // 4. MCP-01 invalid/unreachable endpoint probe guard
  await reporter.run('状态矩阵', 'MCP-01 直填不可达服务地址被协议探测拦截（422）', async () => {
    const res = await user.request.post(`${LIVE_BASE}/api/applications`, {
      data: {
        ticketNo: `MCP-01-matrix-${Date.now()}`,
        ticketType: 'MCP-01',
        resourceId: 'direct-matrix',
        fields: {
          name: '[E2E] 不可达测试服务',
          purpose: '矩阵测试',
          endpointUrl: 'http://127.0.0.1:19998/mcp',
          transport: 'streamable-http',
          authType: 'none',
          classification: '内部',
          businessLine: '刑侦',
          boundaryOrgs: ['刑侦一支队'],
        },
      },
    })
    const body = await res.json().catch(() => ({}))
    assert(res.status() === 422 && body?.error?.code === 'MCP_PROBE_FAILED',
      `期望 422 MCP_PROBE_FAILED，实际 ${res.status()} ${JSON.stringify(body)}`)
    return '422 MCP_PROBE_FAILED'
  })

  // 5. EVT-01 missing fields validation
  await reporter.run('状态矩阵', 'EVT-01 缺必填项拒绝受理（400）', async () => {
    const res = await user.request.post(`${LIVE_BASE}/api/events`, {
      data: {ticketNo: `EVT-01-matrix-${Date.now()}`, resourceId: '', objectType: '插件', facts: ''},
    })
    assert(res.status() === 400, `期望 400，实际 ${res.status()}`)
    return '400 INVALID_FIELDS'
  })

  // 6. Operator Skill Monitor global visibility equals Admin
  await reporter.run('状态矩阵', '运维人员与管理员在 Skill 监控指标口径一致', async () => {
    const sOps = await (await ops.request.get(`${LIVE_BASE}/api/skill-monitor?window=7d`)).json()
    const sAdm = await (await admin.request.get(`${LIVE_BASE}/api/skill-monitor?window=7d`)).json()
    assert(JSON.stringify(sOps.metrics) === JSON.stringify(sAdm.metrics),
      `运维与管理员 Skill 监控指标不一致: ops=${JSON.stringify(sOps.metrics)} adm=${JSON.stringify(sAdm.metrics)}`)
    return 'ops == admin metrics'
  })
}
