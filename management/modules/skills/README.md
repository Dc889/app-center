# Skill 管理模块（`skills`）

## 职责范围

- 负责 Skill 上架（`SKL-01`）、版本变更再审（`SKL-02`）、下载申请与交付取消办理（`SKL-03`）及下架审批（`SKL-04`）。
- 负责 Skill 监控页（`/api/skill-monitor`，下载趋势、组织排行、结算流水与生效目录指标）以及 `SKL-04` 下架上下文核验。

## 目录与公开入口

- `web/`：`SkillMonitor.tsx`、`SkillPublication.tsx`、`SkillDownloadApplication.tsx`、`SkillCancellationDesk.tsx`、`SkillVersions.tsx`
- `server/`：`skill-monitor.mjs`、`skill-withdrawal.mjs`、`routeSkillMonitor.mjs`、`submitSKL01/04.mjs`、`approveSKL01/04.mjs`、`workflows.mjs`
- `public.web.ts`：导出前端组件与 `moduleWeb`（注册 `skills` 视图及 `SKL-01`/`SKL-03` 表单；`SKL-02`/`SKL-04` 待二期从 `app/web` 跨业务表单拆入）
- `public.server.mjs`：导出公开服务与 `moduleServer`（注册 `/api/skill-monitor`、`SKL-01`/`SKL-04` 工作流及 `SKL-04` 执行上下文）
- `tests/`：本模块集成测试与浏览器验收脚本

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`。
- 禁止依赖：`management/app/*`、`capability/*` 及其他业务模块私有实现。
- 数据归属：Skill 上架与下架业务规则归属本模块；文件交付互斥锁与回执事务由 `platform/delivery` 维护，安装包上传扫描由 `platform/packages` 托管。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- skills
npm.cmd run test:browser -- skills
```

2026-11-19 管理端已完成 Skill 仓库：`SkillWarehouse.tsx` 登记 `skillWarehouse`，用户只显示可下载项和成功下载排行，运维可见下架且不能下载；版本选择沿用 `SkillVersions`，下载走 SKL-03 并在领取后核对回执。验收见 `tests/browser/skill-warehouse-browser.mjs`。SKL-01/SKL-02 模拟对端页面提交见 `tests/browser/skill-publication-browser.mjs`，单号 SKL-01-f14a0697-3394-4f92-80c8-cbffabcae061、SKL-02-74e17471-7151-41b6-897b-b89f2242c091。脱敏联调样例见 [联调样例.md](联调样例.md)。真实仓库执行仍待能力组联调。
