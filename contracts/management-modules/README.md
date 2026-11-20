# 管理端内部跨模块契约（`management-modules`）

本文档约束 `management/` 内部各业务模块（`management/modules/*`）、公共平台能力（`management/platform/*`）、公共 UI（`management/shared-ui/*`）与应用装配层（`management/app/*`）之间的调用边界、注册协议和数据写入归属。

## 1. 强制依赖方向

```
management/app/ (装配层：路由分发、页面壳、注册中心)
   ├──> management/modules/*/public.{server.mjs,web.ts}
   ├──> management/platform/*/public.{server.mjs,web.ts}
   └──> management/shared-ui/*

management/modules/<A>/
   ├──> management/modules/<B>/public.{server.mjs,web.ts}  (禁止循环依赖，禁止引用私有目录)
   ├──> management/platform/*/public.{server.mjs,web.ts}
   └──> management/shared-ui/*

management/platform/<P>/   ──> 仅允许依赖 runtime/* 或其他 platform/*/public.*（禁止反向依赖 modules/app）
management/shared-ui/      ──> 仅允许依赖 React/第三方图标/shared-ui 自身（禁止依赖 modules/app/server）
```

上述规则由 `npm run check:boundaries`（`dev/check-boundaries.mjs`）和 `tests/integration/architecture.test.mjs` 自动校验。

## 2. 模块注册协议

### 2.1 服务端模块描述符（`public.server.mjs`）

每个业务模块必须在 `public.server.mjs` 导出冻结对象 `moduleServer`：

| 字段 | 必填 | 类型与约束 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | `string`（须与目录名一致，全局唯一） | 模块标识，装配层启动时防重名 |
| `routes` | 是 | `readonly { match(path): boolean, handle(services): Promise<void> }[]` | 模块自有 HTTP 路由，经 `management/app/server/module-registry.mjs` 统一分发 |
| `workflows` | 否 | `{ submissions: Record<TicketType, Handler>, approvals: Record<TicketType, Handler> }` | 接入公共工单提交与审批引擎的业务规则 |
| `executionContexts` | 否 | `Record<TicketType, ({cap, headers, query, resourceId, ticketType, action}) => Promise<object>>` | `/api/execution-contexts` 专用依据处理器 |
| `executionCandidates` | 否 | `Record<TicketType, (cap, headers, input) => Promise<object>>` | `/api/execution-candidates` 专用候选分页处理器 |

### 2.2 前端模块描述符（`public.web.ts`）

每个业务模块必须在 `public.web.ts` 通过 `defineWebModule(...)` 导出冻结对象 `moduleWeb`（类型见 `management/shared-ui/module-contracts.ts`）：

| 字段 | 必填 | 类型与约束 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | `string`（须与目录名一致，全局唯一） | 模块标识 |
| `views` | 否 | `Partial<Record<View, (props: ModuleViewProps) => ReactNode>>` | 挂载到主壳层 `App.tsx` 的业务视图 |
| `ticketForms` | 否 | `Record<TicketType, (props: TicketFormProps) => ReactNode>` | 挂载到手工申请页 `WorkOrderPages.tsx` 的工单表单 |

## 3. 数据写入归属规则

| 台账 / 存储 | 唯一写入归属 | 其他模块访问方式 |
| --- | --- | --- |
| `applications`（业务申请与审批台账） | `app/server/application-workflows.mjs`（公共工单引擎） | 各模块通过注册的 `submissions`/`approvals` 返回变更片段；监控/审计仅读快照 |
| `tickets`（执行与文件交付台账） | `platform/delivery` + 装配层交付控制 | `skills`、`overview`、`audit`、`events` 仅只读读取 |
| `reported-events`（安全事件台账） | `modules/events`（以及注入的紧急告警升级回调） | `overview`、`audit` 仅只读读取 |
| 账号变更台账 | `modules/accounts` | `overview`、`audit`、`events` 仅按角色裁剪只读 |
| 身份主体与会话（`identity` / `demo-sessions`） | `platform/identity` | 所有模块只读查询或消费会话快照 |
| 草稿与工单类型版本（`drafts` / `types`） | `platform/workflow` | 所有模块通过 `platform/workflow/public.*` 调用 |
| 上传包扫描与证据附件（`intake` / `evidence`） | `platform/packages`、`platform/evidence` | 业务模块只存引用 ID，恢复时重新读取核验 |

## 4. 变更与兼容性协作流程

1. **模块内部修改**（仅改动 `management/modules/<name>/{web,server,tests}/`）：模块负责人独立开发，自测 `npm run test:module -- <name>` 与 `npm run check:boundaries` 即可合入。
2. **调整模块公开入口**（改动 `public.server.mjs` / `public.web.ts` 导出签名）：必须检查全部引用方，更新 [模块清单](module-manifest.md) 并运行全量 `npm run check`。
3. **调整公共基础 / 装配层 / 共享契约**（改动 `management/app/`、`management/platform/`、`management/shared-ui/`、`contracts/`）：需由对应维护人评审，并运行全量 `npm run check` 及受影响模块的浏览器回归。
