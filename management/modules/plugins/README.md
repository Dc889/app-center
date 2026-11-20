# 插件管理模块（`plugins`）

## 职责范围

- 负责插件上架（`PLG-01`）、版本变更再审（`PLG-02`，与 `platform/packages` 协作）、安装/升级/卸载操作（`PLG-03`）及异常自动禁用与恢复观察（`PLG-04`）。
- 负责插件操作上下文（`/api/plugin-operation-context`）与插件监控页（`/api/plugin-monitor`，含实例台账、内存趋势、Daemon 健康与自动禁用记录）。

## 目录与公开入口

- `web/`：`PluginMonitor.tsx`、`PluginPublication.tsx`、`PluginOperation.tsx`、`PluginOperationPicker.tsx`、`PluginRestoreForm.tsx`
- `server/`：`plugin-monitor.mjs`、`plugin-operation.mjs`、`plugin-safety.mjs`、`routePluginMonitor.mjs`、`routePluginOperationContext.mjs`、`submitPLG01/03.mjs`、`approvePLG01/03.mjs`、`workflows.mjs`
- `public.web.ts`：导出前端组件与 `moduleWeb`（注册 `plugins` 视图及 `PLG-01`/`PLG-03` 表单；`PLG-02` 待二期从 `app/web` 共享包表单拆入）
- `public.server.mjs`：导出公开服务与 `moduleServer`（注册 2 组路由及 `PLG-01`/`PLG-03` 工作流）
- `tests/`：本模块集成测试与浏览器验收脚本

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`。
- 禁止依赖：`management/app/*`、`capability/*` 及其他业务模块内部文件。
- 数据归属：插件工单规则与自动安全处置状态转换由本模块维护，上传包扫描由 `platform/packages` 托管，紧急告警升级通过注入回调交由事件机制落库。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- plugins
npm.cmd run test:browser -- plugins
```

2026-11-19 管理端已完成插件仓库：`PluginWarehouse.tsx` 登记 `pluginWarehouse`。未选工作区显示“选择工作区查看”；安装状态只有明确 true/false 或实例 ID 才显示已安装/未安装，缺失显示未采集；切换工作区清空目录并丢弃迟到响应；安装、升级、卸载提交 PLG-03。验收见 `tests/browser/plugin-warehouse-browser.mjs`。PLG-01/PLG-02 模拟对端页面提交见 `tests/browser/plugin-publication-browser.mjs`，单号 PLG-01-93723fec-892b-40ef-87e6-81a813592dd1、PLG-02-f5a1e982-db68-49f3-925f-48ee510b008f。脱敏联调样例见 [联调样例.md](联调样例.md)。真实 Dify 执行仍待能力组联调。
