# 工具批准模块（`tools`）

## 职责范围

- 负责 `TOL-01` 工具首次批准、变更再审与撤销批准的申请表单、候选资格规则、配置与批准登记双前置条件核验及安全审批处理。

## 目录与公开入口

- `web/`：`ToolApproval.tsx`
- `server/`：`tool-approval.mjs`、`submitTOL01.mjs`、`approveTOL01.mjs`、`workflows.mjs`
- `public.web.ts`：导出 `ToolApproval` 与 `moduleWeb`（注册 `TOL-01` 申请表单）
- `public.server.mjs`：导出工具校验服务与 `moduleServer`（注册 `TOL-01` 工作流及 `TOL-01` 执行上下文）
- `tests/`：本模块集成测试与浏览器验收脚本

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`。
- 禁止依赖：`management/app/*`、`capability/*` 及其他业务模块内部文件。
- 数据归属：工具批准业务校验与审批参数冻结归属本模块，工单持久化与投递由公共工作流维护。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- tools
npm.cmd run test:browser -- tools
```
