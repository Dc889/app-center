# 账号配置与集成模块（`accounts`）

## 职责范围

- 负责账号生命周期工单（`ACC-01` 开通/变更、`ACC-02` 停用/恢复）的申请、审批、提交回调、失败查证与安全解锁。
- 负责账号与集成监控页（`/api/account-monitor`，三方账号映射核对、同步作业台账、接口健康探针）。
- 权限边界：账号类工单仅限系统管理员办理，运维人员仅查看本组织监控且敏感 `ACC-` 单号自动脱敏。

## 目录与公开入口

- `web/`：`AccountApplication.tsx`、`AccountDesk.tsx`、`AccountMonitor.tsx`
- `server/`：`account-workflows.mjs`、`account-recovery.mjs`、`account-monitor.mjs`、`routeAccountMonitor.mjs`
- `public.web.ts`：导出前端组件与 `moduleWeb`（注册 `accounts` 视图及 `ACC-01`/`ACC-02` 申请表单）
- `public.server.mjs`：导出服务端接口与 `moduleServer`（注册 `/api/account-monitor` 路由）
- `tests/`：本模块集成测试与浏览器验收脚本

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`。
- 禁止依赖：`management/app/*`、`capability/*` 及其他业务模块的内部实现文件。
- 数据归属：账号工单台账由本模块维护，身份主体主目录由 `platform/identity` 维护；监控只读聚合并按会话角色与组织裁剪。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- accounts
npm.cmd run test:browser -- accounts
```
