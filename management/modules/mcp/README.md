# MCP 管理模块（`mcp`）

## 职责范围

- 负责 MCP 技术注册与上架（`MCP-01`）、工作区/应用绑定（`MCP-02`）与解绑/隔离/下架处置（`MCP-03`）。
- 负责 MCP 绑定上下文（`/api/mcp-binding-context`）、MCP 监控视图（`/api/mcp-monitor`）及 `MCP-03` 执行上下文裁剪。
- 普通用户视图严禁暴露底层统一 URL 指纹与 provider 凭证细节。

## 目录与公开入口

- `web/`：`McpMonitor.tsx`、`McpRegistration.tsx`、`McpDisposition.tsx`
- `server/`：`mcp-registration.mjs`、`mcp-binding.mjs`、`mcp-disposition.mjs`、`mcp-monitor.mjs`、`routeMcpBindingContext.mjs`、`routeMcpMonitor.mjs`、`submitMCP01~03.mjs`、`approveMCP01~03.mjs`、`workflows.mjs`
- `public.web.ts`：导出前端组件与 `moduleWeb`（注册 `mcp` 视图及 `MCP-01`/`MCP-03` 表单；`MCP-02` 待二期从 `app/web` 跨业务表单拆入）
- `public.server.mjs`：导出公开服务与 `moduleServer`（注册 2 组路由、`MCP-01~03` 工作流与 `MCP-03` 执行上下文）
- `tests/`：本模块集成测试与浏览器验收脚本

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`；关联目标应用时仅通过 `management/modules/agents/public.*` 调用。
- 禁止依赖：`management/app/*`、`capability/*` 及其他业务模块私有实现。
- 数据归属：MCP 注册、绑定与处置审批规则归属本模块，工单主台账由工作流引擎维护。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- mcp
npm.cmd run test:browser -- mcp
```

2026-11-19 管理端已完成 MCP 仓库：`McpWarehouse.tsx` 登记 `mcpWarehouse`。未选工作区显示“选择工作区查看”；绑定状态按依据显示，缺失为未采集；普通用户不展示 URL 与 provider；绑定提交 MCP-02，运维可提交 MCP-03 目录隔离。验收见 `tests/browser/mcp-warehouse-browser.mjs`。MCP-01 模拟对端页面提交见 `tests/browser/mcp-registration-browser.mjs`，单号 MCP-01-c732bd95-a33e-4ad4-88ee-6b92ac903d94。脱敏联调样例见 [联调样例.md](联调样例.md)。真实绑定和撤权仍待能力组联调。
