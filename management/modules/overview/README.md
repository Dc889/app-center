# 统一概览模块（`overview`）

## 职责范围

- 负责管理端首页统一概览页（`/api/overview`），聚合待办数量、告警级别与对象排行、最近操作记录，以及能力侧 `/internal/v1/overview-summary` 观测快照。
- 严格区分未采集（`null`）、数据已过期与真实零值，按会话角色裁剪权限（运维不读取 `ACC-` 台账）。

## 目录与公开入口

- `web/`：`Overview.tsx`
- `server/`：`overview.mjs`、`routeOverview.mjs`
- `public.web.ts`：导出 `Overview` 与 `moduleWeb`（注册 `overview` 视图）
- `public.server.mjs`：导出汇总服务与 `moduleServer`（注册 `/api/overview` 路由）
- `tests/`：本模块集成测试与浏览器验收脚本

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`。
- 禁止依赖：`management/app/*`、`capability/*` 及任何业务模块私有实现。
- 数据归属：本模块仅做只读汇总，不拥有可写业务台账。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- overview
npm.cmd run test:browser -- overview
```
