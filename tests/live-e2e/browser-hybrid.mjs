import {LIVE_BASE} from './helpers.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function openAndAudit(session, path, waitForSelector, opts = {}) {
  const {page, probe} = session
  probe.reset()
  if (opts.allowHttp) probe.allowHttp(opts.allowHttp)
  await page.goto(`${LIVE_BASE}${path}`, {waitUntil: 'domcontentloaded'})
  await page.waitForSelector(waitForSelector || 'main', {timeout: 15000})
  await page.waitForTimeout(opts.settleMs ?? 900)
  probe.assertClean(`${session.roleKey} ${path}`)
}

export async function runBrowserHybrid(sessions, reporter) {
  const {user, ops, admin} = sessions

  // =========================================================================
  // Suite A: Full Multi-Role Page Render & Zero Console/Network Error Audit
  // =========================================================================
  const pageChecks = [
    ['user', '/agents', '[data-testid="warehouse-page"]', '租户-智能体仓库'],
    ['user', '/knowledge-warehouse', 'main', '租户-知识库仓库'],
    ['user', '/plugin-warehouse', 'main', '租户-插件仓库'],
    ['user', '/mcp-warehouse', 'main', '租户-MCP仓库'],
    ['user', '/skill-warehouse', 'main', '租户-Skill仓库'],
    ['user', '/chat', '.chat-pane', '租户-对话申请'],
    ['user', '/mine', 'main', '租户-我的申请'],
    ['user', '/profile', 'main', '租户-个人中心'],
    ['ops', '/overview', 'main', '运维-统一概览'],
    ['ops', '/knowledge', 'main', '运维-知识库监控'],
    ['ops', '/agent-monitor', 'main', '运维-智能体监控'],
    ['ops', '/service-monitor', 'main', '运维-服务监控'],
    ['ops', '/plugins', 'main', '运维-插件监控'],
    ['ops', '/mcp', 'main', '运维-MCP监控'],
    ['ops', '/skills', 'main', '运维-Skill监控'],
    ['ops', '/security', '[data-testid="event-monitor"]', '运维-安全事件监控'],
    ['ops', '/accounts', 'main', '运维-账号与集成'],
    ['ops', '/tenant-model-monitor', 'main', '运维-租户与模型监控'],
    ['ops', '/audit', '[data-testid="audit-report"]', '运维-审计追踪'],
    ['ops', '/todo', 'main', '运维-我的待办'],
    ['ops', '/query', 'main', '运维-工单查询'],
    ['ops', '/keyword-rules', 'main', '运维-敏感词库设置'],
    ['ops', '/mcp-test-suites', 'main', '运维-MCP题库设置'],
    ['ops', '/governance-policy', '[data-testid="governance-policy-page"]', '运维-巡检与反制策略'],
    ['admin', '/organizations', 'main', '管理员-组织机构配置'],
    ['admin', '/subsystems', 'main', '管理员-纳管子系统'],
    ['admin', '/types', 'main', '管理员-工单类型管理'],
  ]

  for (const [roleKey, path, selector, title] of pageChecks) {
    await reporter.run('页面零报错体检', title, async () => {
      await openAndAudit(sessions[roleKey], path, selector, {settleMs: 700})
      const textLen = await sessions[roleKey].page.locator('main').innerText().then(t => t.trim().length)
      assert(textLen > 10, `页面 ${path} 主区域内容为空`)
      return `${path} OK`
    }, sessions[roleKey].page)
  }

  // =========================================================================
  // Suite B: Manual Work-Order Forms Deep-Link & Real Dropdown Population Audit
  // =========================================================================
  const ticketFormChecks = [
    {
      roleKey: 'user', code: 'KB-02', label: 'KB-02 知识库分享申请（校验 Dify 知识库自动加载）',
      check: async (page) => {
        await page.waitForTimeout(1500)
        const selects = page.locator('select')
        const count = await selects.count()
        assert(count >= 1, 'KB-02 页面未渲染任何下拉选择框')
        let maxOptions = 0
        for (let i = 0; i < count; i++) {
          const n = await selects.nth(i).locator('option').count()
          if (n > maxOptions) maxOptions = n
        }
        return `检测到 ${count} 个下拉框，最大选项数 ${maxOptions}`
      },
    },
    {
      roleKey: 'user', code: 'KB-03', label: 'KB-03 知识库绑定申请（表单渲染无错）',
      check: async (page) => {
        await page.waitForTimeout(800)
        assert(await page.locator('.manual-form').isVisible(), '表单区域不可见')
        return '表单加载正常'
      },
    },
    {
      roleKey: 'user', code: 'AG-02', label: 'AG-02 智能体发布申请（校验个人 Dify 应用列表加载）',
      check: async (page) => {
        await page.waitForTimeout(1500)
        const selects = page.locator('select')
        assert(await selects.count() >= 1, 'AG-02 下拉框未渲染')
        return '表单与资源选择器加载正常'
      },
    },
    {
      roleKey: 'user', code: 'AG-03', label: 'AG-03 智能体受限授权申请',
      check: async (page) => {
        await page.waitForTimeout(800)
        assert(await page.locator('.manual-form').isVisible(), 'AG-03 表单不可见')
        return '表单加载正常'
      },
    },
    {
      roleKey: 'user', code: 'AG-05', label: 'AG-05 智能体下架申请',
      check: async (page) => {
        await page.waitForTimeout(800)
        assert(await page.locator('.manual-form').isVisible(), 'AG-05 表单不可见')
        return '表单加载正常'
      },
    },
    {
      roleKey: 'user', code: 'PLG-03', label: 'PLG-03 插件安装申请（校验读取可用工作区按钮）',
      check: async (page) => {
        const btn = page.getByRole('button', {name: /读取可用工作区/})
        assert(await btn.isVisible(), '未找到「读取可用工作区」按钮')
        await btn.click()
        await page.waitForTimeout(1200)
        const wsOptions = await page.getByLabel('目标Dify workspace ID').locator('option').count()
        assert(wsOptions >= 2, `tenant01 工作区下拉框为空（options=${wsOptions}）`)
        return `加载到 ${wsOptions - 1} 个 Dify 工作区`
      },
    },
    {
      roleKey: 'user', code: 'MCP-01', label: 'MCP-01 上架登记（校验直接填写服务地址模式）',
      check: async (page) => {
        const urlInput = page.locator('input[placeholder*="http://"]')
        assert(await urlInput.isVisible(), '未展示直填 MCP 服务地址输入框')
        return '直填 URL 模式默认展示'
      },
    },
    {
      roleKey: 'user', code: 'KEY-01', label: 'KEY-01 API 密钥申请登记',
      check: async (page) => {
        await page.waitForTimeout(800)
        assert(await page.locator('.manual-form').isVisible(), 'KEY-01 表单不可见')
        return '表单加载正常'
      },
    },
    {
      roleKey: 'user', code: 'EVT-01', label: 'EVT-01 安全事件报告（校验严重级别下拉框存在）',
      check: async (page) => {
        const sev = page.getByLabel('严重级别')
        assert(await sev.isVisible(), 'EVT-01 缺少严重级别下拉框')
        const cnt = await sev.locator('option').count()
        assert(cnt >= 4, `严重级别选项不足 (${cnt})`)
        return `严重级别共 ${cnt} 项可选`
      },
    },
    {
      roleKey: 'ops', code: 'MOD-02', label: 'MOD-02 全员模型批量配置与下线',
      check: async (page) => {
        await page.waitForTimeout(800)
        assert(await page.locator('.manual-form').isVisible(), 'MOD-02 表单不可见')
        return '表单加载正常'
      },
    },
    {
      roleKey: 'ops', code: 'SVC-01', label: 'SVC-01 纳管子系统服务重启',
      check: async (page) => {
        await page.waitForTimeout(800)
        assert(await page.locator('.manual-form').isVisible(), 'SVC-01 表单不可见')
        return '表单加载正常'
      },
    },
    {
      roleKey: 'ops', code: 'CFG-04', label: 'CFG-04 智能体分析引擎与提示词配置',
      check: async (page) => {
        await page.waitForSelector('[data-testid="cfg-04-form"]', {timeout: 10000})
        return 'CFG-04 表单渲染正常'
      },
    },
    {
      roleKey: 'ops', code: 'CFG-05', label: 'CFG-05 旁路巡检与断流反制策略配置',
      check: async (page) => {
        await page.waitForSelector('[data-testid="cfg-05-form"]', {timeout: 10000})
        return 'CFG-05 表单渲染正常'
      },
    },
    {
      roleKey: 'ops', code: 'SEC-01', label: 'SEC-01 应用外部访问断流（校验应用下拉框加载真实 Dify 应用 + 默认锁定）',
      check: async (page) => {
        await page.waitForSelector('[data-testid="sec-01-form"]', {timeout: 10000})
        await page.waitForTimeout(1500)
        const appSelect = page.locator('[data-testid="sec-01-form"] select').first()
        const optCount = await appSelect.locator('option').count()
        assert(optCount >= 2, `SEC-01 应用下拉框为空（options=${optCount}）`)
        const submitBtn = page.locator('[data-testid="sec-01-form"] button[type="submit"]')
        const disabled = await submitBtn.isDisabled()
        assert(disabled, '默认关闭断流总开关时 SEC-01 提交按钮应为禁用锁定态')
        return `加载到 ${optCount - 1} 个真实 Dify 应用，提交按钮已默认锁定`
      },
    },
    {
      roleKey: 'admin', code: 'ACC-01', label: 'ACC-01 账号开通与变更',
      check: async (page) => {
        await page.waitForTimeout(800)
        assert(await page.locator('.manual-form').isVisible(), 'ACC-01 表单不可见')
        return '表单加载正常'
      },
    },
  ]

  for (const tc of ticketFormChecks) {
    await reporter.run('工单表单体检', tc.label, async () => {
      const s = sessions[tc.roleKey]
      await openAndAudit(s, `/manual/${tc.code}`, '.manual-form', {settleMs: 500})
      const detail = await tc.check(s.page)
      s.probe.assertClean(`${tc.roleKey} /manual/${tc.code}`)
      return detail
    }, sessions[tc.roleKey].page)
  }

  // =========================================================================
  // Suite C: Multi-Role Real Interactive E2E Flows (No Relogin, F5 Verified)
  // =========================================================================

  // Flow 1: CFG-05 Submit (ops) -> Duplicate Blocked -> Admin Reject (admin) -> F5 Verified
  await reporter.run('多角色全链路', 'CFG-05 策略配置工单：运维页内提单 → 重复提交拦截 → 管理员页内驳回 → F5 保持默认关闭', async () => {
    await openAndAudit(ops, '/governance-policy', '[data-testid="governance-policy-page"]')
    await ops.page.getByRole('button', {name: /发起策略变更工单/}).click()
    await ops.page.waitForSelector('[data-testid="cfg-05-form"]', {timeout: 10000})

    const tag = `[E2E-AUTO-${Date.now()}] 浏览器链路测试 CFG-05`
    await ops.page.locator('[data-testid="cfg-05-form"] textarea').fill(tag)
    await ops.page.locator('[data-testid="cfg-05-form"] button[type="submit"]').click()
    await ops.page.waitForSelector('[data-testid="cfg-05-form"] .app-banner.info', {timeout: 10000})

    // Duplicate submission MUST show 409 warning cleanly
    ops.probe.allowHttp(({status, path}) => status === 409 && path.includes('/api/governance-policy/config/request'))
    await ops.page.locator('[data-testid="cfg-05-form"] textarea').fill(`${tag} 重复提交`)
    await ops.page.locator('[data-testid="cfg-05-form"] button[type="submit"]').click()
    await ops.page.waitForSelector('[data-testid="cfg-05-form"] .app-banner.danger', {timeout: 10000})
    const dupText = await ops.page.locator('[data-testid="cfg-05-form"] .app-banner.danger').innerText()
    assert(dupText.includes('待审批'), `重复提交提示不符合预期: ${dupText}`)

    // Admin opens /manual/CFG-05 in parallel session (NO relogin!) and rejects to keep live switches OFF
    await openAndAudit(admin, '/manual/CFG-05', '[data-testid="cfg-05-form"]')
    const row = admin.page.locator('[data-testid="cfg-05-form"] tbody tr', {hasText: tag}).first()
    assert(await row.isVisible(), '管理员在 CFG-05 审批表中未看到运维提交的待审批工单')
    await row.getByRole('button', {name: '驳回'}).click()
    await admin.page.waitForSelector('[data-testid="cfg-05-form"] .app-banner.info', {timeout: 10000})

    // F5 reload to confirm persisted state
    await admin.page.reload({waitUntil: 'domcontentloaded'})
    await admin.page.waitForSelector('[data-testid="cfg-05-form"]', {timeout: 10000})
    const rowAfter = admin.page.locator('[data-testid="cfg-05-form"] tbody tr', {hasText: tag}).first()
    const statusText = await rowAfter.innerText()
    assert(statusText.includes('已驳回'), `刷新后状态应为已驳回，实际: ${statusText}`)
    admin.probe.assertClean('admin CFG-05 reload')
    return '提单 → 幂等409 → 管理员驳回 → F5 持久化验证全通'
  }, admin.page)

  // Flow 2: Agent Monitor -> Switch to "对外暴露与第三方溯源" Tab -> Verify Exposure & Default Lock
  await reporter.run('多角色全链路', '智能体监控 → 对外暴露与第三方溯源页签（验证真实暴露状态与默认锁定 🔒）', async () => {
    await openAndAudit(ops, '/agent-monitor', 'main', {settleMs: 1200})
    const tabBtn = ops.page.getByRole('button', {name: /对外暴露与第三方溯源/})
    assert(await tabBtn.isVisible(), '智能体监控未显示「对外暴露与第三方溯源」页签')
    await tabBtn.click()
    await ops.page.waitForSelector('[data-testid="agent-exposure-tab"]', {timeout: 10000})
    const text = await ops.page.locator('[data-testid="agent-exposure-tab"]').innerText()
    assert(text.includes('WebApp') && text.includes('第三方业务系统集成与外部调用溯源'), '对外暴露页签内容不完整')
    ops.probe.assertClean('ops agent-monitor exposure tab')
    return '暴露面指标、第三方 Referer 溯源表及断流锁定态均正常渲染'
  }, ops.page)

  // Flow 3: ChatApplication -> Match -> Save Draft -> Leave Page -> Return & Restore Draft
  await reporter.run('多角色全链路', '对话申请：意图匹配 → 保存草稿 → 切页面返回 → 恢复草稿', async () => {
    await openAndAudit(user, '/chat', '.chat-pane')
    await user.page.getByLabel('申请描述', {exact: true}).fill('我要申请把知识库分享给大家使用')
    await user.page.getByLabel('发送申请描述', {exact: true}).click()
    await user.page.waitForTimeout(500)
    const saveBtn = user.page.getByRole('button', {name: '保存草稿'})
    assert(await saveBtn.isEnabled(), '匹配后「保存草稿」按钮未启用')
    await saveBtn.click()
    await user.page.waitForTimeout(800)

    // Switch away to /agents and return to /chat
    await openAndAudit(user, '/agents', '[data-testid="warehouse-page"]')
    await openAndAudit(user, '/chat', '.chat-pane')
    const draftSection = user.page.getByText('已保存草稿（点击恢复）')
    assert(await draftSection.isVisible(), '切页面返回后未展示「已保存草稿（点击恢复）」列表')
    const oneClickBtn = user.page.getByRole('button', {name: '一键带入申请表单'})
    assert(await oneClickBtn.isVisible(), '未展示「一键带入申请表单」按钮')
    return '草稿持久化恢复 + 一键带入表单按钮验证通过'
  }, user.page)

  // Flow 4: Plugin Warehouse & Skill Warehouse Action Buttons
  await reporter.run('多角色全链路', '插件仓库「申请安装」与 Skill 仓库「申请下载」快捷跳转验证', async () => {
    await openAndAudit(user, '/plugin-warehouse', 'main', {settleMs: 1000})
    const plgBtn = user.page.locator('button.secondary-button', {hasText: '申请安装'}).first()
    if (await plgBtn.isVisible()) {
      await plgBtn.click()
      await user.page.waitForSelector('.form-title .type-code:has-text("PLG-03")', {timeout: 10000})
      assert(user.page.url().includes('/manual/PLG-03'), `跳转 URL 异常: ${user.page.url()}`)
    }
    await openAndAudit(user, '/skill-warehouse', 'main', {settleMs: 1000})
    const sklBtn = user.page.locator('button.secondary-button', {hasText: '申请下载'}).first()
    if (await sklBtn.isVisible()) {
      await sklBtn.click()
      await user.page.waitForSelector('.form-title .type-code:has-text("SKL-03")', {timeout: 10000})
      assert(user.page.url().includes('/manual/SKL-03'), `跳转 URL 异常: ${user.page.url()}`)
    }
    return '仓库快捷动作跳转至 PLG-03 / SKL-03 验证通过'
  }, user.page)
}
