# 服务监控模块（`services`）

## 职责范围

- 负责服务监控页（`/api/service-monitor`），分别列出 Dify 与 RAGFlow 已部署容器的运行状态。
- 容器确认不可用时创建 `SVC-01`，自动审批后只重启该容器。Docker 不可用时显示未采集，不创建工单。

## 目录与公开入口

- `web/`：`ServiceMonitor.tsx`
- `server/`：`service-probe.mjs`、`service-monitor.mjs`、`routeServiceMonitor.mjs`
- `public.web.ts`：导出页面与 `moduleWeb`
- `public.server.mjs`：导出巡检服务与 `moduleServer`

## 依赖与数据边界

- 允许依赖：`management/shared-ui/*`、`runtime/*`。
- 禁止依赖：`management/app/*`、`capability/*` 及其他业务模块私有实现。
- 重启只接受本次巡检得到的容器 ID，不修改 Dify 或 RAGFlow 源码和数据库。

## 运行与验收命令

```powershell
npm.cmd run test:module -- services
npm.cmd run test:browser -- services
```
