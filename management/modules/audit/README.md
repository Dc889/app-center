# 审计追踪模块（`audit`）

## 职责范围

- 负责管理审计（`/api/audit`）、审计追踪六区块汇总报表（`/api/audit-report`）及同权限双表导出（`/api/audit-report/export`）。
- 按会话角色、历史组织和 `ACC-` 边界过滤本地台账与能力侧 `observations?view=audit`，区分未采集、数据已过期与真实零值。

## 目录与公开入口

- `web/`：`AuditLog.tsx`
- `server/`：`audit-report.mjs`、`routeAudit.mjs`
- `public.web.ts`：导出 `AuditLog` 与 `moduleWeb`（注册 `audit` 视图）
- `public.server.mjs`：导出服务端报表方法与 `moduleServer`（注册 `/api/audit`、`/api/audit-report`、`/api/audit-report/export`）
- `tests/`：本模块集成测试与浏览器验收脚本

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`。
- 禁止依赖：`management/app/*`、`capability/*` 及任何业务模块内部实现。
- 数据归属：本模块为严格只读审计消费者，不写入业务工单或身份台账；读取管理台账通过装配层注入的只读快照集合完成。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- audit
npm.cmd run test:browser -- audit
```
