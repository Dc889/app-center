# 知识库模块（`knowledge`）

## 职责范围

- 负责知识库本人同步（`KB-01`）、发布共享与逐文档审查（`KB-02`）、使用绑定（`KB-03`）、内容变更再审（`KB-04`）与安全处置（`KB-05`）。
- 负责知识库监控页（`/api/knowledge-monitor`，两产品库盘点、构建任务追踪、嵌入模型核对与文档审查台账）。
- 负责知识库仓库页（`/api/knowledge-warehouse`，下载次数排行、搜索、可用状态与使用方式筛选、可滑动的矩形图标目录）。
- 负责 `KB-03`、`KB-05` 的执行上下文与候选列表查询扩展。

## 目录与公开入口

- `web/`：`KnowledgeWarehouse.tsx`、`KnowledgeMonitor.tsx`、`KnowledgeSync.tsx`、`DatasetPublicationContext.tsx`、`KnowledgeAccessForm.tsx`、`KnowledgeDeskReview.tsx`、`KnowledgeBindingPicker.tsx`、`DatasetDisposition.tsx`
- `server/`：`dataset-review.mjs`、`dataset-binding.mjs`、`dataset-changes.mjs`、`dataset-disposition.mjs`、`knowledge-monitor.mjs`、`routeKnowledgeMonitor.mjs`、`submitKB01/02/03/05.mjs`、`approveKB02/03/05.mjs`、`workflows.mjs`
- `public.web.ts`：导出前端组件与 `moduleWeb`（注册 `knowledge` 视图及 `KB-01`、`KB-02`、`KB-03`、`KB-05` 全部表单）
- `public.server.mjs`：导出公开服务与 `moduleServer`（注册 `/api/knowledge-monitor`、`KB-01/02/03/05` 提交与审批工作流及 `KB-03/05` 上下文与候选处理器）
- `tests/`：本模块集成测试与浏览器验收脚本

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`；涉及随应用发布或目标应用绑定时，仅通过 `management/modules/agents/public.*` 公开入口交互。
- 禁止依赖：`management/app/*`、`capability/*` 及其他业务模块私有目录。
- 数据归属：知识库工单规则、文档审查与处置校验归属本模块；工单主状态与投递由公共工作流维护。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- knowledge
npm.cmd run test:browser -- knowledge
```
