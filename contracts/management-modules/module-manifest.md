# 管理端模块清单与跨模块依赖矩阵

更新于 2026-11-19。本清单记录 `management/modules/` 与 `management/platform/` 当前的职责、对外入口、跨模块依赖以及待二期继续解耦的共享过渡项。

## 1. 业务模块清单（`management/modules/`）

| 模块目录 | 职责与工单范围 | 注册的前端视图 / 表单 | 注册的服务端路由 / 扩展点 | 跨业务模块依赖 |
| --- | --- | --- | --- | --- |
| `accounts` | 账号工单 `ACC-01/02`、账号恢复、账号监控 | 视图：`accounts`；表单：`ACC-01`, `ACC-02` | 路由：`/api/account-monitor`（账号工单由 `accountWorkflows` 挂载） | 无 |
| `agents` | 智能体 `AG-01~05`、仓库、全量监控、影响/替代/目标应用 | 视图：`agents`, `agentMonitor`；表单：`AG-01~05` | 路由：`/api/agent-warehouse`, `/api/agent-monitor`, `/api/agent-impact`, `/api/agent-replacements*`, `/api/application-targets*`；工单提交：`AG-01~05`；审批：`AG-02~05` | 无 |
| `audit` | 管理审计、审计追踪六区块与双表导出 | 视图：`audit` | 路由：`/api/audit`, `/api/audit-report`, `/api/audit-report/export` | 无（只读注入台账） |
| `events` | 安全事件 `EVT-01` 办理、监控六区块与五块证据 | 视图：`security` | 路由：`/api/events`, `/api/events/transition`, `/api/event-monitor*` | 无（只读关联执行） |
| `keys` | 密钥 `KEY-01/02` 申请、审批与登记候选 | 表单：`KEY-01`, `KEY-02` | 路由：`/api/key-registrations`；工单：`KEY-01/02`；上下文：`KEY-02` | 无 |
| `knowledge` | 知识库 `KB-01~05`、逐文档审查、处置与监控 | 视图：`knowledge`；表单：`KB-01~03`, `KB-05` | 路由：`/api/knowledge-monitor`；工单：`KB-01~03`, `KB-05`；上下文/候选：`KB-03`, `KB-05` | `agents/public.*`（目标应用与随应用发布选择） |
| `mcp` | MCP `MCP-01~03` 注册、绑定、处置与监控 | 视图：`mcp`；表单：`MCP-01`, `MCP-03` | 路由：`/api/mcp-binding-context`, `/api/mcp-monitor`；工单：`MCP-01~03`；上下文：`MCP-03` | `agents/public.*`（目标应用绑定核验） |
| `overview` | 统一概览与服务健康汇总 | 视图：`overview` | 路由：`/api/overview` | 无（只读聚合） |
| `plugins` | 插件 `PLG-01~04` 上架、操作、安全禁用与监控 | 视图：`plugins`；表单：`PLG-01`, `PLG-03` | 路由：`/api/plugin-operation-context`, `/api/plugin-monitor`；工单：`PLG-01/03` | 无 |
| `skills` | Skill `SKL-01~04` 上架、下载、取消、下架与监控 | 视图：`skills`；表单：`SKL-01`, `SKL-03` | 路由：`/api/skill-monitor`；工单：`SKL-01/04`；上下文：`SKL-04` | 无 |
| `tools` | 工具批准 `TOL-01` 首次/变更/撤销审批 | 表单：`TOL-01` | 工单：`TOL-01`；上下文：`TOL-01` | 无 |

## 2. 公共平台模块清单（`management/platform/`）

| 平台目录 | 职责 | 公开入口 |
| --- | --- | --- |
| `identity` | 身份主体目录、改名映射、受限锁定与会话校验 | `public.server.mjs` |
| `workflow` | 工单类型版本注册、草稿保存恢复与对话匹配 | `public.server.mjs`, `public.web.ts` |
| `packages` | Skill/插件上传包接件、扫描与版本变更再审辅助 | `public.server.mjs`, `public.web.ts` |
| `evidence` | 工单证据附件存储、脱敏与本人权限读取 | `public.server.mjs` |
| `delivery` | Skill 文件交付事务锁、阶段证据与取消控制 | `public.server.mjs` |
| `access` | 内部访问策略判定（`/internal/v1/policy-decisions`） | `public.server.mjs` |
| `capability-client` | 能力组件 HTTP 客户端与严格执行响应解码器透传 | `public.server.mjs` |

## 3. 过渡项与二期解耦进展

截至第 3 阶段，开发 A 负责的公共装配与独占模块解耦已完成：
1. **工单提交引擎解耦**：`AG-01~05` 与 `KB-01` 提交逻辑与字段校验已全部下沉至 `management/modules/agents/server/` 与 `management/modules/knowledge/server/`，装配层 `application-workflows.mjs` 中对应硬编码分支已清理。
2. **业务表单下沉**：前端工单表单 `AG-03`、`AG-04`、`AG-05` 已迁移至 `agents/web/`，`KB-03` 已迁移至 `knowledge/web/`，从装配层 `module-registry.tsx` 的共享过渡表中彻底剔除。
3. **工作台组件下沉**：`ApplicationDesk.tsx` 中的知识库复核/处置以及智能体处置范围/风险决策已抽离为模块独立导出组件。
4. **全局样式切分**：`shared-ui/styles/App.css`（原 1660 行单体）已拆分为 `base.css`、`login.css`、`shell.css`、`dashboard.css`、`forms.css` 5 个独立样式表。
5. **构建代码分包**：Vite 代码分包优化完成，业务主包降至 ~363kB，彻底消除 >500kB 构建警告。

剩余跨业务过渡项主要归属开发 B 模块或对端组件联调：
1. `app/web/AccessApplication.tsx`（仅余 Dev B 的 `MCP-02`）、`WithdrawApplication.tsx`（仅余 Dev B 的 `SKL-04`）、`PackageRevision.tsx`（`SKL-02/PLG-02`）。
2. `app/server/service.mjs` 中的 `SKL-03` 下载交付/回执路由与 `EVT-01` 观察定时器。
