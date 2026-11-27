# 前端页面字符码、UUID 与哈希长串裸露全站审计清单

> **审计时间**：2026-11-26  
> **审计范围**：`management/` 目录下全部 **75 个 `.tsx` 前端页面与组件**（仅排查记录，未改动业务代码）  
> **审计目标**：排查所有不符合商业软件规范的裸露字符码，包括但不限于 `PLG-03-98100f92-ed90-4ed1-8a2f-37266d411b5f` 类 UUID 拼接工单号、36 位资源/工作区/文档 UUID、64 位 SHA-256 哈希、快照 ID、执行 ID 及内部人员 ID。

---

## 一、总体排查结论

全站 75 个 `.tsx` 文件中，共检出 **42 处**向终端用户直接展示底层字符码/UUID/哈希的页面与组件，集中在以下 **6 类高频问题**：

| 序号 | 问题类型 | 典型裸露样例 | 影响范围 | 优先级 |
| :---: | :--- | :--- | :--- | :---: |
| 1 | **UUID 拼接超长工单号** | `PLG-03-98100f92-ed90-4ed1-8a2f-37266d411b5f`、`KB-02-da23bf54-...`、`SVC-01-40位哈希` | 工单列表、待办卡片、审批详情、全部监控页、提交回执 | **P0** |
| 2 | **下拉选择器 `<option>` 拼接 UUID** | `刑侦办案规范共享库 · 1a5b1163-5e8b-...`、`王芳的工作区 · 93afd578-...` | `KB-03`、`KB-05`、`PLG-03`、`SKL-03`、`AG-03~05` 等表单 | **P0** |
| 3 | **通用详情组件 `RecordDetails` 裸显技术字段** | `workspaceId`、`resourceId`、`源知识库ID`、`文档清单快照ID`、`目标Dify workspace ID` | 所有工单审批详情页（`ApplicationDesk` / `AccountDesk` / `EventDesk`） | **P0** |
| 4 | **表单只读框/状态行直接展示 UUID/快照 ID/哈希** | `来源工作区: bec29b57-...`、`Dify应用 ID: 394c2f37-...`、`快照 · snap-...`、`SHA-256 · 93d8e470...` | `AG-02/03/04/05`、`KB-01/02/04`、`MCP-03`、`SKL-03`、`UploadIntake` | **P0** |
| 5 | **监控台账表格直接展示 UUID / 哈希列** | `工作区 ID`、`任务 / 知识库 ID`、`安装实例 ID`、`绑定 ID`、`SHA-256`、`脚本校验哈希` | 知识库监控、MCP 监控、插件监控、账号监控、Skill 监控、服务监控、审计日志 | **P1** |
| 6 | **个人中心与账号表单暴露内部主键 `subjectId`** | `稳定人员ID · dify-c60c3f086cb24734`、`person-zhou-min` | 个人中心、账号开通与变更表单、草稿恢复按钮 | **P1** |

---

## 二、逐模块、逐页面排查明细

### 模块 A：工单中心与审批工作台（重灾区 · P0）

| 页面 / 组件 | 文件路径 | 行号 | 当前暴露的字符码 | 商用改造建议 |
| :--- | :--- | :---: | :--- | :--- |
| **业务审批工作台** | `management/app/web/ApplicationDesk.tsx` | L234, L259, L290, L371, L394 | 左侧卡片和详情抬头展示 43 位 `PLG-03-<UUID>` 工单号；`RecordDetails` 展示 `snapshot.fields` 中的 `源知识库ID`、`文档清单快照ID`、`workspace/tenant ID`；L394 展示 `安全复核 · {documentId}` | 1. 统一短工单号格式（如 `PLG-03-20261126-0012`）；<br>2. 审批详情用中文文档名替代 `documentId`；<br>3. 技术快照字段归入底部默认折叠的「审计溯源」 |
| **工单中心页与抽屉** | `management/app/web/WorkOrderPages.tsx` | L267, L341, L508, L533-534 | 列表、顶部提示与详情抽屉直接展示完整 UUID 工单号、`data.resourceId`、`Workspace UUID` | 展示业务名称 + 简短可读单号 + 工作区中文名 |
| **账号审批台** | `management/modules/accounts/web/AccountDesk.tsx` | L79, L87, L103 | 卡片与抬头展示 `ACC-01-<UUID>` 超长工单号 | 统一改为可读短单号 |
| **安全事件审批台** | `management/modules/events/web/EventDesk.tsx` | L147, L168 | 展示 `EVT-01-plugin-<40位哈希>`、未命中名称时直接回退显示 `row.resourceId` | 生成简短事件号（如 `EVT-20261126-003`），对象兜底显示「未知对象」而非 UUID |
| **Skill 取消交付台** | `management/modules/skills/web/SkillCancellationDesk.tsx` | L26-27 | 展示完整 `ticketNo` 与 `执行编号 · {row.executionId}`（UUID） | 隐藏 `executionId`，展示 Skill 中文名与简短单号 |
| **知识库文档安全复核** | `management/modules/knowledge/web/KnowledgeDeskReview.tsx` | L102, L146 | `KB-02` 副标题展示 `{d.documentId} · sha256 {d.sha256.slice(0,12)}`；`KB-04` 仍直接展示 `{d.documentId} · {d.sha256}` | 仅展示文档名称、分段数与自动结论；`KB-04` 同步升级为中文文档名表格 |
| **工单草稿恢复栏** | `management/platform/workflow/web/ApplicationDrafts.tsx` | L11-12 | 恢复按钮展示 `恢复草稿 · {resourceId / subjectId}`，已提交展示 `ticketNo / draftId` | 优先存并展示 `resourceName` / `name`，无则显示「未命名草稿」 |

---

### 模块 B：手工申请表单与资源选择器（P0）

| 页面 / 组件 | 文件路径 | 行号 | 当前暴露的字符码 | 商用改造建议 |
| :--- | :--- | :---: | :--- | :--- |
| **知识库绑定选择器（KB-03）** | `management/modules/knowledge/web/KnowledgeBindingPicker.tsx` | L35-43 | 下拉框展示 `{row.name} · {row.workspaceId}` 和 `{row.name} · {row.source} · {row.resourceId}`；标签名为 `工作区 ID` / `目录知识库 ID` | 去掉所有 UUID 后缀，标签改为 `目标工作区` / `共享知识库`，选项只展示中文名与来源标签 |
| **知识库处置表单（KB-05）** | `management/modules/knowledge/web/DatasetDisposition.tsx` | L89-93 | 下拉框展示 `{row.name} · {row.source} · {row.resourceId}`；指定文档多选框展示 `doc.documentId` | 选项去掉 `resourceId`，文档列表展示中文文件名 `doc.name` |
| **知识库同步表单（KB-01）** | `management/modules/knowledge/web/KnowledgeSync.tsx` | L32, L37 | 标签含 `workspace ID`，页面直接展示 `快照 · {snapshotId}` | 隐藏 `snapshotId`，改为绿色状态条「已核验知识库」 |
| **插件操作选择器（PLG-03）** | `management/modules/plugins/web/PluginOperationPicker.tsx` | L44-54 | 下拉框展示 `{row.name} · {row.workspaceId}` 及 `{row.name} · {row.resourceId} · {row.workspaceId}` | 仅展示工作区中文名、插件中文名与版本号 |
| **智能体使用申请（AG-03）** | `management/modules/agents/web/AgentAccessForm.tsx` & `app/web/AccessApplication.tsx` | L137, L141 / L81 | 两个只读输入框直接展示 `来源工作区 (UUID)` 和 `Dify应用 ID (UUID)` | 改为展示「来源工作区名称」与「应用名称」，隐藏原始 UUID |
| **智能体变更/下架（AG-04/05）** | `management/modules/agents/web/AgentWithdrawForm.tsx` & `app/web/WithdrawApplication.tsx` | L175, L179 / L78-79 | 只读输入框直接展示 `fields.workspaceId` 与 `original.appId` | 展示工作区名称与应用名称 |
| **智能体发布表单（AG-02）** | `management/modules/agents/web/PublishResource.tsx` | L171-172 | 页面明文展示 `资源 · {snapshot.resourceId}` 和 `快照 · {snapshot.snapshotId}` | 替换为「已读取应用配置核验完成」状态条 |
| **替代应用 / 目标应用选择器** | `AgentReplacementPicker.tsx` / `ApplicationTargetPicker.tsx` | L41 / L38 | 提示条展示 `工作区 {detail.workspaceId}`、`目标应用工作区 (UUID)` | 展示工作区中文名 |
| **MCP 隔离处置（MCP-03）** | `management/modules/mcp/web/McpDisposition.tsx` | L55-56 | 只读框展示 `目标workspace ID`，提示行展示 `处置依据 · {snapshotId}` | 展示工作区名称，隐藏 `snapshotId` |
| **Skill 下载申请（SKL-03）** | `management/modules/skills/web/SkillDownloadApplication.tsx` | L60, L64, L69 | 下拉展示 `{v.name} · {v.resourceId}`；明文展示 64 位 `SHA-256 {item.data.sha256}`；展示完整 `ticketNo` | 下拉只展示名称与版本；SHA-256 改为「文件完整性校验已通过」微标（鼠标悬停可看短指纹） |
| **安装包上传组件** | `management/platform/packages/web/UploadIntake.tsx` | L39 | 页面直接打印 64 位 `SHA-256 · {intake.sha256}` | 改为「文件校验通过」微标，哈希仅作 tooltip 或折叠审计信息 |
| **工具审批 / 密钥生命周期 / 包更新** | `ToolApproval.tsx` / `KeyRegistrationPicker.tsx` / `PackageRevision.tsx` | L48 / L29 / L30 | `来源工作区 (UUID)`、`密钥登记 ID`、`目录 ID` | 统一使用业务名称选择器 |
| **账号开通与变更（ACC-01/02）** | `management/modules/accounts/web/AccountApplication.tsx` | L148 | 灰色提示行展示 `稳定人员ID · {person.subjectId}` | 去掉 `subjectId`，仅展示姓名与登录账号 |
| **批量管控类表单（PLG-05/MCP-04/MOD-02/SVC-01/CFG-04/ACC-03/04/MOD-01）** | `PluginBatchTicketForm`、`McpBatchTicketForm`、`ModelBatchTicketForm`、`ServiceRestartTicketForm`、`AgentAnalysisConfigForm`、`SelfServiceAccountForms` | 各记录表 | 历史表展示工单号（目前为 8 位随机短码如 `MOD-02-1bbac23c`，相对较短，但 `SVC-01` 表单还展示了 `校验哈希 12位`） | 统一采用 `类型-日期-序号` 商用单号；脚本校验哈希改为「已锁定防篡改 · vN」徽标 |

---

### 模块 C：十大监控页面与审计日志（P1）

| 页面 | 文件路径 | 行号 | 当前暴露的字符码 | 商用改造建议 |
| :--- | :--- | :---: | :--- | :--- |
| **知识库监控** | `management/modules/knowledge/web/KnowledgeMonitor.tsx` | L236, L245, L289 | 「知识库台账与构建任务追踪」首列直接显示 36 位 `taskId`（Dify dataset UUID）及完整 `ticketNo` | 首列改为「知识库名称」，去掉 `任务/知识库 ID` 列；关联工单显示简短单号 |
| **MCP 监控** | `management/modules/mcp/web/McpMonitor.tsx` | L439, L456, L504, L506, L515, L562, L573 | 表格直接展示 `callId`、`bindingId`、`workspaceId`（36 位 UUID）、`alertId`、`ticketNo` | `workspaceId` 映射为工作区中文名；隐藏纯技术流水 ID，工单号改短码 |
| **插件监控** | `management/modules/plugins/web/PluginMonitor.tsx` | L439, L448, L495 | 自动禁用表与实例表直接展示 36 位 `workspaceId`、`installationId`、`ticketNo` | 展示工作区中文名与所属人，隐藏 `installationId` |
| **账号监控** | `management/modules/accounts/web/AccountMonitor.tsx` | L802, L808 | 表格直接展示 `workspaceId` 与 `ticketNo` | 展示工作区名称与简短单号 |
| **智能体监控** | `management/modules/agents/web/AgentMonitor.tsx` & `AgentAppInsightsPanel.tsx` | L151 / L593 | 溯源抽屉展示 `应用 ID (UUID)`；批量任务表展示随机 `taskId` | 溯源抽屉展示应用名与模式；批量任务展示「分析批次 + 时间」 |
| **Skill 监控** | `management/modules/skills/web/SkillMonitor.tsx` | L278, L284 | 领用表展示 `sha256` 哈希与完整 `ticketNo` | 改为「校验通过」状态微标 + 简短单号 |
| **安全事件监控** | `management/modules/events/web/EventMonitor.tsx` | L144, L150 | 首列展示 `EVT-01-plugin-<40位哈希>` 超长事件 ID | 统一简短事件号 |
| **服务监控** | `management/modules/services/web/ServiceMonitor.tsx` | L570, L638 | 脚本表展示 `v1 · 10位哈希`；工单表展示 `SVC-01-AUTO-xxxx` | 脚本表显示 `v1 · 防篡改已锁定`；工单号统一商用格式 |
| **审计日志** | `management/modules/audit/web/AuditLog.tsx` | L260, L262, L304 | 直接展示 `ticketNo`、`resourceId`、`appId` | 优先解析为业务对象名称，原始 ID 仅在行详情折叠展示 |
| **总览大屏** | `management/modules/overview/web/Overview.tsx` | L49, L52 | 告警对象与最近操作记录中若未映射名称会直接裸露 `resourceId` 和超长 `ticketNo` | 补充名称映射并缩短单号 |

---

### 模块 D：资源仓库、系统设置与个人中心（P1 / P2）

| 页面 | 文件路径 | 行号 | 当前暴露的字符码 | 商用改造建议 |
| :--- | :--- | :---: | :--- | :--- |
| **个人中心** | `management/modules/accounts/web/ProfilePage.tsx` | L437, L457, L492 | 账号基本信息展示 `profile.subjectId`（如 `dify-c60c3f086cb24734`）；授权到期行展示超长 `ticketNo` | 隐藏 `subjectId`；工单号改短码 |
| **纳管子系统** | `management/app/web/SubsystemsPage.tsx` | L435 | 卡片直接展示默认工作区 UUID `item.workspaceId` | 改为展示工作区名称或折叠在配置抽屉内 |
| **MCP / 插件 / Skill 仓库** | `McpWarehouse.tsx` / `PluginWarehouse.tsx` / `SkillVersions.tsx` / `KnowledgeWarehouse.tsx` | L148 / L148 / L41 / L167 | 卡片副标题兜底显示 `item.resourceId`；Skill 版本历史拼出 `sha256`；知识库详情展示超长 `ticketNo` | 兜底文案改为中文提示（如「已上架」）；隐藏版本 `sha256` |
| **组织机构 / 敏感词 / MCP 题库** | `OrganizationsPage.tsx` / `KeywordRulesPage.tsx` / `McpTestSuitesPage.tsx` | L424 / L334 / L319 | 变更工单表展示 `CFG-01/02/03-<UUID>` | 统一接入商用短工单号 |

---

### 模块 E：通用底层组件（治本关键 · P0）

| 组件 | 文件路径 | 根因说明 | 统一治本方案 |
| :--- | :--- | :--- | :--- |
| **通用详情渲染器** | `management/shared-ui/RecordDetails.tsx` | 凡是 `key` 在 `labels` 里或含中文的字段都会直接渲染原始 `value`，导致 `workspaceId`、`resourceId`、`源知识库ID`、`目标Dify workspace ID`、`文档清单快照ID`、`policyRef` 等 36 位 UUID 和 64 位哈希全站大面积裸露 | 1. 增加技术 ID 黑名单（默认不在主信息网格展示）；<br>2. 对疑似 36 位 UUID / 64 位哈希的值自动识别：有名称字段则替换为业务名，否则收入页底默认折叠的「审计溯源编号」 |
| **工单号生成器** | `management/platform/workflow/` & 各模块 `route*.mjs` | 历史代码使用 `${ticketType}-${crypto.randomUUID()}` 拼接出 43 位超长随机串（如 `PLG-03-98100f92-ed90-4ed1-8a2f-37266d411b5f`） | 1. **新单治本**：后端工单号生成器统一改为 **`<类型>-<YYYYMMDD>-<4位顺序号/短码>`**（如 `PLG-03-20261126-0012`）；<br>2. **旧单兼容**：前端统一封装 `formatTicketNo(ticketNo)` 展示工具，对历史遗留的 UUID 长单号自动压缩展示为可读短格式（如 `PLG-03-98100F`，悬停可复制完整原号） |

---

## 三、推荐分批整改顺序（供确认后执行）

1. **第一批（立竿见影，消除 80% 裸露）**：
   - 统一工单编号生成规则 + 前端 `formatTicketNo()` 全局工具（彻底消除 `PLG-03-98100f92-ed90-4ed1-8a2f-37266d411b5f` 类超长串）。
   - 升级 `RecordDetails.tsx` 默认屏蔽底层 UUID / 哈希字段，收拢到页底折叠区。
2. **第二批（工单中心与高频表单）**：
   - 改造 `ApplicationDesk`、`AccountDesk`、`EventDesk`、`WorkOrderPages`、`KnowledgeDeskReview`、`ApplicationDrafts`。
   - 清理所有 `<select><option>` 和只读框里的 UUID（`KnowledgeBindingPicker`、`DatasetDisposition`、`PluginOperationPicker`、`AgentAccessForm`、`AgentWithdrawForm`、`SkillDownloadApplication`、`PublishResource`、`UploadIntake`、`AccountApplication`）。
3. **第三批（监控大屏、仓库与个人中心）**：
   - 清理知识库监控、MCP 监控、插件监控、账号监控、Skill 监控、服务监控、个人中心中的 `taskId` / `workspaceId` / `installationId` / `sha256` / `subjectId`。
