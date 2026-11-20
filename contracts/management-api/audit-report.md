# 审计追踪汇总与导出

## 权限与接口

- `GET /api/audit-report`：返回审计追踪六个区块所需的真实汇总、趋势、类型分布、操作者排行、管理审计分页与访问审计分页。
- `GET /api/audit-report/export?table=management|access`：按与 `/api/audit-report` 完全相同的权限和筛选条件导出全量管理审计或访问审计 JSON 数组（不受 `page` / `accessPage` 分页截断）。
- `GET /api/audit`：保持原有兼容行为，按同一角色和历史组织规则返回管理台账审计明细。

只允许有效且未受限的运维人员和系统管理员访问 `/api/audit-report` 与 `/api/audit-report/export`；普通用户、未登录、停用或受限账号返回 `403`。管理端在读取能力观测前后均核验会话身份与人员修订，若查询期间调岗、改角色、改名或受限则返回 `403 ACTOR_SESSION_CHANGED`。

行级权限先于汇总、排序、分页和导出：
- **运维人员**：仅可见历史记录组织等于本人当前组织且非 `ACC-*`（账号类配置工单）的审计；不读取账号台账；组织不明、工单类型不明（执行/交付来源）或 `ACC-*` 的记录一律隐藏。
- **系统管理员**：可见当前网络分区全部审计，含 `ACC-*` 及历史缺组织记录。

## 查询参数与校验

- `range`：`today`（按 `Asia/Shanghai` 当日零点至今）、`1h`、`24h`（默认）、`7d`。
- `from` / `to`：可选 UTC 时间戳（左闭右开 `[from, to)`），必须满足 `from < to`、跨度不超过 31 天、`to <= now + 5000ms`。
- `source`：可选，限定为 `申请草稿`、`事件办理`、`类型版本`、`执行工单`、`能力执行`、`Skill交付`、`广场Web`、`外部API`。
- `q`：可选关键字，最长 200 字符，匹配白名单可见文本字段。
- `page`、`accessPage`：正整数（默认 1）；`limit`：1–100 整数（默认 50）。
- 参数非法返回 `400 INVALID_AUDIT_QUERY` / `400 INVALID_PAGE` / `400 INVALID_EXPORT`。

## 来源区分、去重与采集状态

1. **管理台账来源**（`申请草稿`、`事件办理`、`类型版本`、`执行工单`）：读取管理端 SQLite 台账历史，保留操作当时的组织、角色、人员 ID、身份修订、身份依据、来源 IP、前后摘要、结果与错误码；绝不改写历史快照。
2. **能力侧观测来源**（按既有 `GET /internal/v1/observations?view=audit&source=...&from=...&to=...&limit=100[&cursor=...]` 协议分页读取，服务端覆盖可信身份头）：
   - `execution`（能力执行）：仅结算终态 `success/failure`，忽略轮询 `pending/unknown`，按 `executionId` 去重取最新结果。
   - `skill_delivery`（Skill交付）：仅结算终态 `success/failure`，忽略领取中/传输中断/轮询/待回执，按 `executionId` 去重，排除重复下载与重复回执。
   - `external_api`（外部API）：忽略 `pending`，兼容 `keyRegistrationId`/`registrationId`，按 `callerOrg`/`auditOrg` 做运维组织隔离但输出列中账户名和用户组织固定为 `null`；有 `runId` 时按 `runId` 去重，URL 去除查询串。
   - `dify_run`（广场Web）：仅保留 `callerKind === 'web'` 且非 `pending` 的记录；若 `runId` 已出现在可见 `external_api` 记录中则排除，阻断双来源运行记录重复计数；同源有 `runId` 时按 `runId` 去重；输出列中密钥字段固定为 `null`。
3. **缺采集、过期与损坏降级**：
   - 未接入、404/501/超时、游标循环、超页未完、同 `(source, eventId)` 冲突、时间越界或 `asOf` 未来超 5 秒的来源降级为 `not_collected`（计数为 `null`，不填 `0`）。
   - 上游标明 `stale` 或 `now - asOf > 5 分钟` 标为 `stale`（保留真实 `asOf` 与数据，前端标注数据已过期）。
   - `目录变更` 当前无独立观测源，固定返回 `availability: "not_collected", count: null`，不用工单动作推算。
   - API 执行、下载、访问不从工单动作数量推算；当仅筛选其他来源时，未采集的能力来源仍保持 `not_collected`（`count: null`），不伪装成 `0`。

## 六个区块的数据口径

1. **审计量卡组（5 张卡）**：`workflow` 返回当前筛选窗口内本地管理动作数及 `Asia/Shanghai` 今日本地动作数 `todayCount`；`api`、`catalog`、`download`、`access` 返回各自采集状态、`asOf` 与去重计数（未采集为 `null`）。
2. **审计事件趋势**：`7d` 或跨度大于 24 小时采用 1 小时桶，其余采用 5 分钟桶；标注 `partialBoundaryBuckets`。未采集序列每桶为 `null`，不画零曲线。
3. **操作类型分布**：固定顺序 `创建 / 提交 / 审批 / 执行 / 补偿 / 下载 / 访问 / 其他`。`创建/提交/审批/补偿/其他` 仅来自管理台账；`执行/下载/访问` 仅来自对应能力观测源，未采集为 `null`。
4. **操作者排行**：仅统计当前筛选范围内管理台账的人工角色（`user/operator/admin`），按次数降序、账户名升序取前 20；后台任务（`system`）及运行调用不计入排行。
5. **管理审计表**：角色列仅呈现 `系统管理员`、`运维人员`、`用户`、`system_event`（缺失标未采集），同时保留历史身份快照字段。
6. **访问审计表**：严格白名单投影，不输出模型中心身份和 `traceId`，不透传未知凭证字段。
