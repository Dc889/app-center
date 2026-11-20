# 安全事件模块（`events`）

## 职责范围

- 负责 `EVT-01` 安全事件的人工报告、研判、处置、观察与双人复核关闭（`/api/events`、`/api/events/transition`）。
- 负责安全事件监控六区块汇总与五块证据白名单读取（`/api/event-monitor`、`/api/event-monitor/:ticketNo`）。
- 事件本身遵循零次下发原则，副作用处置必须通过关联业务工单并校验执行结果。

## 目录与公开入口

- `web/`：`EventDesk.tsx`、`EventMonitor.tsx`
- `server/`：`event-monitor.mjs`、`routeEventMonitor.mjs`、`routeEvents.mjs`
- `public.web.ts`：导出 `EventDesk`、`EventMonitor` 与 `moduleWeb`（注册 `security` 视图）
- `public.server.mjs`：导出监控与路由处理器及 `moduleServer`（注册 `/api/events*` 与 `/api/event-monitor*`）
- `tests/`：本模块集成测试与浏览器验收脚本

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`。
- 禁止依赖：`management/app/*`、`capability/*` 及其他业务模块内部文件。
- 数据归属：安全事件台账（`reported-events`）写入归属本模块；关联业务工单仅作只读引用与权限裁剪。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- events
npm.cmd run test:browser -- events
```

2026-11-19 管理端已完成事件办理补齐：办理页显示目录对象名称，目录没有名称时显示未采集；附件先上传证据再登记到事件，展示文件名和摘要；处理中可勾选同对象已完成工单，并按处置动作创建 KB-05、MCP-03、AG-05 或 KEY-02 草稿。插件禁用不从事件新建，仍由 PLG-04 告警创建。验收见 `tests/browser/event-attachment-browser.mjs`，单号 EVT-01-e181306e-7b58-4910-a7a5-273b243f7935。脱敏联调样例见 [联调样例.md](联调样例.md)。原始产品指标和真实处置仍待能力组联调。
