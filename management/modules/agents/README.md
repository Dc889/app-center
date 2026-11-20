# 智能体模块（`agents`）

## 职责范围

- 负责智能体纳管（`AG-01`）、发布审批（`AG-02`）、使用授权（`AG-03`）、变更再发布（`AG-04`）与下架（`AG-05`）业务规则。
- 负责智能体仓库（`/api/agent-warehouse`）、智能体全量监控与调用审计（`/api/agent-monitor`）、影响统计（`/api/agent-impact`）、替代应用选择（`/api/agent-replacements`）及目标应用绑定选择（`/api/application-targets`）。

## 目录与公开入口

- `web/`：`AgentWarehouse.tsx`、`AgentMonitor.tsx`、`PublishResource.tsx`、`AgentAccessForm.tsx`、`AgentWithdrawForm.tsx`、`AgentDeskControls.tsx`、`AgentImpactPanel.tsx`、`AgentReplacementPicker.tsx`、`ApplicationTargetPicker.tsx`、`PublicationApplicationPicker.tsx`
- `server/`：`agent-warehouse.mjs`、`agent-monitor.mjs`、`agent-management.mjs`、`agent-impact.mjs`、`agent-replacements.mjs`、`application-targets.mjs`、`submitAG01~05.mjs`、`approveAG02~05.mjs`、`route*.mjs`、`workflows.mjs`
- `public.web.ts`：导出前端组件、选择器与 `moduleWeb`（注册 `agents`/`agentMonitor` 视图及 `AG-01~05` 全部工单表单）
- `public.server.mjs`：导出服务端公开接口与 `moduleServer`（注册 5 组业务路由、`AG-01~05` 提交处理器及 `AG-02~05` 审批处理器）
- `tests/`：本模块集成测试与浏览器验收脚本（含 `agent-warehouse-browser.mjs` Edge 页面验收）

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`；其他业务模块仅可通过其 `public.*` 入口调用。
- 禁止依赖：`management/app/*`、`capability/*` 及其他业务模块私有目录。
- 数据归属：工单公共台账由工作流机制统一持久化，智能体目录/影响/监控均以只读方式聚合或经能力契约读取。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- agents
npm.cmd run test:browser -- agents
```
