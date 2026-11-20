# 密钥生命周期模块（`keys`）

## 职责范围

- 负责密钥创建（`KEY-01`）与密钥轮换/撤销（`KEY-02`）的申请表单、字段规则、审批处理与安全裁剪。
- 负责独立密钥登记候选分页查询（`/api/key-registrations`）及执行上下文核验（`KEY-02`）。
- 密钥明文禁止落草稿、列表或工单台账，仅支持一次性领取流程。

## 目录与公开入口

- `web/`：`KeyCreation.tsx`、`KeyLifecycle.tsx`、`KeyRegistrationPicker.tsx`
- `server/`：`key-creation.mjs`、`key-lifecycle.mjs`、`key-registrations.mjs`、`routeKeyRegistrations.mjs`、`submitKEY01~02.mjs`、`approveKEY01~02.mjs`、`workflows.mjs`
- `public.web.ts`：导出前端组件与 `moduleWeb`（注册 `KEY-01`/`KEY-02` 申请表单）
- `public.server.mjs`：导出公开校验/查询接口与 `moduleServer`（注册 `/api/key-registrations`、`KEY-01/02` 工作流与 `KEY-02` 执行上下文）
- `tests/`：本模块集成测试与浏览器验收脚本

## 依赖与数据边界

- 允许依赖：`management/platform/*/public.*`、`management/shared-ui/*`、`runtime/*`。
- 禁止依赖：`management/app/*`、`capability/*` 及其他业务模块私有实现。
- 数据归属：工单公共状态由工作流引擎维护，本模块负责密钥申请、审批参数冻结与登记核验规则。

## 运行与验收命令

```powershell
npm.cmd run check:boundaries
npm.cmd run test:module -- keys
npm.cmd run test:browser -- keys
```
