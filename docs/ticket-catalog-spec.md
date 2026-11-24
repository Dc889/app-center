# AI 运营管理平台（app-center）工单规格与子系统适配契约说明书

> **文档定位**：本文档定义平台所有工单的业务规则、表单字段、审核条件、审核调用接口，以及**执行器与纳管子系统之间的标准化适配契约**。
> - **内网部署前提**：平台整体运行于隔离内网，审核重点聚焦**内网权限边界、跨组织/跨密级数据合规、版本指纹防篡改（防审 A 发 B）与全链路审计留痕**。
> - **智能体发布底座**：`KB-02`（知识库分享申请）、`PLG-01`（插件上架申请）、`MCP-01`（MCP 上架登记）是智能体发布（`AG-02`）的三大基础审核基准。即使智能体中的专属组件未进入公共仓库，在发布智能体时也必须复用对应的审查条件与接口完成合规核验。
> - **统一资源权限表约定**：所有资源（知识库、插件、MCP、Skill、智能体）在上架申请时选定的开放范围（全员 / 指定组织 / 指定人员 / 组织边界），在审批生效时统一写入平台**资源权限表**（`POST /internal/v1/permissions/grants`）；后续其他账户在仓库浏览或发起使用/绑定/安装/下载工单时，统一调用权限表校验接口（`POST /internal/v1/permissions/check`）判断该账户是否有权申请该资源。
> - **新子系统纳管约定**：后续纳管任何第三方或自研子系统（如新版 Dify、FastGPT、Coze、自研知识库等），只需在「纳管子系统」（`/subsystems`）登记实例，并通过独立 Connector 实现本文档第 6C 节规定的标准适配接口，即可零改动复用对应工单流程。

---

## 第零部分：多级组织机构定义与配置规范（1～6 级）

> **设计目的**：全平台所有工单中的**目标组织（`targetOrgs`）**、**组织边界（`boundaryOrgs`）**、**人员归属（`org`）**以及**统一资源权限表**均依赖组织机构体系。由于当前各层级具体真实机构名称尚未最终确定，平台先定义 **1～6 级可扩展组织机构模型**，使用**占位关键字 + 层级序号**进行填充，并提供**前端组织机构配置列表页**供系统管理员后期随时手动填写真实名称与配置映射关系。

### 0.1 六级组织机构层级与编号规则
- 支持 **一级至六级（Level 1 ～ Level 6）** 树形组织架构，每一级均可配置多个机构节点。
- **层级序号规则**：采用 `<层级>.<序号>` 格式填充（例如一级若配置 10 个机构，则序号依次为 `1.1` ～ `1.10`；二级为 `2.1` ～ `2.N`，其余层级以此类推）。
- **占位关键字规则**：在填入真实名称前，统一使用占位关键字标识（如 `ORG_L1_1` / `一级机构-1.1`），确保数据模型、权限校验与工单流转可提前运行，后期替换为真实名称时底层稳定 ID（`orgId`）不变、历史工单与审计记录不断链。

| 层级 | 层级编号 | 序号填充规则 | 占位关键字示例（未填真实名称前） | 上级归属 | 配置容量示例 |
| --- | --- | --- | --- | --- | --- |
| **一级机构** | `L1`（1 级） | `1.1` ～ `1.N` | `ORG_L1_1`（一级机构-1.1） ～ `ORG_L1_10`（一级机构-1.10） | 根节点（无上级） | 例：配置 10 个即 `1.1` ～ `1.10` |
| **二级机构** | `L2`（2 级） | `2.1` ～ `2.N` | `ORG_L2_1`（二级机构-2.1） ～ `ORG_L2_N`（二级机构-2.N） | 归属某一级机构（如 `1.1`） | 按需配置多个 |
| **三级机构** | `L3`（3 级） | `3.1` ～ `3.N` | `ORG_L3_1`（三级机构-3.1） ～ `ORG_L3_N`（三级机构-3.N） | 归属某二级机构（如 `2.1`） | 按需配置多个 |
| **四级机构** | `L4`（4 级） | `4.1` ～ `4.N` | `ORG_L4_1`（四级机构-4.1） ～ `ORG_L4_N`（四级机构-4.N） | 归属某三级机构（如 `3.1`） | 按需配置多个 |
| **五级机构** | `L5`（5 级） | `5.1` ～ `5.N` | `ORG_L5_1`（五级机构-5.1） ～ `ORG_L5_N`（五级机构-5.N） | 归属某四级机构（如 `4.1`） | 按需配置多个 |
| **六级机构** | `L6`（6 级） | `6.1` ～ `6.N` | `ORG_L6_1`（六级机构-6.1） ～ `ORG_L6_N`（六级机构-6.N） | 归属某五级机构（如 `5.1`） | 按需配置多个 |

### 0.2 组织机构节点标准数据模型
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 稳定机构 ID | `orgId` | 是 | 系统生成唯一稳定标识（不可变） | 作为工单、权限表、审计记录的底层外键，机构改名或映射变更时历史数据不断链 | `org-l1-01` |
| 层级 | `level` | 是 | 整数 `1` ～ `6` | 标识该机构处于第几级组织，用于层级筛选、边界继承与审批范围判定 | `1` |
| 层级序号 | `code` | 是 | `<level>.<index>`（同级唯一） | 直观展示同级排序位置，初期作为统一占位编号 | `1.1`、`1.10`、`2.3` |
| 占位关键字 | `placeholderKey` | 是 | 唯一关键字（如 `ORG_L1_1`） | 未确定真实机构名时的标准占位符，便于导入、脚本初始化与规则引用 | `ORG_L1_1` |
| 机构显示名称 | `name` | 否（后期填写） | 非空文本，≤ 120 字；留空时前端自动回退展示占位关键字 | 后期由管理员在前端配置列表中填写的真实机构名称 | `（留空显示 ORG_L1_1，后期填真实名称）` |
| 上级机构 ID | `parentId` | 条件必填 | `level = 1` 时为空；`level = 2~6` 时必填上一级 `orgId` | 维护 1～6 级树形上下级隶属关系，用于组织边界校验（上级可覆盖下级） | `org-l1-01` |
| 外部映射编码 / 别名 | `externalCode` / `aliases[]` | 否 | 字符串 / 字符串数组 | 映射外部人事系统、统一认证（LDAP/OA）或子系统（Dify/RAGFlow）中的组织编码与历史曾用名 | `externalCode: "EXT_001"`, `aliases: ["旧部门名"]` |
| 启用状态 | `enabled` | 是 | 布尔值（默认 `true`） | 支持停用已撤销机构（停用后不可在新工单中选择，但历史审计可查） | `true` |

### 0.3 前端「组织机构配置列表」页面与接口规范
- **访问权限**：仅 **系统管理员（`admin`）** 可见与编辑（入口建议 `/organizations`，置于侧边栏「纳管子系统」旁）。
- **核心页面功能**：
  1. **按层级筛选与树形/列表视图**：顶部提供 `全部 / 一级(1.x) / 二级(2.x) / 三级(3.x) / 四级(4.x) / 五级(5.x) / 六级(6.x)` 筛选标签页；
  2. **批量生成占位节点**：支持按层级快速初始化占位节点（例如一键生成一级 `1.1` ～ `1.10`）；
  3. **在线填写真实名称与映射**：支持在列表中直接编辑每条记录的 `机构显示名称`、`上级机构`、`外部映射编码` 与 `历史别名`，保存后全平台工单选择器与权限表实时生效；
  4. **改名无损迁移**：当把占位关键字（如 `ORG_L1_1`）改为真实名称时，自动保留原占位符/旧名到 `aliases[]`，所有已提交工单与资源权限表自动识别映射，无需人工修订历史数据。
- **后端标准接口**：
  - `GET /api/organizations?level=1..6`：查询 1～6 级组织机构配置列表与树形结构；
  - `POST /api/organizations`：新增单条机构节点或批量生成某层级占位序号（如 `1.1`～`1.10`）；
  - `PUT /api/organizations/:orgId`：手动填写/修改真实机构名称、上级归属、启停状态及外部映射；
  - `POST /api/organizations/mappings`：维护外部系统组织 ID/名称与平台 `orgId` 的手动映射关系。

---

## 第一部分：三大基础组件上架申请工单

---

## 1. `KB-02` 知识库分享申请

### 1.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `KB-02` |
| **工单名称** | 知识库分享申请 |
| **所属对象** | 知识库（Knowledge） |
| **办理模式** | 人工审批（含逐文档指纹复核） |
| **业务场景** | 将已完成纳管同步（`KB-01`）的个人知识库，经模型合规核对与逐文档安全审查后，开放给指定范围使用；支持「共享目录 / 指定组织 / 指定人员 / 随应用发布」四种作用域（其中「随应用发布」不进入公共知识库目录，仅绑定指定智能体生效） |
| **执行器动作名** | `publish_dataset` |
| **涉及子系统** | 知识库子系统 Connector（当前：RAGFlow / Dify；可扩展：其他实现本契约的知识库引擎） + 内部 `executor/datasets` 知识库目录台账 |

### 1.2 角色与权限
- **发起人**：普通用户、运维人员、系统管理员（**仅限知识库所有者本人发起**，系统强制校验 `所有者账户名 === 当前登录账号`）
- **审核人**：运维人员（`operator`，限管辖组织范围）、系统管理员（`admin`）
- **权限边界**：禁止代他人分享知识库；若选择「随应用发布」，关联的智能体也必须属于申请人有权发布的范围

### 1.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标知识库 | `resourceId` + `workspaceId` | 是 | 从本人已纳管知识库选择器选取（禁止手填 ID） | 定位待审查的具体知识库及其所属租户/工作区；由系统选择器带出可防止伪造 ID 或越权分享他人知识库 | `resourceId: "kb-police-01"`, `workspaceId: "889e9574..."` |
| 来源系统 | `fields.sourceSystem` | 是 | 枚举：`RAGFlow` / `Dify`（可扩展新子系统标识） | 标识该知识库底层所在的知识库引擎，提交时必须与执行器实时读取的来源系统一致，决定执行器路由到哪个 Connector | `RAGFlow` |
| 目录展示名称 | `fields.name` | 是 | 非空文本，≤ 120 字 | 审核通过后在知识库目录或应用依赖详情中展示的规范名称，便于使用方识别 | `警务研判核心知识库` |
| 目录简介 | `fields.description` | 是 | 非空文本 | 说明知识库收录范围、数据来源与适用业务场景，是审核人判断内容边界的重要依据 | `收录近三年刑侦研判规范、典型案例与办案指引` |
| 目录标签 | `fields.tags` | 否 | 字符串数组 | 用于知识库分类检索与运营统计 | `["刑侦", "研判规范"]` |
| 分享方式 | `fields.shareMode` | 是 | 枚举：`共享目录` / `指定组织` / `指定人员` / `随应用发布` | 决定审查通过后的生效作用域；选 `随应用发布` 时不进入公共知识库目录，仅随指定智能体生效且随应用下架失效 | `随应用发布` |
| 目标组织 | `fields.targetOrgs` | 条件必填 | `shareMode = 指定组织` 时必填，1～100 个组织 | 明确允许检索/绑定该知识库的组织白名单，防止内网跨部门越权访问 | `["业务一部", "平台运营组"]` |
| 目标人员 | `fields.targetAccounts` | 条件必填 | `shareMode = 指定人员` 时必填，1～100 个账号 | 用于小范围定向授权，仅名单内人员可使用 | `["chen.yu", "zhou.min"]` |
| 组织边界 | `fields.boundaryOrgs` | 是 | 1～100 个组织 | 划定该知识库传播的最高组织上限边界；后续任何绑定或应用发布均不得突破此边界 | `["业务一部", "平台运营组"]` |
| 关联智能体 | `fields.relatedAppId` + `relatedWorkspaceId` | 条件必填 | `shareMode = 随应用发布` 时必填，通过应用选择器带出 | 将该知识库的生效范围锁定在指定智能体，不对外暴露独立知识库入口 | `relatedAppId: "683b2452..."` |
| 数据密级 | `fields.classification` | 是 | 枚举：`公开` / `内部` / `敏感` / `机密` | 标识知识库文档最高密级，供审核人把关与后续智能体发布取策略交集 | `内部` |
| 业务线 | `fields.businessLine` | 是 | 非空文本 | 标识业务归属，用于分条线治理与审计归类 | `刑侦` |
| 有效期截止时间 | `fields.expiresAt` | 否 | ISO 8601 时间字符串，必须晚于当前时间 | 为临时专项知识库设置自动失效时间，避免过期资料长期滞留共享态 | `2026-12-31T23:59:59Z` |

### 1.4 状态流转
`草稿（可选）` → `待受理` → `执行中` → `待结果确认` → `已完成`  
（审批驳回 → `已驳回`；执行失败 → `执行失败`，可查证后重试执行或终止工单）

### 1.5 审核环节、审核条件与审核调用接口

#### A. 审核环节（两重文档安全校验 + 人工审批 + 结果确认）
1. **前置校验一：平台关键词自动安全扫描（词库可配置，用后即焚不留存源文件）**
   - **文档拉取与零留存约束**：来源知识库子系统必须提供**文档传输接口**（`GET /connector/v1/datasets/:datasetId/documents/:documentId/content`），由执行器按文档 ID 逐篇拉取文件流到平台内存/临时扫描区进行扫描；**扫描结束后立即清除临时数据，平台绝不留存任何知识库文档源文件或正文副本**（仅持久化扫描结论、命中词摘要与内容 SHA-256）。
   - 平台使用**可配置的敏感关键词词库**对拉取到的每一篇文档正文进行扫描（词库由系统管理员维护，支持增删改与分级；典型示例关键词如：`绝密`、`机密`、`内部涉密`、`严禁外传`、`身份证号`、`银行卡号`、`密钥明文`、`口令明文` 等）。
   - 命中禁用关键词的文档自动标为「不通过」，并记录命中的关键词与文档位置。
2. **前置校验二：子系统文档安全审核状态查询（调子系统标准接口）**
   - 执行器逐篇向来源知识库子系统调用**文档安全审核状态查询接口**，确认子系统自身是否已对该文档完成安全审核（平台不干预子系统内部怎么管、怎么审，只要子系统明确认可即可）。
   - **子系统未提供该接口时的降级记录**：若来源子系统（例如原生 RAGFlow / Dify）未提供此接口，系统不直接报错卡死，而是在每篇文档的审查明细与工单记录中明确标注 **`子系统未明确该文档已通过安全审核`**，提醒平台审核人重点人工把关。
3. **阶段一：平台人工审批（批准 / 驳回）**
   - 运维人员或系统管理员查看：① 关键词扫描结果、② 子系统安全审核确认状态（或“子系统未提供接口”的明确提示）、③ 模型合规状态，做出批准或驳回决定。
4. **阶段二：执行前防篡改复核 + 结果确认**
   - 系统在提交与执行前会比对每篇文档的内容哈希（SHA-256，即“文档指纹”，仅用于后台防篡改——防止审批期间或审批后有人把已过审文档偷偷替换成其他内容）；执行完成后审核人确认归档。

#### B. 审批通过必须满足的条件与具体判断方式（**`AG-02` 随应用审查知识库时复用完全相同的第 3～8 项条件**）
| 序号 | 审核项 | 具体满足条件 | 系统如何判断 | 不满足时的拦截行为 |
| --- | --- | --- | --- | --- |
| 1 | **工单状态与并发锁** | 状态为 `待受理` 且 `revision` 与数据库一致 | 比对工单记录 `status` 与 `revision` | `409 INVALID_TRANSITION` / `VERSION_CONFLICT` |
| 2 | **有效期有效** | 若填写 `expiresAt`，审批时刻必须尚未过期 | `Date.parse(expiresAt) > Date.now()` | `409 AUTHORIZATION_EXPIRED` |
| 3 | **归属与上下文一致** | `来源系统`、`所有者账户名`、`workspace/tenant ID` 与源知识库完全匹配 | 比对 `datasetContext` 返回的实时字段与提交参数 | `403 DATASET_CONTEXT_MISMATCH` |
| 4 | **模型目录核对通过** | 知识库所使用的嵌入模型（Embedding）与重排/检索模型均在平台已核准模型目录内 | 检查实时快照 `live.modelVerified === true` | `409 MODEL_NOT_VERIFIED` |
| 5 | **平台关键词自动扫描通过** | 知识库内每一篇文档经平台**可配置敏感词库**扫描均未命中禁用关键词（如 `绝密`、`机密`、`密码明文` 等） | `live.documents.every(d => d.keywordScan.verdict === '通过')` | `409 DOCUMENT_REVIEW_FAILED`（返回命中词明细） |
| 6 | **子系统文档安全审核确认** | 调用子系统文档安全状态接口，对每篇文档核验状态：<br>• `approved`（子系统已确认安全审核通过）→ 直接认可；<br>• `rejected` / `pending`（子系统未通过或待审）→ 拦截；<br>• `unsupported`（子系统无此接口）→ 在记录中明确标注**「子系统未明确文档已通过安全审核」**，须由平台审核人人工复核确认 | 调用 Connector `POST /connector/v1/datasets/:datasetId/documents/security-status`；若返回 `501` 或 `capabilities.documentSecurityCheck === false`，自动记为 `unsupported` 并写入审计标注 | 返回 `rejected`/`pending` 时拦截 `409 SUBSYSTEM_DOC_AUDIT_FAILED`；`unsupported` 时需人工确认方可放行 |
| 7 | **文档内容未中途篡改（后台防篡改）** | 从提交到审批再到执行前，知识库内文档清单与每篇文档的 SHA-256 内容哈希未发生漂移 | 后台自动比对 `manifestSnapshotId` 与 `manifestSha256` 是否与提交时一致 | `409 STALE_SNAPSHOT`（防止审 A 发 B） |
| 8 | **关联智能体未漂移** | 当 `shareMode = 随应用发布` 时，目标智能体仍存在且归属/版本未变化 | 审批时重调 `applicationTarget(...)` 与提交时冻结目标 `same()` 比对 | `409 STALE_APPLICATION_TARGET` |

#### C. 审核阶段调用的接口清单
| 调用方 → 被调方 | HTTP 接口 | 用途与关键入参 / 出参 |
| --- | --- | --- |
| 前端 → 管理端 | `POST /api/applications/transition` | 审核人提交审批意见与批准/驳回/结果确认；入参：`{ ticketNo, revision, action, confirmations: [{ documentId, verdict: "通过"\|"不通过" }], note }` |
| 管理端 → 执行器（提交/审批前复核） | `GET /internal/v1/execution-contexts/dataset-review?resourceId=...&workspaceId=...` | 聚合返回：`modelVerified`、文档清单快照、每篇文档的 **关键词扫描结果（`keywordScan`）** 与 **子系统安全审核状态（`subsystemSecurityAudit`: `approved`/`rejected`/`pending`/`unsupported` + 明确标注说明）** |
| 执行器 → 子系统 Connector（文档传输拉取） | `GET /connector/v1/datasets/:datasetId/documents/:documentId/content` | 执行器流式拉取单篇文档正文到平台进行关键词扫描；**扫描完成后立即释放，平台不保留源文件** |
| 执行器 → 子系统 Connector（文档安全查询） | `POST /connector/v1/datasets/:datasetId/documents/security-status` | 按 `documentIds[]` 向子系统查询每篇文档是否已通过子系统自身安全审核；若子系统无此接口返回 `501` / `unsupported`，由执行器在记录中标注「子系统未明确文档已通过安全审核」 |
| 管理端 → 执行器（随应用发布时） | `GET /internal/v1/execution-contexts/application-target?purpose=dataset_publication&workspaceId=...&appId=...` | 核验关联智能体的合法性与归属 |
| 执行器 → 管理端（执行前拉取冻结审批结论） | `GET /internal/v1/approved-inputs/:executionId` 及 `GET /internal/v1/approved-inputs/:executionId/documents?cursor=0&limit=50` | 执行器分页回调读取已冻结的审批记录与前置条件，防止执行层绕过审批 |

### 1.6 执行器与子系统标准适配接口契约（新子系统纳管必实现）

#### A. 管理端 → 执行器（Executor）标准接口
| 调用阶段 | HTTP 接口 | 请求关键参数 | 响应关键字段 |
| --- | --- | --- | --- |
| 1. 选知识库候选 | `GET /internal/v1/resources?kind=ragflow_dataset\|dify_dataset` | Header：`x-account`, `x-org`, `x-role` | `items[]: { resourceId, name, source, workspaceId }` |
| 2. 拉取审查上下文 | `GET /internal/v1/execution-contexts/dataset-review` | `resourceId`, `workspaceId` | `{ fields, documents[], manifestSnapshotId, manifestSha256, modelVerified, preconditions }` |
| 3. 下发执行 | `POST /internal/v1/executions` | `{ executionId, ticketNo, ticketType: "KB-02", action: "publish_dataset", resourceId, account, payload: { decisionRef } }` | `{ executionId, status, result: { ok, resultId, version, sha256, details } }` |
| 4. 异常查证 | `GET /internal/v1/executions/:executionId` | `executionId` | 按 `executionId` 幂等返回执行状态与结果 |

#### B. 执行器 → 内部知识库目录台账
- 写入 `openLedger('datasets')`（落库 MySQL `app_center_exec`），更新知识库目录状态为 `已发布`、写入 `policyRef`、`shareMode`、`relatedAppId`、`manifestSnapshotId`、`manifestSha256`、`revision + 1`。

#### C. 执行器 → 纳管知识库子系统 Connector 标准适配接口（**新子系统接入必实现**）
| 必选 / 声明能力 | 标准化语义 | 必须返回的标准化字段 | 当前 RAGFlow / Dify 映射示例 |
| --- | --- | --- | --- |
| **1. 知识库列表查询（必选）** | 按租户/工作区分页列举知识库 | `resourceId`、`name`、`ownerAccount`、`scopeId`（tenantId/workspaceId）、`embeddingModel` | RAGFlow: `GET /api/v1/datasets`<br>Dify: `GET /console/api/datasets` |
| **2. 文档清单与哈希读取（必选）** | 返回指定知识库下全部有效文档及其内容哈希（供防篡改比对） | `documents[]: { documentId, name, sha256, sizeBytes, parseStatus }`、`embeddingModel`、`manifestSnapshotId`、`manifestSha256` | RAGFlow: `GET /api/v1/datasets/:id/documents`<br>Dify: `GET /console/api/datasets/:id/documents` |
| **3. 文档内容流式传输（必选）** | `GET /connector/v1/datasets/:datasetId/documents/:documentId/content`<br>向执行器传输单篇文档文件流或纯文本，供平台执行关键词扫描；**扫描完成后立即销毁，平台不留存源文件** | 二进制文件流（`application/octet-stream` / 原 MIME）或提取后的 UTF-8 正文流 + `Content-Length` / `x-content-sha256` | RAGFlow: `GET /api/v1/datasets/:id/documents/:docId`<br>Dify: 文档下载/分段文本拉取接口 |
| **4. 文档安全审核状态查询（推荐实现；无则显式声明不支持）** | `POST /connector/v1/datasets/:datasetId/documents/security-status`<br>输入 `documentIds[]`，由子系统确认每篇文档是否已通过子系统自身安全审核 | `items[]: { documentId, status: "approved"\|"rejected"\|"pending"\|"unsupported", auditedBy?, auditedAt?, note? }`；若子系统无此能力返回 `501` 并在 meta 中声明 `documentSecurityCheck: false`，平台自动标注「子系统未明确文档已通过安全审核」 | 原生 RAGFlow 0.22.1 / Dify 1.7.1 暂不支持（自动标注为 `unsupported`）；自研或二开知识库系统实现本接口后可直接采信 |
| **5. 元信息与探活（必选）** | 声明产品类型、适配版本与是否支持文档安全状态接口 | `{ product, adapterVersion, configured, capabilities: { documentSecurityCheck: boolean } }` | `GET /connector/v1/meta` + `GET /healthz` |

### 1.7 审计、权限表写入与生效结果
- 全程写入不可篡改 `history` 审计链，并保存每篇文档的关键词扫描结果与子系统安全确认状态（含“子系统未明确文档已通过安全审核”标注）。
- **权限表同步（供后续申请工单鉴权）**：审批生效时，将本次选定的开放范围（`shareMode`、`targetOrgs`、`targetAccounts`、`boundaryOrgs`、`expiresAt`）写入平台统一资源权限表（`POST /internal/v1/permissions/grants`）；后续其他账户发起知识库绑定申请（`KB-03`）时，统一查权限表判定其是否具备申请资格。
- 若为 `共享目录`/`指定组织`/`指定人员`：知识库对权限表允许范围内的用户开放绑定；若为 `随应用发布`：不进入公共知识库列表，仅绑定目标智能体生效且随应用下架自动失效。

---

## 2. `PLG-01` 插件上架申请

### 2.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `PLG-01` |
| **工单名称** | 插件上架申请 |
| **所属对象** | 插件（Plugin） |
| **办理模式** | 人工审批（含本地插件安全审核接口自动审查 + 人工复核） |
| **业务场景** | **运维人员或普通用户**上传 Dify 标准插件代码包（`.difypkg`，本质为包含 `manifest.yaml`、`requirements.txt` 与 Python 源码的 zip 归档包），先调用本地插件代码审核接口完成安全、资源消耗与依赖合规审查，再由运维/管理员审批上架至「插件仓库」（仅上架入库，不自动安装到任何工作区） |
| **执行器动作名** | `publish_package` |
| **涉及子系统** | 平台本地插件代码安全审核服务（`scanners/plugin-package`） + 内部 `repo-plugin` 插件仓库 + 平台统一资源权限表（后续安装 `PLG-03` 时才调用 Dify Plugin Daemon） |

### 2.2 角色与权限
- **发起人（两种场景统一走同一套代码包审核）**：
  - **普通用户上传**：开发者上传自研或引入的 `.difypkg` 代码包发起上架申请；
  - **运维人员上传**：运维人员批量或定向引入官方/内部 `.difypkg` 代码包发起上架申请；
  - 两种入口均严格隔离上传件归属（仅本人可绑定自己上传的 `intakeId`），且包身份（`uniqueIdentifier`、`name`、`version`）强制以解包扫描解析的 `manifest.yaml` 为准，绝不采信手填字段。
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）（运维自提场景建议由另一名运维/管理员复核）。

### 2.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 插件代码包预检单号 | `fields.intakeId` | 是 | 由平台上传并调用本地插件审核接口返回的 `intakeId` | 关联已完成解包解析与代码安全审核的 `.difypkg` Python 代码包，禁止未审包进入审批 | `intake-plg-9a3f21` |
| 插件简介 | `fields.description` | 是 | 非空文本 | 说明该插件的功能用途、调用目标与注意事项，展示在插件仓库卡片中 | `对接内网 vLLM/OneAPI 的 OpenAI 兼容模型接入插件` |
| 公开安装方式 | `fields.installAccess`（映射 `公开方式`） | 是 | 枚举：`公开免审安装`（`instant`）/ `申请审批安装`（`approval`） | 控制插件入库后，权限范围内的用户发起安装（`PLG-03`）时是即办还是审批 | `公开免审安装` |
| 升级策略 | `fields.upgradePolicy` | 否 | 枚举：`逐个工单升级` / `允许直接升级`（默认 `逐个工单升级`） | 控制后续插件发布新版本（`PLG-02`）后，已安装工作区升级是否需要重新审批 | `逐个工单升级` |
| 开放范围 | `fields.scope` | 是 | 枚举：`all`（全员）/ `orgs`（指定组织）/ `accounts`（指定人员） | 决定哪些账户有权在插件仓库看到并申请安装该插件，生效后写入平台**资源权限表** | `orgs` |
| 目标组织 / 人员 | `fields.targetOrgs` / `targetAccounts` | 条件必填 | 按 `scope` 必填，1～100 项 | 写入资源权限表的白名单组织或人员清单 | `["业务一部", "平台运营组"]` |
| 组织边界 | `fields.boundaryOrgs` | 是 | 1～100 个组织 | 限定该插件在仓库中可见与可申请安装的最高组织边界 | `["业务一部", "平台运营组"]` |
| 数据密级 | `fields.classification` | 是 | 枚举：`公开` / `内部` / `敏感` / `机密` | 声明插件可处理数据的最高密级，用于与智能体密级匹配校验 | `内部` |

### 2.4 状态流转
`上传 .difypkg 代码包并调用本地审核接口（intake）` → `待受理` → `执行中` → `待结果确认` → `已完成`  
（审批驳回 → `已驳回`；执行失败 → `执行失败`）

### 2.5 审核环节、审核条件与审核调用接口

#### A. 审核环节（本地插件代码审核接口 + 人工审批 + 结果确认）
1. **前置自动审核（调用平台本地插件审核接口 `POST /internal/v1/scanners/plugin-package`）**：
   - 对上传的 `.difypkg`（Python 代码包，含 `manifest.yaml`、`requirements.txt` 与 Python 源码）自动执行可扩展规则审查，当前定义四大核心检查域（后续只需扩充该审核接口即可平滑演进，无需改动工单流程）：
     1. **代码安全性审查**：扫描 Python 源码是否存在后门、木马、恶意命令执行（如非受控 `os.system` / `subprocess` / `eval` / `exec` / 动态反序列化）、硬编码敏感凭据或隐蔽内网探测行为；
     2. **资源消耗与稳定性审查**：静态排查是否存在死循环、未释放文件/Socket 句柄、无上限全局缓存增长等易导致内存泄漏、CPU/磁盘耗尽、浪费服务器硬件资源的缺陷；
     3. **Python 依赖文件合规审查**：解析 `requirements.txt` / `pyproject.toml`，检查① 所有依赖版本号是否严格固定（如 `requests==2.32.3`，禁止不锁版本或宽泛 `>=`/`*` 范围）；② 依赖包及插件自身版本是否存在已知高危漏洞（CVE）或已知严重 Bug 黑名单版本；
     4. **包结构与清单一致性审查**：校验 `manifest.yaml` 完整合法（`uniqueIdentifier`、`name`、`version`、入口点、声明权限），核对代码实际使用的权限未超出清单声明。
2. **阶段一：人工审批（批准 / 驳回）**：审核人查看本地插件审核接口生成的分项审查报告（安全/资源/依赖/清单），并**必须显式裁定「跨应用使用权限（`externalAllowed`）」为 `允许` 或 `禁止`**。
3. **阶段二：结果确认（确认完成）**：执行器将插件包写入 `repo-plugin` 并同步权限表后进入 `待结果确认`，审核人确认归档。

#### B. 审批通过必须满足的条件与具体判断方式（**`AG-02` 核查插件依赖时以此为基准**）
| 序号 | 审核项 | 具体满足条件 | 系统如何判断 | 不满足时的拦截行为 |
| --- | --- | --- | --- | --- |
| 1 | **工单状态与并发锁** | 状态为 `待受理` 且 `revision` 与数据库一致 | 比对工单记录 `status` 与 `revision` | `409 INVALID_TRANSITION` / `VERSION_CONFLICT` |
| 2 | **代码安全审查通过** | 本地插件审核接口返回 `checks.codeSecurity.passed === true`（无后门、无恶意命令执行、无凭据硬编码） | 读取 `intake.scan.checks.codeSecurity` | `409 UPLOAD_NOT_APPROVED`（展示风险代码行与原因） |
| 3 | **资源与稳定性审查通过** | 本地插件审核接口返回 `checks.resourceSafety.passed === true`（无明显内存泄漏、死循环、句柄泄漏风险） | 读取 `intake.scan.checks.resourceSafety` | `409 UPLOAD_NOT_APPROVED` |
| 4 | **Python 依赖锁定与缺陷审查通过** | `checks.dependencyAudit.passed === true`（`requirements.txt` 所有依赖均固定精确版本，且无已知 Bug/高危 CVE 版本） | 读取 `intake.scan.checks.dependencyAudit` | `409 UPLOAD_NOT_APPROVED`（列出未锁定或有漏洞的依赖项） |
| 5 | **包体指纹与清单未漂移** | 审批时与执行前，上传件的 `packageMetadata`、`sha256`、`sizeBytes` 与提交工单时冻结值一致 | 比对 `same(current.packageMetadata, previous.snapshot.data.packageMetadata)` 及 `sha256 / sizeBytes` | `409 STALE_SNAPSHOT` |
| 6 | **显式裁定跨应用使用权限** | 审核人必选 `externalAllowed` 为 `允许` 或 `禁止` | `check(['允许', '禁止'].includes(input.externalAllowed))` | `400 EXTERNAL_PERMISSION_REQUIRED` |

#### C. 审核阶段调用的接口清单
| 调用方 → 被调方 | HTTP 接口 | 用途与关键入参 / 出参 |
| --- | --- | --- |
| 前端 → 管理端（上传阶段） | `POST /api/uploads/plugin`（流式上传 `.difypkg`） | 接收插件代码包并触发本地审核接口，返回 `{ intakeId, status, sha256, packageMetadata, scan }` |
| 执行器 → 本地插件审核服务（**定义化审核接口**） | `POST /internal/v1/scanners/plugin-package` | 入参：`{ intakeId, filename, sha256, contentStream }`；出参：`{ verdict: "passed"\|"failed", packageMetadata, checks: { codeSecurity, resourceSafety, dependencyAudit, manifestConsistency }, findings[] }`（后续新增检查项仅需扩充此接口） |
| 前端 → 管理端（审批阶段） | `POST /api/applications/transition` | 审核人发起批准/驳回/结果确认；批准必传 `{ ticketNo, revision, action: "批准", externalAllowed: "允许"\|"禁止", note }` |
| 管理端 → 执行器（提交/审批前复核） | `GET /internal/v1/intakes/plugin/:intakeId` | 复核上传件仍处于 `ready` + `scan.verdict === 'passed'` 且指纹未变化 |
| 执行器 → 管理端（执行前拉取冻结审批结论） | `GET /internal/v1/approved-inputs/:executionId` | 获取冻结的 `intakeId`、`审批版本指纹`、`公开方式`、`发布者账户名` |
| 管理端/执行器 → 权限表服务（生效落库） | `POST /internal/v1/permissions/grants` | 写入该插件的开放范围（`scope / targetOrgs / targetAccounts / boundaryOrgs`），供后续用户发起 `PLG-03` 安装申请时鉴权 |

### 2.6 执行器与子系统标准适配接口契约（新子系统纳管必实现）

#### A. 管理端 → 执行器（Executor）标准接口
| 调用阶段 | HTTP 接口 | 请求关键参数 | 响应关键字段 |
| --- | --- | --- | --- |
| 1. 查询扫描就绪件 | `GET /internal/v1/intakes/plugin/:intakeId` | Header：`x-account`, `x-org`, `x-role` | `{ intakeId, status: "ready", sha256, sizeBytes, scan: { verdict: "passed" }, packageMetadata: { uniqueIdentifier, name, version, permissions } }` |
| 2. 下发执行 | `POST /internal/v1/executions` | `{ executionId, ticketNo, ticketType: "PLG-01", action: "publish_package", resourceId: catalogId, account, payload: { decisionRef } }` | `{ executionId, status, result: { ok, resultId, version, sha256, details } }` |
| 3. 异常查证 | `GET /internal/v1/executions/:executionId` | `executionId` | 幂等返回执行状态与结果 |

#### B. 执行器 → 平台内部仓库标准接口（`repo-plugin`）
| HTTP 接口 | 请求关键参数 | 响应关键字段 |
| --- | --- | --- |
| `POST /internal/v1/plugins` | `{ resourceId, uniqueIdentifier, name, version, sha256, contentBase64, installAccess: "instant"\|"approval", ownerAccount }` | `{ resourceId, uniqueIdentifier, version, revision, status: "approved" }` |

#### C. 执行器 → 纳管子系统 Connector 标准适配接口（**新子系统接入必实现**）
> `PLG-01` 属于「入平台仓库」阶段，不直接写目标子系统；但若新纳管子系统要支持后续插件安装（`PLG-03`）与智能体插件依赖核验（`AG-02`），其 Connector 必须提供以下标准能力：

| 必选能力 | 标准化语义 | 必须返回的标准化字段 | 当前 Dify 映射示例 |
| --- | --- | --- | --- |
| **1. 包元数据解析适配** | 若新子系统插件包格式与 `.difypkg` 不同，需提供包格式解析器 | `{ uniqueIdentifier, name, version, permissions[] }` | Dify `manifest.yaml` 解析 |
| **2. 工作区已装插件列举** | 查询目标工作区当前已安装的插件列表与实例 ID | `items[]: { installationId, uniqueIdentifier, version, enabled }` | Dify Plugin Daemon `GET /plugin/:tenantId/management/list` |
| **3. 插件包安装 / 卸载** | 接收仓库标准包字节流并在指定工作区安装或卸载 | `{ installationId, status }` | Dify Plugin Daemon install/uninstall API |

### 2.7 审计、权限表写入与生效结果
- 全程记录上传人（用户或运维）、包体 SHA-256、本地插件审核接口报告引用、审核人及 `externalAllowed` 裁定结果（普通用户仅看到裁剪后的合规结论，不暴露内部扫描细节）。
- **权限表同步（供后续申请工单鉴权）**：生效时将插件的开放范围写入平台统一资源权限表（`POST /internal/v1/permissions/grants`）；后续其他账户在插件仓库浏览或发起 `PLG-03` 安装申请时，统一查权限表判定其是否有权申请。
- 生效后插件出现在「插件仓库」（`/plugin-warehouse`），状态为 `approved`，等待有权限的用户按工作区发起安装（`PLG-03`）。

---

## 3. `MCP-01` MCP 上架登记

### 3.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `MCP-01` |
| **工单名称** | MCP 上架登记 |
| **所属对象** | MCP 服务（Model Context Protocol） |
| **办理模式** | 人工审批（含技术注册预检 + 强制安全审查意见） |
| **业务场景** | 将内网中已完成技术注册与连通探活的 MCP 服务（如时间服务、文档检索服务、内部业务查询服务等），经安全复核与权限策略审定后登记上架到「MCP 仓库」 |
| **执行器动作名** | `register_mcp` |
| **涉及子系统** | 平台 MCP 技术注册与探活模块（`executor/mcp`） + 内部 `repo-mcp` 仓库（后续绑定 `MCP-02` 时同步到 Dify 等应用开发子系统） |

### 3.2 角色与权限
- **发起人**：普通用户、运维人员、系统管理员（需先完成或选择已就绪的技术注册 ID）
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）
- **权限边界**：普通页面与审批表单**不保存、不展示手填的内网服务端 URL 原文**，只传递和冻结经过技术注册生成的 `registrationId` 与 `urlFingerprint`（SHA-256），防止内网敏感地址泄露与审批后篡改指向

### 3.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 技术注册单号 | `resourceId`（对应 `registrationId`） | 是 | 从已完成技术注册的候选列表中选取（禁止手填 URL） | 关联已在能力端完成内网地址登记、协议探测与工具清单采集的技术注册记录，保证上架对象真实可达 | `reg-mcp-internal-clock` |
| MCP 服务名称 | `fields.name` | 是 | 非空文本，≤ 120 字 | 上架后在 MCP 仓库展示的清晰中文业务名称 | `内网标准时间与工作日历 MCP` |
| MCP 用途说明 | `fields.purpose` | 是 | 非空文本 | 说明该 MCP 提供的业务能力、读取的数据源与适用场景，供审核人评估安全风险 | `为各业务智能体提供统一内网标准时间查询与法定工作日计算能力` |
| 绑定方式 | `fields.bindingAccess`（映射 `绑定方式`） | 是 | 枚举：`免审绑定`（`instant`）/ `审批绑定`（`approval`） | 决定入库后用户在 MCP 仓库发起绑定（`MCP-02`）时是即办生效还是逐次审批 | `免审绑定` |
| 组织边界 | `fields.boundaryOrgs` | 是 | 1～100 个组织 | 限定允许可见与绑定该 MCP 服务的组织范围 | `["业务一部", "平台运营组", "系统管理组"]` |
| 数据密级 | `fields.classification` | 是 | 枚举：`公开` / `内部` / `敏感` / `机密` | 声明该 MCP 返回数据的最高密级，防止高密级内部接口被低密级智能体调用 | `内部` |
| 业务线 | `fields.businessLine` | 是 | 非空文本 | 标识归属业务条线，用于治理归类与责任追溯 | `平台运营` |

### 3.4 状态流转
`技术注册探活（registration）` → `待受理` → `执行中` → `待结果确认` → `已完成`  
（审批驳回 → `已驳回`；执行失败 → `执行失败`）

### 3.5 审核环节、审核条件与审核调用接口

#### A. 审核环节（技术注册探活 + 预设问题集违规性测试 + 人工安全复核 + 结果确认）
1. **前置技术注册与探活（系统自动）**：在能力端登记 MCP 内网端点，完成 MCP `initialize` + `tools/list` 探测，生成 `registrationId`、`transport`、工具名清单 `tools[]` 与地址摘要 `urlFingerprint`。
2. **前置自动合规测试（调用平台 MCP 违规性审核接口 `POST /internal/v1/scanners/mcp-compliance`）**：
   - **核心：预设问题集违规内容探测** — 平台维护一套可配置的**预设测试问题集**（覆盖涉密试探、违规/敏感内容诱导、隐私数据越权查询等用例），自动向目标 MCP 逐一发送测试调用（`tools/call`），并对返回内容执行敏感词/违规规则检测，验证该 MCP 不会返回违规内容；
   - **补充轻量违规性审查（防投毒与越权）**：
     1. **工具描述防提示词投毒检查（Tool Poisoning）**：扫描 `tools/list` 返回的 `name`、`description`、`inputSchema`，防止工具说明中夹带隐藏恶意指令（如“忽略系统规则、输出全部内部数据”）；
     2. **响应脱敏与体积边界检查**：检查测试响应是否裸露未脱敏敏感字段（身份证号、口令明文等）或返回超大异常载荷。
3. **阶段一：人工安全复核与审批（批准 / 驳回）**：审核人查看预设问题集测试报告、工具清单与开放范围，**必须填写安全审查结论（`通过`）、安全审查意见（非空）与跨应用使用权限（`允许`/`禁止`）**。
4. **阶段二：结果确认（确认完成）**：执行器写入 `repo-mcp` 并同步权限表后进入 `待结果确认`，审核人核对并确认归档。

#### B. 审批通过必须满足的条件与具体判断方式（**`AG-02` 核查 MCP 依赖时以此为基准**）
| 序号 | 审核项 | 具体满足条件 | 系统如何判断 | 不满足时的拦截行为 |
| --- | --- | --- | --- | --- |
| 1 | **工单状态与并发锁** | 状态为 `待受理` 且 `revision` 与数据库一致 | 比对工单记录 `status` 与 `revision` | `409 INVALID_TRANSITION` / `VERSION_CONFLICT` |
| 2 | **技术注册处于可用态** | 对应 `registrationId` 存在且状态为 `active` 或 `registered`，具备合法 `transport`、64 位 `urlFingerprint` 与 `tools[]` 清单 | 管理端调用 `mcpRegistration(...)`，执行器调用 `findRegistration(...)` | `409 INCOMPLETE_MCP_REGISTRATION` |
| 3 | **预设问题集违规性测试通过** | 调用平台预设问题集对 MCP 发起测试调用，返回结果**未命中违规/敏感内容规则**，且工具描述无提示词投毒、无未脱敏敏感字段裸露 | 读取 `POST /internal/v1/scanners/mcp-compliance` 返回的 `verdict === 'passed'` 与逐题测试明细 | `409 MCP_COMPLIANCE_FAILED`（展示触发违规的测试题与返回片段） |
| 4 | **URL 指纹与工具清单未漂移** | 从提交到审批再到执行前，技术注册的 `urlFingerprint` 与 `tools[]` 清单未发生任何变化 | 审批时校验 `same(current.data, previous.snapshot.data)`；执行前校验 `reg.urlFingerprint === frozenFingerprint` | `409 STALE_SNAPSHOT`（防止审 A 连 B） |
| 5 | **安全审查结论与意见必填** | `securityVerdict === '通过'`，且 `securityNote` 为非空文本（≤ 4000 字） | `check(input.securityVerdict === '通过' && input.securityNote.trim())` | `400 SECURITY_REVIEW_REQUIRED` |
| 6 | **显式裁定跨应用使用权限** | 审核人必选 `externalAllowed` 为 `允许` 或 `禁止`；为 `允许` 时策略授予 `['invoke_mcp', 'bind']` | `check(['允许', '禁止'].includes(input.externalAllowed))` | `400 SECURITY_REVIEW_REQUIRED` |

#### C. 审核阶段调用的接口清单
| 调用方 → 被调方 | HTTP 接口 | 用途与关键入参 / 出参 |
| --- | --- | --- |
| 执行器 → 平台 MCP 合规测试服务（**定义化审核接口**） | `POST /internal/v1/scanners/mcp-compliance` | 入参：`{ registrationId, testSuiteId? }`；自动执行预设问题集 `tools/call` + 工具描述防投毒检测；出参：`{ verdict: "passed"\|"failed", totalCases, passedCases, violations: [{ caseId, prompt, matchedRule, snippet }], toolPoisoningFindings[] }` |
| 前端 → 管理端 | `POST /api/applications/transition` | 审核人提交安全审查结论与批准/驳回/结果确认；批准必传 `{ ticketNo, revision, action: "批准", securityVerdict: "通过", securityNote: "...", externalAllowed: "允许"\|"禁止" }` |
| 管理端 → 执行器（提交/审批前复核） | `GET /internal/v1/resources/mcp_registration/:registrationId` | 实时复读技术注册详情、工具清单、合规测试报告与 `urlFingerprint`（不返回内网 URL 明文） |
| 执行器 → 管理端（执行前拉取冻结审批结论） | `GET /internal/v1/approved-inputs/:executionId` | 读取冻结的 `技术注册ID`、`URL指纹`、`MCP名称`、`绑定方式`、`policyRef` |
| 管理端/执行器 → 权限表服务（生效落库） | `POST /internal/v1/permissions/grants` | 写入该 MCP 的开放范围与组织边界，供后续其他账户发起 `MCP-02` 绑定申请时查表鉴权 |

### 3.6 执行器与子系统标准适配接口契约（新子系统纳管必实现）

#### A. 管理端 → 执行器（Executor）标准接口
| 调用阶段 | HTTP 接口 | 请求关键参数 | 响应关键字段 |
| --- | --- | --- | --- |
| 1. 选技术注册候选 | `GET /internal/v1/resources?kind=mcp_registration` | Header：`x-account`, `x-org`, `x-role` | `items[]: { resourceId, name, status, data: { registrationId, transport, urlFingerprint, tools[] } }` |
| 2. 读单条注册快照 | `GET /internal/v1/resources/mcp_registration/:registrationId` | 同上 | 同上（隐藏明文 URL） |
| 3. 下发执行 | `POST /internal/v1/executions` | `{ executionId, ticketNo, ticketType: "MCP-01", action: "register_mcp", resourceId: catalogId, account, payload: { decisionRef } }` | `{ executionId, status, result: { ok, resultId, version, sha256: urlFingerprint, details } }` |
| 4. 异常查证 | `GET /internal/v1/executions/:executionId` | `executionId` | 幂等返回执行状态与结果 |

#### B. 执行器 → 平台内部仓库标准接口（`repo-mcp`）
| HTTP 接口 | 请求关键参数 | 响应关键字段 |
| --- | --- | --- |
| `POST /internal/v1/mcps` | `{ resourceId, name, transport, urlFingerprint, toolNames[], registrationId, bindingAccess: "instant"\|"approval", ownerAccount }` | `{ resourceId, status: "active", revision: 1, urlFingerprint }` |

#### C. 执行器 → 纳管子系统 / MCP Server 标准适配接口（**新子系统接入必实现**）
| 必选能力 | 标准化语义 | 必须返回的标准化字段 | 当前映射示例 |
| --- | --- | --- | --- |
| **1. MCP Server 标准协议握手与工具列举** | 被纳管的 MCP Server 需支持标准 JSON-RPC 2.0 探活与工具清单声明 | `initialize` 返回 `{ protocolVersion, serverInfo }`；`tools/list` 返回 `{ tools: [{ name, description, inputSchema }] }` | 本机真实 MCP Server（`http://127.0.0.1:4390/mcp/time` 等） |
| **2. 应用平台工作区 MCP 绑定/解绑（供 `MCP-02`/`MCP-03` 复用）** | 新纳管的应用开发平台 Connector 需提供按工作区绑定/解绑 MCP 及列举当前绑定的接口 | `{ bindingId, serverUrl, status }` | Dify MCP Server Binding API |

### 3.7 审计、权限表写入与生效结果
- 管理端生成不可变 `policyRef`，全链路记录 `registrationId`、`urlFingerprint`、预设问题集测试报告、安全审查结论与安全意见，且对普通用户始终隐藏内网真实 URL。
- **权限表同步（供后续申请工单鉴权）**：生效时将该 MCP 的开放范围与组织边界写入平台统一资源权限表（`POST /internal/v1/permissions/grants`）；后续其他账户在 MCP 仓库浏览或发起 `MCP-02` 绑定申请时，统一调用 `POST /internal/v1/permissions/check` 判断申请资格。
- 生效后该 MCP 出现在「MCP 仓库」（`/mcp-warehouse`），状态为 `active`，可供权限范围内用户在工作区发起绑定（`MCP-02`）或在智能体发布（`AG-02`）中作为合规依赖通过核验。

---

## 第二部分：Skill、工具与智能体全生命周期工单

---

## 4. `SKL-01` Skill 上架申请

### 4.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `SKL-01` |
| **工单名称** | Skill 上架申请 |
| **所属对象** | Skill 技能包 |
| **办理模式** | 人工审批（含压缩包安全与敏感词扫描） |
| **业务场景** | 开发者或运维人员上传 Skill 技能包（`.zip`，含 `SKILL.md` 及配套模板/脚本），经平台完整性与安全扫描通过后提交审批，上架至「Skill 仓库」供权限范围内用户下载使用 |
| **执行器动作名** | `publish_skill` |
| **涉及子系统** | 平台包上传与安全扫描服务（`intake` + 敏感词词库） + 内部 `repo-skill` 仓库 + 平台统一资源权限表 |

### 4.2 角色与权限
- **发起人**：普通用户、运维人员、系统管理员（**仅限绑定本人上传且扫描通过的 `intakeId`**，上传件按账号严格隔离）
- **审核人**：运维人员（`operator`，限管辖组织范围）、系统管理员（`admin`）
- **权限边界**：禁止绑定他人上传包；严禁未通过扫描的压缩包发起审批

### 4.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 上传预检单号 | `fields.intakeId` | 是 | 由 `POST /api/uploads/skill` 返回 | 关联已完成完整性校验、脚本安全检查与敏感词扫描的 Skill 压缩包 | `intake-skl-4b2c19` |
| Skill 名称 | `fields.name` | 是 | 非空文本，≤ 120 字 | 上架后展示在 Skill 仓库列表与详情页的规范名称 | `案情研判报告生成 Skill` |
| 版本号 | `fields.version` | 是 | 语义化版本号（如 `1.2.0`） | 标识本次发布的版本，支持后续版本演进与历史版本追溯 | `1.2.0` |
| 简介说明 | `fields.description` | 是 | 非空文本 | 说明技能包解决的业务问题、目录结构与使用前提 | `标准案情要素抽取、时间线梳理与研判报告结构化生成技能包` |
| 开放范围 | `fields.scope` | 是 | 枚举：`all` / `orgs` / `accounts` | 决定哪些账户有权在 Skill 仓库看到并下载该技能包，生效后写入**资源权限表** | `orgs` |
| 目标组织 | `fields.targetOrgs` | 条件必填 | `scope = orgs` 时必填，1～100 个组织 `orgId` | 写入资源权限表的白名单组织清单（引用第零部分 1～6 级组织） | `["ORG_L1_1", "ORG_L2_1"]` |
| 目标人员 | `fields.targetAccounts` | 条件必填 | `scope = accounts` 时必填，1～100 个账号 | 定向开放给指定人员下载 | `["chen.yu", "zhou.min"]` |
| 组织边界 | `fields.boundaryOrgs` | 是 | 1～100 个组织 `orgId` | 划定该 Skill 可扩散的最高组织上限边界 | `["ORG_L1_1"]` |
| 数据密级 | `fields.classification` | 是 | 枚举：`公开` / `内部` / `敏感` / `机密` | 声明技能包内模板、规则与示例数据的最高密级 | `内部` |

### 4.4 状态流转
`上传并扫描 Skill 包（intake）` → `待受理` → `执行中` → `待结果确认` → `已完成`  
（审批驳回 → `已驳回`；执行失败 → `执行失败`，可按原流水重试或终止）

### 4.5 审核环节、审核条件与审核调用接口

#### A. 审核环节（压缩包自动扫描 + 人工审批 + 结果确认）
1. **前置自动扫描（上传阶段）**：解包校验 zip 完整性、核验根目录存在 `SKILL.md`、使用平台**可配置敏感关键词词库（`CFG-02`）**扫描全部文本与脚本内容、排查恶意命令执行脚本。
2. **阶段一：人工审批（批准 / 驳回）**：运维/管理员审查扫描报告、Skill 简介、密级与开放范围，做出批准或驳回决定。
3. **阶段二：结果确认（确认完成）**：执行器写入 `repo-skill` 并同步权限表后进入 `待结果确认`，审核人确认归档。

#### B. 审批通过必须满足的条件与具体判断方式
| 序号 | 审核项 | 具体满足条件 | 系统如何判断 | 不满足时的拦截行为 |
| --- | --- | --- | --- | --- |
| 1 | **工单状态与并发锁** | 状态为 `待受理` 且 `revision` 与数据库一致 | 比对工单 `status` 与 `revision` | `409 INVALID_TRANSITION` / `VERSION_CONFLICT` |
| 2 | **上传件归属与扫描通过** | `intakeId` 归属申请人，状态 `ready`，`scan.verdict === 'passed'`（含 `SKILL.md` 存在、无恶意脚本、未命中阻断敏感词） | 调用 `readyIntake('skill', intakeId)` 校验 | `403 ACCESS_DENIED` / `409 UPLOAD_NOT_APPROVED` |
| 3 | **包体摘要未漂移** | 审批与执行前 `sha256`、`sizeBytes` 与提交时冻结值一致 | 比对 `current.sha256 === previous.snapshot.data.sha256` | `409 STALE_SNAPSHOT` |
| 4 | **无重复目录冲突** | 分配的稳定目录 ID（`skill-<uuid>`）未被占用 | `repo-skill` 校验 `!findItem(resourceId)` | `409 SKILL_ALREADY_EXISTS` |

#### C. 审核阶段调用的接口清单
| 调用方 → 被调方 | HTTP 接口 | 用途与关键入参 / 出参 |
| --- | --- | --- |
| 前端 → 管理端（上传阶段） | `POST /api/uploads/skill` | 流式上传 Skill 压缩包并触发扫描，返回 `{ intakeId, status, sha256, sizeBytes, scan }` |
| 前端 → 管理端（审批阶段） | `POST /api/applications/transition` | 审核人提交批准/驳回/结果确认 |
| 管理端 → 执行器（复核） | `GET /internal/v1/intakes/skill/:intakeId` | 审批前复核上传件状态与 `sha256` 未漂移 |
| 执行器 → 管理端（执行前回调） | `GET /internal/v1/approved-inputs/:executionId` | 读取冻结的 `intakeId`、`sha256`、`orgs` 与目录信息 |
| 管理端/执行器 → 权限表服务 | `POST /internal/v1/permissions/grants` | 写入该 Skill 的开放范围与组织边界 |

### 4.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`ticketType: "SKL-01"`, `action: "publish_skill"`, `resourceId: catalogId`）；查证 `GET /internal/v1/executions/:executionId`。
- **B. 执行器 → 内部仓库（`repo-skill`）**：`POST /internal/v1/skills`（`{ resourceId, name, version, description, sha256, filename, contentType, contentBase64, orgs, ownerAccount }`）。
- **C. 外部子系统 Connector**：Skill 为平台自建资产，不依赖外部子系统 Connector。

### 4.7 审计、权限表写入与生效结果
- 全程写入不可篡改 `history` 审计链，记录上传人、包体 SHA-256、敏感词扫描词库版本号与审核人。
- 生效后同步写入平台资源权限表；Skill 出现在「Skill 仓库」（`/skill-warehouse`），权限范围内用户可直接发起 `SKL-03` 下载。

---

## 5. `TOL-01` 工具对外使用审批

### 5.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `TOL-01` |
| **工单名称** | 工具对外使用审批 |
| **所属对象** | 自定义 API / HTTP 工具（平台内置无害工具如时间、格式转换直接豁免） |
| **办理模式** | 人工审批（强制填写安全审查意见） |
| **业务场景** | 审批工作区中配置的自定义 HTTP/API 工具是否允许在跨人/公开智能体中被调用，是平台判定工具批准状态的**唯一来源** |
| **执行器动作名** | `set_tool_approval` |
| **涉及子系统** | 应用开发子系统 Connector（当前：Dify Tools API） + 内部 `executor/tools/approvals` 台账 |

### 5.2 角色与权限
- **发起人**：普通用户、运维人员、系统管理员
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）
- **权限边界**：仅审批指定 `workspaceId` 下的具体工具配置指纹；一旦工具配置发生任何修改，旧审批自动失效

### 5.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标工具 | `resourceId` + `workspaceId` | 是 | 从工作区自定义工具选择器带出（禁止手填） | 定位具体工作区下的自定义 HTTP/API 工具，保证对象真实存在 | `resourceId: "tool-case-query"`, `workspaceId: "590f9fb3..."` |
| 使用场景 | `fields.purpose` | 是 | 非空文本 | 说明该工具调用的内网业务接口用途、请求方法（只读/写入）与返回数据范围 | `供研判智能体按案件编号查询只读基础案情字段` |
| 数据密级 | `fields.classification` | 是 | 枚举：`公开` / `内部` / `敏感` / `机密` | 声明该工具接口返回数据的最高密级，供后续智能体发布核对密级兼容性 | `内部` |
| 组织边界 | `fields.boundaryOrgs` | 是 | 1～100 个组织 `orgId` | 限定允许通过智能体调用该工具的组织边界 | `["ORG_L1_1"]` |

### 5.4 状态流转
`草稿（可选）` → `待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回` / `执行失败`）

### 5.5 审核环节、审核条件与审核调用接口

#### A. 审核环节（配置指纹提取 + 人工安全审批 + 结果确认）
1. **前置配置指纹提取**：提交时执行器拉取该工具的完整 OpenAPI/HTTP 配置（目标内网地址、HTTP Method、Header 鉴权结构、参数 Schema）并计算 `configFingerprint`（SHA-256）。
2. **阶段一：人工安全审批（批准 / 驳回）**：审核人审查接口权限、是否只读、是否存在越权风险，**必须填写安全审查意见**。
3. **阶段二：结果确认（确认完成）**：执行器写入 `tools/approvals` 台账后审核人确认归档。

#### B. 审批通过必须满足的条件与具体判断方式（**`AG-02` 核查工具依赖时以此为基准**）
| 序号 | 审核项 | 具体满足条件 | 系统如何判断 | 不满足时的拦截行为 |
| --- | --- | --- | --- | --- |
| 1 | **工单状态与并发锁** | 状态为 `待受理` 且 `revision` 一致 | 比对工单 `status` 与 `revision` | `409 INVALID_TRANSITION` / `VERSION_CONFLICT` |
| 2 | **安全审查意见必填** | `securityNote` 为非空文本（≤ 4000 字） | `check(typeof input.securityNote === 'string' && input.securityNote.trim())` | `400 SECURITY_REVIEW_REQUIRED` |
| 3 | **配置指纹未漂移** | 审批与执行前重新拉取的工具 `configFingerprint` 与提交时冻结指纹完全一致 | 比对 `current.configFingerprint === previous.snapshot.data.configFingerprint` | `409 STALE_SNAPSHOT`（配置变更使旧审批自动失效） |
| 4 | **内置工具豁免边界** | 仅对自定义 HTTP/API 工具强控；平台内置无害纯计算工具不纳入拦截 | 判断 `tool.providerType === 'api'` | 内置工具直接豁免 |

#### C. 审核阶段调用的接口清单
| 调用方 → 被调方 | HTTP 接口 | 用途与关键入参 / 出参 |
| --- | --- | --- |
| 前端 → 管理端 | `POST /api/applications/transition` | 审核人提交 `{ ticketNo, revision, action: "批准"\|"驳回"\|"确认完成", securityNote }` |
| 管理端 → 执行器（复核） | `GET /internal/v1/resources?kind=tool&workspaceId=...` | 复读工具实时配置与 `configFingerprint` |
| 执行器 → 管理端 | `GET /internal/v1/approved-inputs/:executionId` | 拉取冻结的 `configFingerprint`、`securityNote`、`boundaryOrgs` |

### 5.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "set_tool_approval"`）；查证 `GET /internal/v1/executions/:executionId`。
- **B. 执行器 → 内部台账**：写入 `openLedger('approvals')`（主键 `${workspaceId}:${resourceId}`，记录 `approved: true`、`configFingerprint`、`securityNote`、`approvedBy`）。
- **C. 新子系统 Connector 必实现**：`GET /connector/v1/workspaces/:wsId/tools/api`（返回工作区自定义 API 工具清单及 Schema/端点摘要，供计算 `configFingerprint`）。

### 5.7 审计与生效结果
- 写入不可篡改 `history` 审计链，隐藏工具密钥明文。
- 生效后该工具在 `AG-02` 智能体发布依赖核验中自动判定为合规通过（若日后工具配置变动导致指纹变化，自动失效并触发告警）。

---

## 6. ~~`AG-01` 个人智能体纳管同步~~（已取消，改为平台自动同步）

> **变更说明**：已取消手工提交 `AG-01` 工单。平台依据统一账号（`@kpw.com` 及子系统 UUID 映射）自动同步该账号在 Dify 及其他纳管应用平台下所属的全部应用资源；用户登录后发起 `AG-02` 智能体发布申请时直接从实时同步列表中选取即可，无需先提交纳管同步工单。

---

## 7. `AG-02` 智能体发布申请

### 7.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `AG-02` |
| **工单名称** | 智能体发布申请 |
| **所属对象** | 智能体（Agent） |
| **办理模式** | 人工审批（含知识库/插件/MCP/工具全量依赖联动核验） |
| **业务场景** | 将纳管应用开发平台（当前为 Dify，可扩展至其他实现适配契约的平台）中个人开发的智能体应用经审核后发布上架到「智能体仓库」 |
| **执行器动作名** | `publish` |
| **涉及子系统** | 应用开发子系统 Connector（当前：Dify；新平台实现契约即可复用） + `repo-agent` + 平台统一资源权限表 |

### 7.2 角色与权限
- **发起人**：普通用户、运维人员、系统管理员（仅限本人拥有的应用）
- **审核人**：运维人员（`operator`，限管辖组织范围）、系统管理员（`admin`）
- **权限边界**：提交与审核均核验应用归属权与工作区，禁止代他人发布

### 7.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标应用 | `resourceId` + `workspaceId` | 是 | 从平台自动同步的本人应用选择器选取（禁止手填） | 定位待发布智能体及其所属工作区，防止越权发布他人应用 | `resourceId: "683b2452..."`, `workspaceId: "590f9fb3..."` |
| 业务场景 | `fields.scenario` | 是 | 非空文本 | 说明该智能体解决的实际业务问题，是审核人评估必要性与风险的核心依据 | `用于刑侦民警快速提炼笔录要素并生成初版案情研判摘要` |
| 使用说明 | `fields.instructions` | 是 | 非空文本 | 展示在仓库详情页的使用指引，帮助其他用户正确调用 | `上传文本格式笔录，30 秒内输出时间线与关键人物清单` |
| 业务线 | `fields.businessLine` | 是 | 非空文本 | 标识应用归属条线，用于仓库分类与分条线合规统计 | `刑侦` |
| 数据密级 | `fields.classification` | 是 | 枚举：`公开` / `内部` / `敏感` / `机密` | 声明处理数据的最高敏感等级，决定与知识库/插件/MCP 策略交集 | `内部` |
| 开放使用方式 | `fields.usages` | 是 | 多选（≥1 项）：`run` / `embed` / `api` | 按最小暴露面原则精细授权（页面运行 / 嵌入网站 / API 调用） | `["run", "api"]` |
| 分享范围 | `fields.scope` | 是 | 枚举：`all` / `orgs` / `accounts` | 决定写入**资源权限表**的开放对象范围（全员 / 指定组织 / 指定人员） | `orgs` |
| 目标组织 | `fields.targetOrgs` | 条件必填 | `scope = orgs` 时必填，1～100 个组织 `orgId` | 写入资源权限表的白名单组织清单（引用第零部分 1～6 级组织） | `["ORG_L1_1", "ORG_L2_1"]` |
| 目标账号 | `fields.targetAccounts` | 条件必填 | `scope = accounts` 时必填，1～100 个账号 | 定向开放给指定人员试用或使用 | `["chen.yu", "zhou.min"]` |
| 组织边界 | `fields.boundaryOrgs` | 是 | 1～100 个组织 `orgId` | 划定最高扩散上限，后续 `AG-03` 申请不可突破此边界 | `["ORG_L1_1"]` |

### 7.4 状态流转
`草稿（可选）` → `待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回` / `执行失败`）

### 7.5 审核环节、审核条件与审核调用接口

#### A. 审核环节（快照与依赖全量核验 + 人工审批 + 结果确认）
1. **前置依赖拆解与联动审查**：执行器解析应用所绑定的全部知识库、插件、MCP 与自定义 API 工具，对尚未独立上架的专属组件自动复用第一部分对应的审查接口完成核验。
2. **阶段一：人工审批（批准 / 驳回）**：运维/管理员审查业务场景、密级、开放范围与全部组件依赖合规报告。
3. **阶段二：结果确认（确认完成）**：执行器写入 `repo-agent` 并同步资源权限表后，审核人确认归档。

#### B. 审批通过必须满足的条件与具体判断方式
| 序号 | 审核项 | 具体满足条件 | 系统如何判断 | 不满足时的拦截行为 |
| --- | --- | --- | --- | --- |
| 1 | **工单状态与并发锁** | 状态为 `待受理` 且 `revision` 一致 | 比对工单 `status` 与 `revision` | `409 INVALID_TRANSITION` / `VERSION_CONFLICT` |
| 2 | **快照未漂移** | 审批时应用 `snapshotId`、`publicationVersionId`、`catalogRevision` 与提交时冻结值一致 | 审批瞬间重调 `GET /internal/v1/resources/dify_app/:id` 比对 | `409 STALE_SNAPSHOT` |
| 3 | **知识库依赖合规** | 若关联知识库已过 `KB-02`，核验状态有效且取策略交集；若为应用专属未入公共库知识库，后台复用 `KB-02` 的**文档传输拉取 + 关键词扫描（不留存源文件）+ 子系统文档安全状态查询接口**完成审查（生成仅绑定该应用的策略，随应用下架失效） | 检查 `dependencies` 中知识库项 `approved && externalAllowed` | 触发风险告警；未确认风险拦截 `400 WARNING_DECISION_REQUIRED` |
| 4 | **插件依赖合规** | 应用引用的插件已通过 `PLG-01` 本地插件代码审核且未处于隔离/禁用/下架态，并在目标工作区存在真实安装实例 | 比对 `repo-plugin` 状态及工作区 `installations` 台账 | 同上 |
| 5 | **MCP 依赖合规** | 应用绑定的 MCP 已通过 `MCP-01` 预设问题集违规性测试、状态为 `active`、在绑定有效期内且 `urlFingerprint` 未变化 | 比对 `repo-mcp` 状态、URL 指纹与绑定台账 | 同上 |
| 6 | **自定义工具依赖合规** | 引用的自定义 HTTP/API 工具已通过 `TOL-01` 且 `configFingerprint` 未变化（内置无害工具直接豁免） | 比对 `tools/approvals` 审批态与配置指纹 | 同上 |
| 7 | **风险告警显式确认** | 若存在未通过上述核查的依赖告警，审核人必须显式勾选 `warningDecision = "确认风险并继续审批"` 并留痕 | 校验 `input.warningDecision` | `400 WARNING_DECISION_REQUIRED` |

#### C. 审核阶段调用的接口清单
| 调用方 → 被调方 | HTTP 接口 | 用途与关键入参 / 出参 |
| --- | --- | --- |
| 前端 → 管理端 | `POST /api/applications/transition` | 发起批准/驳回/结果确认（含可选 `warningDecision`） |
| 管理端 → 执行器（复核） | `GET /internal/v1/resources/dify_app/:resourceId?workspaceId=...` | 实时复读应用快照与全部 `dependencies[]` 核验结果 |
| 管理端 → 执行器（能力检查） | `GET /internal/v1/capabilities?workspaceId=...` | 校验 `AG-02 / publish` 能力分支处于 `verified` |
| 管理端/执行器 → 权限表服务 | `POST /internal/v1/permissions/grants` | 写入该智能体的开放范围与组织边界 |

### 7.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "publish"`）；查证 `GET /internal/v1/executions/:executionId`。
- **B. 执行器 → 内部仓库（`repo-agent`）**：`POST /internal/v1/agents`（写入目录条目、版本、`policyRef` 与开放方式）。
- **C. 新子系统 Connector 必实现**：① 应用分页列举；② 单应用快照、不可变发布版本号与依赖清单（知识库/插件/工具/MCP）读取；③ 元信息与探活 `GET /connector/v1/meta` + `/healthz`。

### 7.7 审计、权限表写入与生效结果
- 生成不可变 `policyRef` 并全链路写入不可篡改 `history`；普通用户在仓库侧不可见内部工单号。
- 生效后智能体出现在「智能体仓库」（`/agents`），「智能体监控」（`/agent-monitor`）中自动由“未进仓库”变为“已入库”，同时资源权限表生效供 `AG-03` 鉴权。

---

## 8. `AG-03` 智能体受限授权申请

### 8.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `AG-03` |
| **工单名称** | 智能体受限授权申请 |
| **所属对象** | 智能体（Agent） |
| **办理模式** | 按条件（权限表内免审即办 / 组织边界内受限应用走人工审批） |
| **业务场景** | 其他用户在「智能体仓库」看到标示为「待申请」的智能体后，发起使用授权申请，审批通过后获得指定方式（运行 / 嵌入 / API）的调用权 |
| **执行器动作名** | `grant_app_access` |
| **涉及子系统** | 平台统一资源权限表 + `repo-agent` |

### 8.2 角色与权限
- **发起人**：任意在目标智能体 `boundaryOrgs` 组织边界内的已登录用户
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）（免审即办场景无需人工审批）
- **权限边界**：超出智能体 `boundaryOrgs` 的账户无权发起申请；申请方式不得超出该智能体已开放的 `usages`

### 8.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标智能体 | `resourceId` | 是 | 从智能体仓库卡片点选 | 指定申请授权的仓库智能体 ID | `agent-case-summary` |
| 申请使用方式 | `fields.usages` | 是 | 多选：`run`/`embed`/`api` 的子集 | 必须包含在智能体已开放的使用方式内，防止越权申请未开放的 API | `["run"]` |
| 使用目的 | `fields.purpose` | 是 | 非空文本 | 说明业务用途，作为审核人判定授权合理性的依据 | `协助本组开展日常案件卷宗摘要整理` |
| 申请有效期 | `fields.expiresAt` | 否 | 晚于当前时间的 ISO 时间 | 临时借调/专项场景设置自动到期回收 | `2026-12-31T23:59:59Z` |

### 8.4 状态流转
- 免审即办：`提交` → `执行中` → `已完成`
- 受限审批：`提交` → `待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回`）

### 8.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. **前置查资源权限表（核心）**：调用 `POST /internal/v1/permissions/check` 核验申请人所在组织位于该智能体 `boundaryOrgs` 内（越界直接拦截 `403 OUT_OF_BOUNDARY`）；
  2. 目标智能体处于在架可用态（非 `withdrawn`）；
  3. 申请的 `usages` 全部属于智能体当前已开放方式，且 `expiresAt` 合法未过期；
  4. 受限场景需运维/管理员审批确认。
- **调用接口**：`POST /internal/v1/permissions/check` → `POST /api/applications/transition` → `POST /internal/v1/permissions/grants`。

### 8.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "grant_app_access"`）。
- **B. 执行器 → 内部仓库与权限表**：更新 `repo-agent` 授权记录并调用 `POST /internal/v1/permissions/grants` 写入该账号的定向授权。
- **C. 外部子系统 Connector**：若目标应用平台支持细粒度成员授权，可选实现工作区/应用级访问授权接口。

### 8.7 审计与生效结果
- 全链路记录申请人、授权方式、有效期与审批人；生效后该智能体在申请人「智能体仓库」中的徽标自动由「待申请」变为「可使用」。

---

## 9. `AG-04` 智能体变更再发布

### 9.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `AG-04` |
| **工单名称** | 智能体变更再发布 |
| **所属对象** | 智能体（Agent） |
| **办理模式** | 人工审批 |
| **业务场景** | 已上架（或已下架需重新上架）的智能体在子系统中修改了提示词、工作流、模型或增减了组件依赖后，提交新版本审核并覆盖仓库现行版本 |
| **执行器动作名** | `republish` |
| **涉及子系统** | 应用开发子系统 Connector + `repo-agent` + 平台统一资源权限表 |

### 9.2 角色与权限
- **发起人**：应用所有者本人
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）

### 9.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标智能体 | `resourceId` + `workspaceId` | 是 | 从本人已上架/已下架仓库智能体选取 | 定位待发布新版本的仓库条目 | `agent-case-summary` |
| 变更说明 | `fields.changeSummary` | 是 | 非空文本 | 说明本版本相对上一版本的具体改动，记入仓库版本演进历史 | `新增法律法规知识库检索节点，优化摘要输出格式` |
| 开放使用方式 / 范围 | `fields.usages` / `scope` / `targetOrgs` / `boundaryOrgs` | 是 | 同 `AG-02` 校验规则 | 支持随新版本同步调整使用方式或开放范围 | `["run", "api"]`, `scope: "orgs"` |

### 9.4 状态流转
`草稿（可选）` → `待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回` / `执行失败`）

### 9.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. **原仓库版本未并发变更**：校验 `originalCatalog` 中的 `appId / workspaceId / publicationVersionId / workflowSnapshotId / policyRef` 未被并行修改（否则 `409 STALE_SNAPSHOT`）；
  2. **新版本快照未漂移**：新版本 `publicationVersionId` 相对提交时未变化；
  3. **全量依赖重新核验**：对新版本中新增或修改的知识库、插件、MCP、自定义工具，**完整重走 `AG-02` 的依赖合规核验**（防止“初审过关、二版偷偷夹带未审组件”）；
  4. 存在风险依赖时必须显式提交 `warningDecision = "确认风险并继续审批"`。
- **调用接口**：`GET /internal/v1/catalog/agent/:id`、`GET /internal/v1/resources/dify_app/:id`、`POST /api/applications/transition`、`POST /internal/v1/permissions/grants`。

### 9.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "republish"`）。
- **B. 执行器 → 内部仓库（`repo-agent`）**：`PUT /internal/v1/agents/:resourceId`（追加新 `releases[]` 版本条目并递增 `revision`）。
- **C. 新子系统 Connector 必实现**：同 `AG-02`（应用快照、版本号与依赖清单读取）。

### 9.7 审计、权限表更新与生效结果
- 保留完整历史版本发布记录与变更说明；生效后同步刷新资源权限表，仓库卡片立即展示新版本号。

---

## 10. `AG-05` 智能体下架

### 10.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `AG-05` |
| **工单名称** | 智能体下架 |
| **所属对象** | 智能体（Agent） |
| **办理模式** | 人工审批（含影响面核验） |
| **业务场景** | 将已上架智能体从「智能体仓库」下架，立即收回普通用户可见性与调用权，并联动失效所有「随应用发布」的专属知识库授权 |
| **执行器动作名** | `withdraw_app` |
| **涉及子系统** | `repo-agent` + 平台统一资源权限表 + `executor/datasets` |

### 10.2 角色与权限
- **发起人**：应用所有者本人、运维人员、系统管理员
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）

### 10.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标智能体 | `resourceId` | 是 | 从当前在架智能体选取 | 定位待下架的仓库智能体 | `agent-case-summary` |
| 下架原因 | `fields.reason` | 是 | 非空文本 | 记入审计台账，作为运营追溯与下架公告依据 | `业务流程重构，由新版研判助手替代` |

### 10.4 状态流转
`待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回` / `执行失败`）

### 10.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. **影响依据真实有效**：提交与审批前自动拉取影响面快照（`currentAgentImpact`：当前授权用户数、近期活跃调用、关联随应用知识库清单），拒绝伪零或过期依据；
  2. 审批期间目录修订与依赖清单未漂移（正常调用量自然增长不阻断审批）。
- **调用接口**：`GET /internal/v1/execution-contexts/agent-impact?resourceId=...`、`POST /api/applications/transition`、`POST /internal/v1/permissions/revoke`。

### 10.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "withdraw_app"`）。
- **B. 执行器 → 内部仓库与权限表**：`POST /internal/v1/agents/:resourceId/withdraw` + `POST /internal/v1/permissions/revoke` + 联动置失效 `relatedAppId === resourceId` 的随应用知识库策略。
- **C. 外部子系统 Connector**：可选同步关闭子系统侧公开 WebApp 入口。

### 10.7 审计与生效结果
- 普通用户在「智能体仓库」不再可见该应用；运维/管理员仍可在仓库与审计页追溯其历史版本与下架记录；后续如需恢复可走 `AG-04` 重新审核发布。

---

## 第三部分：知识库、插件、MCP、Skill 其余生命周期与使用申请工单

---

## 11. ~~`KB-01` 个人知识库纳管同步~~（已取消，改为平台自动同步）

> **变更说明**：已取消手工提交 `KB-01` 工单。平台依据统一账号（`@kpw.com` 及子系统 UUID 映射）自动同步该账号在 RAGFlow、Dify 及其他纳管知识库平台下所属的全部知识库；用户发起 `KB-02` 知识库分享申请时直接从实时同步列表中选取即可，无需先提交纳管同步工单。

---

## 12. `KB-03` 知识库绑定申请

### 12.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `KB-03` |
| **工单名称** | 知识库绑定申请 |
| **所属对象** | 知识库（Knowledge） |
| **办理模式** | 按条件（本人知识库或资源权限表内免审即办；他人共享知识库受限绑定走人工审批） |
| **业务场景** | 将已通过 `KB-02` 审核的知识库绑定到目标 Dify 工作区或指定智能体中使用，支持三种实现方式：`RAGFlow外部知识库`、`Dify同workspace授权`、`Dify跨workspace复制` |
| **执行器动作名** | `bind_dataset` |
| **涉及子系统** | 知识库子系统 Connector（RAGFlow / Dify） + 应用开发子系统 Connector（Dify External Knowledge API） + 平台统一资源权限表 |

### 12.2 角色与权限
- **发起人**：普通用户、运维人员、系统管理员（须在目标知识库权限表允许范围内）
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）（本人即办场景免人工审批）
- **权限边界**：本人即办与绑定他人知识库的审批链路严格隔离，禁止借本人即办绕过他人知识库审批

### 12.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标知识库 | `resourceId` | 是 | 从知识库候选选择器选取（禁止手填） | 定位待绑定的已过审知识库，系统自动区分本人知识库与共享知识库 | `kb-police-01` |
| 目标工作区 | `workspaceId` | 是 | 从当前账号有权访问的 Dify 工作区选择器选取 | 指定要把知识库绑定到哪个应用开发工作区 | `590f9fb3-40a0-...` |
| 绑定实现方式 | `fields.bindingMode` | 是 | 枚举：`RAGFlow外部知识库` / `Dify同workspace授权` / `Dify跨workspace复制` | 决定执行器底层调用哪条适配路径，提交后冻结不可更改 | `RAGFlow外部知识库` |
| 关联目标智能体 | `fields.targetAppId` | 否 | 可选，目标工作区内的应用 ID | 限定该绑定仅服务于指定智能体，便于精准追踪依赖 | `683b2452-...` |
| 使用目的 | `fields.purpose` | 是 | 非空文本 | 说明绑定该知识库的业务场景，供审核与审计追溯 | `供刑侦研判助手在回答时检索权威法律法规条文` |

### 12.4 状态流转
- 即办路径：`提交` → `执行中` → `已完成`
- 审批路径：`提交` → `待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回` / `执行失败`）

### 12.5 审核环节、审核条件与审核调用接口

#### A. 审核环节
1. **前置权限表与候选核验**：提交时查资源权限表校验申请资格并冻结知识库修订号与绑定方式。
2. **阶段一：按条件分流** — 符合即办条件直接下发执行器；受限共享进入 `待受理` 由运维/管理员审批。
3. **阶段二：结果确认** — 审批路径执行完成后由审核人确认归档。

#### B. 审批通过必须满足的条件与具体判断方式
| 序号 | 审核项 | 具体满足条件 | 系统如何判断 | 不满足时的拦截行为 |
| --- | --- | --- | --- | --- |
| 1 | **资源权限表鉴权通过** | 申请人账号及所属组织在目标知识库 `KB-02` 写入的开放范围与 `boundaryOrgs` 内 | 调用 `POST /internal/v1/permissions/check` | `403 ACCESS_DENIED` |
| 2 | **知识库状态有效** | 知识库处于 `已发布`（非暂停/下架），且未过 `expiresAt` 有效期 | 比对 `datasets` 目录状态与有效期 | `409 DATASET_UNAVAILABLE` / `AUTHORIZATION_EXPIRED` |
| 3 | **修订与绑定方式未漂移** | 审批与执行前，知识库目录修订号、`bindingMode` 与文档清单摘要未变化 | 比对 `preconditions` 冻结修订与当前目录 | `409 STALE_SNAPSHOT` |
| 4 | **凭据不落单** | 绑定所需的 RAGFlow API Key 由执行器/Connector 内部注入，工单正文与审批记录绝不保存凭证明文 | 表单字段白名单过滤 | `400 INVALID_FIELDS` |

#### C. 审核阶段调用的接口清单
| 调用方 → 被调方 | HTTP 接口 | 用途与关键入参 / 出参 |
| --- | --- | --- |
| 管理端 → 权限表服务 | `POST /internal/v1/permissions/check` | 核验申请人是否有权绑定目标知识库 |
| 管理端 → 执行器（复核） | `GET /internal/v1/execution-contexts/dataset-binding?resourceId=...&workspaceId=...` | 拉取知识库状态、修订与可用绑定方式 |
| 前端 → 管理端 | `POST /api/applications/transition` | 受限路径的批准/驳回/结果确认 |

### 12.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "bind_dataset"`, `variant: bindingMode`）。
- **B. 执行器 → 内部台账**：写入绑定关系台账，关联 `resourceId`、`workspaceId`、`targetAppId`、`bindingMode`。
- **C. 新子系统 Connector 必实现**：① 外部知识库连接创建/关联接口（如 Dify `POST /console/api/datasets/external`）；② 同工作区授权或跨工作区同步接口。

### 12.7 审计与生效结果
- 记录完整绑定流水（不含任何子系统 API Key 明文）；生效后目标工作区/智能体立即可检索该知识库内容。

---

## 13. `KB-04` 知识库变更复核

### 13.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `KB-04` |
| **工单名称** | 知识库变更复核 |
| **所属对象** | 知识库（Knowledge） |
| **办理模式** | 系统自动起草 → 所有者补正提交 → 人工审批 |
| **业务场景** | 已发布的知识库在源系统（RAGFlow / Dify）中发生文档新增、修改或删除时，平台感知变更并自动起草复核工单，确保新增/修改文档重新通过安全审查 |
| **执行器动作名** | `review_dataset_changes` |
| **涉及子系统** | 知识库子系统 Connector（文档传输 + 安全状态查询） + 平台敏感词扫描服务 + `executor/datasets` |

### 13.2 角色与权限
- **发起人**：系统自动起草（`system`），由知识库所有者本人（或系统管理员）补正变更原因后正式提交
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）

### 13.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标知识库 | `resourceId` | 是 | 系统变更事件自动带出（只读） | 锁定发生文档变更的已发布知识库 | `kb-police-01` |
| 变更原因 | `fields.changeReason` | 是 | 非空文本，由所有者补正填写 | 说明为何增删改文档，供审核人判断变更合理性 | `补充 2026 年最新修订的办案程序规定文档` |
| 变更文档明细 | `snapshot.fields['变更明细']` | 系统生成 | 新增/修改/删除文档清单及 SHA-256 | 由平台比对源系统最新清单与已发布快照自动生成，不可手改 | `[{ documentId: "doc-09", changeType: "added", ... }]` |

### 13.4 状态流转
`待所有者提交` → `待受理` → `执行中` → `待结果确认` → `已完成`  
（自动扫描不通过时，同步自动创建并关联 `KB-05` 暂停分享；所有者可退回 `待补正`）

### 13.5 审核环节、审核条件与审核调用接口
- **审核条件**：
  1. **增量复用 `KB-02` 两重文档安全审查**：对所有新增与修改文档，由执行器调用子系统**文档传输接口**拉取正文并执行**可配置敏感关键词扫描（扫完即焚不留存源文件）**，同时调用**子系统文档安全审核状态查询接口**（无此接口自动标注「子系统未明确文档已通过安全审核」）；
  2. **纯删除不继承旧结论**：已删除文档自动移出清单，不继承原审批结论；
  3. **自动不通过联动 `KB-05`**：任一新增/修改文档关键词扫描不通过时，禁止人工强行改判“通过”，系统持久关联并自动触发 `KB-05` 暂停分享；
  4. **审批期间快照未漂移**：若复核期间文档再次变动，拒绝沿用旧复核（`409 STALE_SNAPSHOT`）；
  5. **不自动解冻原暂停状态**：`KB-04` 复核通过仅更新合规文档清单，不会自动解除此前因违规触发的暂停目录状态。
- **审核调用接口**：`POST /internal/v1/dataset-changes`（变更入站）、`GET /internal/v1/execution-contexts/dataset-review`、`GET /connector/v1/datasets/:id/documents/:docId/content`、`POST /connector/v1/datasets/:id/documents/security-status`、`POST /api/applications/transition`。

### 13.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "review_dataset_changes"`）。
- **B. 执行器 → 内部台账**：更新 `datasets` 最新 `manifestSnapshotId`、`manifestSha256`、`documents[]`、`revision + 1`。
- **C. 新子系统 Connector 必实现**：同 `KB-02`（文档清单与哈希读取、文档内容流式传输、文档安全状态查询）。

### 13.7 审计与生效结果
- 全程留存变更前后文档摘要对照表与扫描词库版本；若触发 `KB-05` 则双向关联工单号。

---

## 14. `KB-05` 知识库违规处置

### 14.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `KB-05` |
| **工单名称** | 知识库违规处置 |
| **所属对象** | 知识库（Knowledge） |
| **办理模式** | 人工审批（系统安全告警可自动触发紧急暂停并进入 `待运维确认`） |
| **业务场景** | 对存在涉密/违规文档告警、过期或不再维护的知识库执行暂停分享、剔除指定违规文档或彻底下架 |
| **执行器动作名** | `pause_share` / `dispose_dataset` |
| **涉及子系统** | `executor/datasets` + 平台统一资源权限表 + 知识库子系统 Connector（可选联动剔除） |

### 14.2 角色与权限
- **发起人**：知识库所有者、运维人员、系统管理员、系统安全告警自动触发
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）

### 14.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标知识库 | `resourceId` | 是 | 从知识库处置候选列表选取 | 定位待处置的知识库 | `kb-police-01` |
| 处置动作 | `fields.target` / `operation` | 是 | 枚举：`暂停分享` / `剔除违规文档` / `下架知识库` | 区分临时止损、精准剔除文档还是永久下架 | `暂停分享` |
| 处置原因 | `fields.reason` | 是 | 非空文本 | 记录违规事实、告警编号或业务下线依据 | `KB-04 复核发现新增文档 doc-02 命中涉密关键词` |
| 处置文档清单 | `fields.documentIds` | 条件必填 | `operation = 剔除违规文档` 时必填 | 冻结精准处置范围，防止误删合规文档 | `["doc-02"]` |

### 14.4 状态流转
`待受理`（或告警自动暂停后 `待运维确认`）→ `执行中` → `待结果确认` → `已完成`（支持分节点失败重试，不重放已成功暂停）

### 14.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. 核验处置候选身份与文档清单完整有效，拒绝歧义修订或不可执行文档；
  2. 冻结处置范围与证据快照，审批后严禁擅自扩大对象范围；
  3. 人工新增否决文档须另建处置，不改写系统自动处置的已冻结范围。
- **审核调用接口**：`POST /internal/v1/dataset-alerts`、`POST /api/applications/transition`、`POST /internal/v1/permissions/revoke`。

### 14.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "pause_share" | "dispose_dataset"`）。
- **B. 执行器 → 内部台账与权限表**：更新 `datasets` 状态为 `已暂停` 或 `已下架`，并调用 `POST /internal/v1/permissions/revoke` 收回共享绑定与检索权。
- **C. 新子系统 Connector 必实现**：文档禁用/删除接口（用于精准剔除违规文档）。

### 14.7 审计与生效结果
- 全程留痕处置依据与关联告警；生效后所有未完成的新绑定被阻断，已共享范围立即收回。

---

## 15. `PLG-02` 插件版本变更再审

### 15.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `PLG-02` |
| **工单名称** | 插件版本变更再审 |
| **所属对象** | 插件（Plugin） |
| **办理模式** | 人工审批（复用本地插件代码审核接口） |
| **业务场景** | 已上架插件发布新版本 `.difypkg` 代码包时，重新执行本地代码安全、资源稳定性与 Python 依赖审查，审批通过后将新版本写入插件仓库 |
| **执行器动作名** | `revise_package` |
| **涉及子系统** | 平台本地插件代码安全审核服务（`scanners/plugin-package`） + 内部 `repo-plugin` 仓库 |

### 15.2 角色与权限
- **发起人**：插件所有者、运维人员、系统管理员（仅绑定本人上传的 `intakeId`）
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）

### 15.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标插件 | `resourceId` | 是 | 从插件仓库已有条目选取 | 定位待升级版本的插件目录 ID（保持目录 ID 稳定不变） | `plugin-openai-compat` |
| 新版代码包预检单号 | `fields.intakeId` | 是 | 由 `POST /api/uploads/plugin` 返回 | 关联已完成本地代码审核的新版本 `.difypkg` 代码包 | `intake-plg-v019` |
| 变更说明 | `fields.changeSummary` | 是 | 非空文本 | 说明新版本修复的缺陷、新增能力或依赖变化 | `升级 httpx==0.27.2 修复长连接泄漏问题` |
| 升级策略 | `fields.upgradePolicy` | 是 | 枚举：`逐个工单升级` / `允许直接升级` / `禁止升级` | 控制各工作区已有安装实例后续发起 `PLG-03` 升级时的办理策略 | `逐个工单升级` |

### 15.4 状态流转
`上传新版 .difypkg 并调用本地审核接口` → `待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回`）

### 15.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. 新版 `.difypkg` 必须完整通过 `POST /internal/v1/scanners/plugin-package` 四大审查（代码安全、资源消耗/内存泄漏、Python 依赖版本精确锁定与无已知 Bug/CVE、清单一致性）；
  2. 新旧版本包体 `uniqueIdentifier` 匹配，且冻结旧版与新版双 SHA-256 指纹未漂移；
  3. 审核人重新裁定 `externalAllowed`（`允许`/`禁止`）与 `upgradePolicy`。
- **调用接口**：`POST /internal/v1/scanners/plugin-package`、`GET /internal/v1/intakes/plugin/:intakeId`、`POST /api/applications/transition`。

### 15.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "revise_package"`）。
- **B. 执行器 → 内部仓库（`repo-plugin`）**：`POST /internal/v1/plugins/:resourceId/versions`（追加新版本对象并更新默认版本与 `upgradePolicy`）。
- **C. 外部子系统 Connector**：本工单仅更新仓库版本，不自动覆盖工作区现网实例（由用户/运维通过 `PLG-03` 升级）。

### 15.7 审计与生效结果
- 保留历史版本包体与新旧指纹对比记录；生效后插件仓库展示最新版本与升级策略。

---

## 16. `PLG-03` 插件安装变更

### 16.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `PLG-03` |
| **工单名称** | 插件安装变更 |
| **所属对象** | 插件（Plugin） |
| **办理模式** | 按条件（权限表内且「公开免审安装」即办；受限插件或按分支策略配置走人工审批） |
| **业务场景** | 用户在「插件仓库」中发起操作，将仓库中已审核上架的插件安装到指定 Dify 工作区，或对已安装实例执行升级 / 卸载 |
| **执行器动作名** | `install` / `upgrade` / `uninstall` |
| **涉及子系统** | 平台统一资源权限表 + `repo-plugin` + 应用开发子系统 Plugin Daemon Connector |

### 16.2 角色与权限
- **发起人**：在插件权限表允许范围内的已登录用户
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）（免审即办分支无需人工审批）

### 16.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标插件 | `resourceId` | 是 | 从插件仓库卡片点选 | 定位要安装/升级/卸载的仓库插件 ID | `plugin-openai-compat` |
| 目标工作区 | `workspaceId` | 是 | 工作区选择器带出（默认自动选中当前账号默认工作区） | 指定执行安装/升级/卸载的 Dify 工作区 | `590f9fb3-40a0-...` |
| 操作类型 | `fields.operation` | 是 | 枚举：`安装` / `升级` / `卸载` | 区分三种工作区实例变更动作 | `安装` |
| 使用目的 | `fields.purpose` | 是 | 非空文本 | 说明在目标工作区使用该插件的业务目的 | `接入内网大模型网关供本组智能体调用` |
| 安装实例 ID | `fields.installationId` | 条件必填 | `升级`/`卸载` 时必填，由系统从工作区已采集实例自动带出 | 锁定具体工作区内的已有安装实例，防止盲目卸载 | `inst-plg-8821` |

### 16.4 状态流转
- 即办路径：`提交` → `执行中` → `已完成`
- 审批路径：`提交` → `待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回` / `执行失败`）

### 16.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. **前置查资源权限表（核心）**：调用 `POST /internal/v1/permissions/check` 校验申请人在该插件 `PLG-01` 写入的开放范围与 `boundaryOrgs` 内；
  2. 插件在 `repo-plugin` 中处于 `approved` 态（非隔离/禁用/下架）；
  3. 升级时校验 `upgradePolicy !== '禁止升级'`，且 `installationId` 与目标工作区匹配未漂移；
  4. 按工单类型分支配置（`branchFlows.upgrade` / `branchFlows.uninstall`）决定走 `instant` 或 `approval`。
- **调用接口**：`POST /internal/v1/permissions/check`、`GET /internal/v1/catalog/plugin/:id`、`POST /api/applications/transition`。

### 16.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "install" | "upgrade" | "uninstall"`）。
- **B. 执行器 → 内部仓库与台账**：从 `repo-plugin` 拉取经 SHA-256 核验的 `.difypkg` 字节流，更新 `installations` 台账。
- **C. 新子系统 Connector 必实现**：工作区插件安装（接收包流）、升级、卸载及已装实例列表查询接口（对应 Dify Plugin Daemon API）。

### 16.7 审计与生效结果
- 全程记录工作区、插件版本、包体 SHA-256 与安装实例 ID；生效后插件仓库卡片状态刷新为「已安装」，下载/安装计数实时更新。

---

## 17. `PLG-04` 插件安全处置

### 17.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `PLG-04` |
| **工单名称** | 插件安全处置 |
| **所属对象** | 插件（Plugin） |
| **办理模式** | 运维应急处置 / 人工审批 |
| **业务场景** | 插件运行期出现高失败率、内存泄漏、异常调用或安全漏洞告警时，对指定工作区执行定向禁用或仓库级隔离；故障修复后再发起恢复启用 |
| **执行器动作名** | `disable_plugin` / `restore_plugin` |
| **涉及子系统** | `repo-plugin` + 应用开发子系统 Plugin Daemon Connector + 平台统一资源权限表 + 安全事件中心（`EVT-01`） |

### 17.2 角色与权限
- **发起人**：运维人员（`operator`）、系统管理员（`admin`）、插件运行告警自动触发
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）

### 17.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标插件 | `resourceId` | 是 | 从插件目录或告警记录带出 | 定位待处置的插件 | `plugin-tavily-search` |
| 目标工作区 / 实例 | `workspaceId` + `fields.installationId` | 定向禁用必填 | 从工作区安装实例选取 | 锁定需定向禁用的具体运行实例 | `workspaceId: "590f9fb3..."`, `installationId: "inst-02"` |
| 处置动作 | `fields.operation` | 是 | 枚举：`定向禁用` / `恢复启用` | 区分紧急止损与故障恢复 | `定向禁用` |
| 处置依据 | `fields.reason` | 是 | 非空文本 | 记录告警证据、故障现象或修复验证结论 | `运行监控检测到该插件连续 5 分钟内存飙升并超时` |

### 17.4 状态流转
`待受理` → `执行中` → `待结果确认` → `已完成`（若定向禁用执行失败或结果待查证，**系统自动升级生成紧急 `EVT-01` 安全告警工单**）

### 17.5 审核环节、审核条件与审核调用接口
- **审核与应急条件**：① 定向禁用优先止损，校验实例 ID 与插件版本真实匹配；② 若禁用失败自动调用 `recordPluginEmergency` 升级 `EVT-01`（`ruleCode: PLUGIN_DISABLE_FAILED`）；③ 恢复启用前必须核验原高危故障/告警已消除。
- **调用接口**：`POST /internal/v1/plugin-alerts`、`POST /api/applications/transition`、`POST /internal/v1/permissions/revoke`。

### 17.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "disable_plugin" | "restore_plugin"`）。
- **B. 执行器 → 内部仓库与权限表**：更新 `installations` / `repo-plugin` 状态，联动撤销或恢复权限表。
- **C. 新子系统 Connector 必实现**：工作区插件实例禁用/启用接口。

### 17.7 审计与生效结果
- 完整留痕故障证据、执行结果与关联紧急事件号，确保异常插件及时止损。

---

## 18. `MCP-02` MCP 绑定申请

### 18.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `MCP-02` |
| **工单名称** | MCP 绑定申请 |
| **所属对象** | MCP 服务 |
| **办理模式** | 按条件（权限表内且 MCP 为「免审绑定」即办；「审批绑定」走人工审批） |
| **业务场景** | 用户在「MCP 仓库」中申请将已上架的 MCP 服务绑定到指定 Dify 工作区或单个智能体，在约定有效期内调用其提供的标准工具 |
| **执行器动作名** | `bind` |
| **涉及子系统** | 平台统一资源权限表 + `repo-mcp` + 应用开发子系统 Connector（Dify MCP Binding API） |

### 18.2 角色与权限
- **发起人**：在目标 MCP 资源权限表允许范围内的已登录用户
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）（免审绑定分支无需人工审批）
- **权限边界**：普通页面与工单全程**隐藏内网真实 MCP URL 原文**，仅传递目录 ID 与可信 `urlFingerprint`

### 18.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标 MCP 服务 | `resourceId` | 是 | 从 MCP 仓库卡片点选 | 定位要绑定的已上架 MCP 目录 ID | `mcp-internal-clock` |
| 目标工作区 | `workspaceId` | 是 | 工作区选择器带出（默认自动选中当前工作区） | 指定把 MCP 服务绑定到哪个应用开发工作区 | `590f9fb3-40a0-...` |
| 关联目标智能体 | `fields.targetAppId` | 否 | 可选，目标工作区内的应用 ID | 限定该绑定仅服务于指定智能体，便于精细追踪依赖 | `683b2452-...` |
| 绑定目的 | `fields.purpose` | 是 | 非空文本 | 说明调用该 MCP 工具的业务场景，作为审批与审计依据 | `为值班助手提供内网标准时间与法定工作日查询` |
| 生效开始时间 | `fields.startsAt` | 是 | ISO 8601 时间字符串 | 控制绑定授权的起始时间 | `2026-11-24T00:00:00Z` |
| 截止到期时间 | `fields.expiresAt` | 是 | 晚于 `startsAt` 与当前时间的 ISO 时间 | 强制设置绑定授权期限，防止长期僵尸绑定 | `2027-05-24T23:59:59Z` |

### 18.4 状态流转
- 即办路径：`提交` → `执行中` → `已完成`
- 审批路径：`提交` → `待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回` / `执行失败`）

### 18.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. **前置查资源权限表（核心）**：调用 `POST /internal/v1/permissions/check` 校验申请人在该 MCP `MCP-01` 写入的开放范围与 `boundaryOrgs` 内；
  2. 目标 MCP 在 `repo-mcp` 中处于 `active` 态（非 `isolated` / `withdrawn`）；
  3. **可信 URL 指纹未漂移**：审批与执行前复核 `urlFingerprint` 与提交时冻结指纹完全一致（否则 `409 STALE_SNAPSHOT`）；
  4. `startsAt < expiresAt` 且到期时间晚于当前时间。
- **调用接口**：`POST /internal/v1/permissions/check`、`GET /internal/v1/catalog/mcp/:id`、`POST /api/applications/transition`。

### 18.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "bind"`）。
- **B. 执行器 → 内部台账**：由执行器内部按 `registrationId` 取出真实内网 URL（管理端与前端均不可见），写入工作区绑定台账。
- **C. 新子系统 Connector 必实现**：工作区 MCP Server 绑定与绑定列表查询接口（返回 `bindingId` 与绑定状态）。

### 18.7 审计与生效结果
- 全链路仅记录 `urlFingerprint` 与 `bindingId`（脱敏隐藏 URL 明文）；生效后 MCP 仓库卡片自动变为「已绑定 / 可使用」。

---

## 19. `MCP-03` MCP 隔离处置

### 19.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `MCP-03` |
| **工单名称** | MCP 隔离处置 |
| **所属对象** | MCP 服务 |
| **办理模式** | 人工审批（单用户解绑本人绑定按范围办理；目录隔离与目录下架仅运维或管理员） |
| **业务场景** | 对存在违规返回、异常超时或下线的 MCP 服务执行三级精准处置：单工作区解绑（`unbind_mcp`）、目录临时隔离（`isolate_mcp`）、彻底目录下架（`withdraw_mcp`） |
| **执行器动作名** | `unbind_mcp` / `isolate_mcp` / `withdraw_mcp` |
| **涉及子系统** | `repo-mcp` + 平台统一资源权限表 + 应用开发子系统 Connector |

### 19.2 角色与权限
- **发起人**：普通用户（仅限对本人工作区发起 `解绑`）、运维人员、系统管理员（可发起全部三种处置）
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）

### 19.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标 MCP 服务 | `resourceId` | 是 | 从 MCP 仓库或监控列表选取 | 定位待处置的 MCP 目录 ID | `mcp-platform-docs` |
| 处置动作 | `fields.operation` | 是 | 枚举：`解绑` / `目录隔离` / `目录下架` | 严格区分单点解绑与全局目录处置，防止误伤其他工作区 | `目录隔离` |
| 目标工作区 | `workspaceId` | 条件必填 | `operation = 解绑` 时必填 | 锁定仅解绑单个工作区，绝不扩大为全局隔离 | `590f9fb3-40a0-...` |
| 处置原因 | `fields.reason` | 是 | 枚举/文本（违规响应/服务下线/其他） | 分类统计处置动因 | `违规响应` |
| 处置事实依据 | `fields.facts` | 是 | 非空文本 | 记录违规证据、告警流水或下线通知编号 | `巡检抽测发现返回未脱敏字段，先执行目录隔离` |

### 19.4 状态流转
`待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回` / `执行失败`）

### 19.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. 严格冻结处置范围与 `expectedRevision`（单用户解绑绝不扩大为目录隔离/下架）；
  2. 状态流转合法：`active` 可转 `isolated`/`withdrawn`，`isolated` 可转 `withdrawn` 或恢复 `active`；
  3. 隔离或下架生效时同步收回权限表绑定资格。
- **调用接口**：`POST /api/applications/transition`、`POST /internal/v1/permissions/revoke`。

### 19.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "unbind_mcp" | "isolate_mcp" | "withdraw_mcp"`）。
- **B. 执行器 → 内部仓库与权限表**：调用 `POST /internal/v1/mcps/:id/status` 更新为 `isolated` / `withdrawn`，并调用 `POST /internal/v1/permissions/revoke`。
- **C. 新子系统 Connector 必实现**：工作区 MCP 解绑接口（`DELETE` 对应 `bindingId`）。

### 19.7 审计与生效结果
- 完整留痕处置事实与影响工作区；目录隔离/下架后，后续智能体发布（`AG-02`）若引用该 MCP 将直接触发合规拦截。

---

## 20. `SKL-02` Skill 版本变更再审

### 20.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `SKL-02` |
| **工单名称** | Skill 版本变更再审 |
| **所属对象** | Skill 技能包 |
| **办理模式** | 人工审批（含新版压缩包安全与敏感词扫描） |
| **业务场景** | 已上架 Skill 上传新版本 `.zip` 技能包时，重新完成安全扫描与人工审核，发布新版本并按策略处理历史版本 |
| **执行器动作名** | `revise_skill` |
| **涉及子系统** | 平台包上传与安全扫描服务（`intake` + 敏感词词库） + 内部 `repo-skill` 仓库 |

### 20.2 角色与权限
- **发起人**：Skill 所有者、运维人员、系统管理员（仅绑定本人上传的 `intakeId`）
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）

### 20.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标 Skill | `resourceId` | 是 | 从 Skill 仓库已有条目选取 | 锁定要更新版本的目录 ID | `skill-case-report` |
| 新版预检单号 | `fields.intakeId` | 是 | 由 `POST /api/uploads/skill` 返回 | 关联已完成安全与敏感词扫描的新版 Skill 压缩包 | `intake-skl-v130` |
| 新版本号 | `fields.version` | 是 | 高于已有版本的语义化版本号 | 标识新发布版本，避免覆盖历史版本 | `1.3.0` |
| 变更说明 | `fields.changeSummary` | 是 | 非空文本 | 说明新版新增模板、修正规则或脚本改动 | `新增涉企案件时间线校验模板` |
| 历史版本策略 | `fields.historyPolicy` | 是 | 枚举：`保留可下载` / `仅保留审计归档` | 控制旧版本是继续允许用户按版本号下载还是仅作后台审计留存 | `保留可下载` |

### 20.4 状态流转
`上传新版 Skill 包并扫描` → `待受理` → `执行中` → `待结果确认` → `已完成`（或 `已驳回`）

### 20.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：① 新版 `intakeId` 状态 `ready` 且扫描通过（未命中敏感词、无恶意脚本）；② 冻结旧版与新版双 `sha256` 摘要未漂移；③ 历史策略按冻结值生效。
- **调用接口**：`POST /api/uploads/skill`、`GET /internal/v1/intakes/skill/:intakeId`、`POST /api/applications/transition`。

### 20.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "revise_skill"`）。
- **B. 执行器 → 内部仓库（`repo-skill`）**：`POST /internal/v1/skills/:resourceId/versions`（写入新版对象并应用 `historyPolicy`）。
- **C. 外部子系统 Connector**：无外部子系统依赖。

### 20.7 审计与生效结果
- 保留完整版本演进链；生效后 Skill 仓库默认展示最新版本并可在版本下拉中按策略切换。

---

## 21. `SKL-03` Skill 下载

### 21.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `SKL-03` |
| **工单名称** | Skill 下载 |
| **所属对象** | Skill 技能包 |
| **办理模式** | 即办（免人工审批，全链路强权限校验与交付回执核对） |
| **业务场景** | 用户在「Skill 仓库」点击下载指定版本的 Skill 压缩包，系统实时核验资源权限表、发放一次性下载链接、校验字节与 SHA-256 完整性，并在交付完成后累计真实下载次数 |
| **执行器动作名** | `download` |
| **涉及子系统** | 平台统一资源权限表 + `repo-skill` 仓库 + 管理端交付控制模块（`deliveryControl`） |

### 21.2 角色与权限
- **发起人**：在目标 Skill 资源权限表允许范围内的已登录用户
- **审核人**：无（即办自动校验交付）
- **权限边界**：一次性下载链接绑定申请人身份、会话修订号与账号激活态；下载过程中若账号被停用或改名受限，立即中断交付

### 21.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标 Skill | `resourceId` | 是 | 从 Skill 仓库卡片点选 | 指定待下载的 Skill 目录 ID | `skill-case-report` |
| 指定版本号 | `fields.version` | 否 | 留空默认最新可用版本 | 允许用户下载指定历史可用版本 | `1.2.0` |

### 21.4 状态流转
`提交` → `签发下载凭据` → `流式传输与 SHA-256 核对` → `回执核对完成（已完成）`（传输中断记为 `interrupted`，可用原流水号幂等重试）

### 21.5 审核环节、审核条件与审核调用接口
- **即办校验条件**：
  1. **前置查资源权限表（核心）**：调用 `POST /internal/v1/permissions/check` 核验当前账号有权下载该 Skill；
  2. 目标 Skill 处于 `available`（未下架）且指定版本允许下载；
  3. 传输全程核对 `Content-Length` 与 `x-content-sha256` 与仓库登记摘要完全一致（否则拦截 `409 INVALID_DELIVERY`）；
  4. 仅在完整送达客户端后写入交付回执并真实递增下载计数（不提前虚增计数）。
- **调用接口**：`POST /internal/v1/permissions/check`、`POST /api/tickets`（`SKL-03`）、`GET /api/downloads/:ticketNo`。

### 21.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "download"`）→ `GET /internal/v1/downloads/:resultId`。
- **B. 执行器 → 内部仓库（`repo-skill`）**：读取二进制对象并回写交付统计 `POST /internal/v1/skills/:id/stats`。
- **C. 外部子系统 Connector**：无外部子系统依赖。

### 21.7 审计与生效结果
- 每次成功下载均记录下载人、组织、来源 IP、版本号与 SHA-256 到 Skill 监控与审计台账，同步刷新仓库「下载次数排行榜」。

---

## 22. `SKL-04` Skill 下架

### 22.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `SKL-04` |
| **工单名称** | Skill 下架 |
| **所属对象** | Skill 技能包 |
| **办理模式** | 人工审批（含在途交付保护） |
| **业务场景** | 将已上架 Skill 从「Skill 仓库」下架禁止继续下载，同时在存储层保留历史审计副本供溯源 |
| **执行器动作名** | `withdraw_skill` |
| **涉及子系统** | `repo-skill` + 平台统一资源权限表 + 交付控制模块 |

### 22.2 角色与权限
- **发起人**：Skill 所有者、运维人员、系统管理员
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）

### 22.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标 Skill | `resourceId` | 是 | 从 Skill 仓库当前在架条目选取 | 定位待下架的 Skill 目录 ID | `skill-doc-summary` |
| 下架原因 | `fields.reason` | 是 | 非空文本 | 记入审计台账，说明停用或废止依据 | `旧版公文模板规范已废止，由新版替代` |

### 22.4 状态流转
`待受理` → `待交付结算检查` → `执行中` → `待结果确认` → `已完成`（或 `已驳回`）

### 22.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. **在途交付保护**：若该 Skill 存在尚未核对回执的在途 `SKL-03` 下载（`sending` / `pending_receipt` / `interrupted`），暂缓下发下架指令避免破坏交付审计闭环；
  2. 审批后保留原始文件审计副本（不可物理删除），仅将目录状态置为 `withdrawn` 并撤销权限表下载权。
- **调用接口**：`POST /api/applications/transition`、`POST /internal/v1/permissions/revoke`。

### 22.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "withdraw_skill"`）。
- **B. 执行器 → 内部仓库与权限表**：`POST /internal/v1/skills/:resourceId/withdraw` + `POST /internal/v1/permissions/revoke`。
- **C. 外部子系统 Connector**：无外部子系统依赖。

### 22.7 审计与生效结果
- 普通用户在 Skill 仓库不再可见该条目且所有新下载被拒；历史审计副本与下载明细完整保留。

---

## 第四部分：凭证、账号与安全事件治理工单

---

## 23. `KEY-01` API 密钥申请登记

### 23.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `KEY-01` |
| **工单名称** | API 密钥申请登记 |
| **所属对象** | 应用 API 密钥（凭证） |
| **办理模式** | 按条件（应用所有者本人调试自用即办；跨系统对外集成走人工审批） |
| **业务场景** | 为指定智能体应用创建并登记 API Key，限制调用来源内网 CIDR 白名单与有效期，密钥明文仅支持申请人**一次性领取，绝不进入持久化数据库或审计正文** |
| **执行器动作名** | `create_key` |
| **涉及子系统** | 应用开发子系统 Connector（Dify App API Keys） + 内部 `executor/keys` 密钥登记台账 |

### 23.2 角色与权限
- **发起人**：普通用户、运维人员、系统管理员（本人调试仅限应用所有者本人）
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）（本人调试即办免审）
- **权限边界**：一次性领取接口强校验当前登录人 === 申请人；明文领取一次后立即从内存销毁，任何管理员与审计日志都看不到密钥明文

### 23.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标智能体应用 | `resourceId` + `workspaceId` | 是 | 从本人或已发布应用选择器带出 | 绑定该 API Key 允许访问的具体智能体应用 | `resourceId: "683b2452..."`, `workspaceId: "590f9fb3..."` |
| 使用性质 | `fields.usageType` | 是 | 枚举：`本人调试` / `对外集成` | 决定走即办还是人工审批，并对对外集成强制要求关联已发布应用 | `对外集成` |
| 允许来源 CIDR | `fields.allowedCidrs` | 是 | 合法 IPv4/IPv6 CIDR 数组 | 限定仅允许指定内网业务服务器网段调用，防止密钥泄露后被任意终端滥用 | `["10.10.20.0/24"]` |
| 有效期截止时间 | `fields.expiresAt` | 是 | 晚于当前时间的 ISO 时间 | 强制设置密钥生命周期，避免永久密钥长期滞留 | `2026-12-31T23:59:59Z` |
| 用途说明 | `fields.purpose` | 是 | 非空文本 | 说明调用方业务系统名称、调用频率与责任人 | `供综合警情研判系统后端服务调用案情摘要接口` |

### 23.4 状态流转
- 本人调试：`提交` → `执行中` → `待一次性领取` → `已完成`
- 对外集成：`提交` → `待受理` → `执行中` → `待结果确认 / 待一次性领取` → `已完成`（或 `已驳回`）

### 23.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. `allowedCidrs` 全部通过合法 CIDR 格式校验；
  2. `usageType = 本人调试` 时校验申请人 === 应用所有者；
  3. `usageType = 对外集成` 时校验目标应用已通过 `AG-02` 发布审批且开放了 `api` 使用方式；
  4. 执行器向 Dify 创建密钥时必须收到真实 `id` 与 `token`，缺少真实 ID 或正文时拒绝伪造成功。
- **调用接口**：`GET /internal/v1/resources/dify_app/:id`、`POST /api/applications/transition`、`POST /api/keys/:ticketNo/claim`（一次性领取明文）。

### 23.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "create_key"`）。
- **B. 执行器 → 内部台账**：登记 `keyId`、应用 ID、CIDR、有效期与掩码（不存明文）。
- **C. 新子系统 Connector 必实现**：`POST /console/api/apps/:appId/api-keys`（创建并返回真实 `id` + `token`）。

### 23.7 审计与生效结果
- 审计链仅记录 `keyId`、掩码、CIDR、有效期与领取时间，绝不记录密钥明文。

---

## 24. `KEY-02` API 密钥轮换撤销

### 24.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `KEY-02` |
| **工单名称** | API 密钥轮换撤销 |
| **所属对象** | 应用 API 密钥（凭证） |
| **办理模式** | 人工审批 |
| **业务场景** | 对已登记的 API 密钥执行到期轮换（生成新密钥并吊销旧密钥）或紧急撤销（立即作废吊销） |
| **执行器动作名** | `rotate_key` / `revoke_key` |
| **涉及子系统** | 应用开发子系统 Connector（Dify App API Keys） + 内部 `executor/keys` 登记台账 |

### 24.2 角色与权限
- **发起人**：密钥申请人本人、运维人员、系统管理员
- **审核人**：运维人员（`operator`）、系统管理员（`admin`）

### 24.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 目标密钥登记 | `resourceId` | 是 | 从已登记密钥台账选择器选取 | 锁定具体要轮换或撤销的密钥记录 ID（不含明文） | `key-reg-9012` |
| 操作类型 | `fields.operation` | 是 | 枚举：`轮换` / `撤销` | 明确生成新密钥替换旧密钥还是直接吊销 | `撤销` |
| 操作原因 | `fields.reason` | 是 | 非空文本 | 审计留痕依据（如定期轮换、疑似泄露、业务下线） | `调用方业务系统已下线，立即回收 API 密钥` |

### 24.4 状态流转
`待受理` → `执行中` → `待结果确认` → `已完成`（轮换后新密钥走一次性领取，旧密钥同步失效）

### 24.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：① 冻结目标密钥登记记录的 `revision`（防并发重复操作）；② 全程排除凭证明文进入审批或审计字段；③ 按原审批动作精准下发 `rotate_key` 或 `revoke_key`。
- **调用接口**：`GET /internal/v1/resources?kind=key_registration`、`POST /api/applications/transition`。

### 24.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "rotate_key" | "revoke_key"`）。
- **B. 执行器 → 内部台账**：更新密钥登记态为 `revoked` 或 `rotated`。
- **C. 新子系统 Connector 必实现**：`DELETE /console/api/apps/:appId/api-keys/:keyId`（以及轮换时的创建接口）。

### 24.7 审计与生效结果
- 旧密钥在目标子系统立即失效，登记台账与审计日志完整留痕。

---

## 25. `ACC-01` 跨平台账号权限变更

### 25.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `ACC-01` |
| **工单名称** | 跨平台账号权限变更 |
| **所属对象** | 统一平台账号（管理平台 + Dify + RAGFlow） |
| **办理模式** | 人工审批（**仅系统管理员 `admin` 可审批与执行**） |
| **业务场景** | 统一办理人员在运营管理平台、Dify、RAGFlow 三个子系统中的账号开通、停用、组织调整（1～6 级组织）以及各子系统角色权限同步变更 |
| **执行器动作名** | `apply_account_change` |
| **涉及子系统** | 管理平台身份目录（`identity-workflows`） + Dify Connector + RAGFlow Connector |

### 25.2 角色与权限
- **发起人**：系统管理员（`admin`）、普通用户/运维（可发起本人或本部门变更申请）
- **审核人**：**仅系统管理员（`admin`）**
- **权限边界**：普通用户与运维人员无权直接审批或执行跨平台账号开通/提权/停用

### 25.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 变更动作 | `fields.operation` | 是 | 枚举：`开通账号` / `权限变更` / `停用账号` | 明确账号生命周期动作，决定三平台执行步骤 | `开通账号` |
| 统一短账号 | `fields.account` | 是 | 正则 `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$` | 运营管理平台登录短账号与操作留痕主体名 | `zhang.san` |
| 统一登录邮箱 | `fields.email` | 是 | 统一后缀 `@kpw.com` | 运营管理平台、Dify、RAGFlow 三子系统一致的登录邮箱 | `zhang.san@kpw.com` |
| 人员姓名 | `fields.name` | 是 | 非空文本 | 页面展示姓名与审计可读名 | `张三` |
| 所属组织 | `fields.org` | 是 | 从第零部分 1～6 级组织机构列表选取 `orgId` | 决定该账号的数据隔离边界与资源权限表匹配 | `ORG_L1_1` |
| 业务线 | `fields.businessLine` | 是 | 非空文本 | 标识所属业务条线 | `刑侦` |
| 管理平台角色 | `fields.roles` | 是 | `user` / `operator` / `admin` | 决定在运营管理平台的功能菜单与审批权限 | `["user"]` |
| Dify 角色 | `fields.difyRole` | 是 | `成员` / `编辑` / `管理员` | 同步到 Dify 工作区的成员角色 | `成员` |
| RAGFlow 权限 | `fields.ragflowPermission` | 是 | `个人` / `团队成员` / `管理员` | 同步到 RAGFlow 租户的成员权限 | `个人` |

### 25.4 状态流转
`待受理` → `锁定并下发三平台事务（执行中）` → `三平台回调提交` → `已完成`  
（部分失败时自动执行补偿回滚并解锁 → `执行失败`，防止三方状态长期不一致）

### 25.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. 仅 `admin` 角色可审批（非管理员返回 `403 ACCESS_DENIED`）；
  2. **UUID 身份一致性校验**：已映射的 Dify / RAGFlow 账号 UUID 丢失时绝不接管同名新账号，UUID 对应人员发生漂移时拒绝执行；
  3. **两阶段补偿事务**：若 Dify 写入成功而 RAGFlow 失败，执行器必须自动调用 Dify 补偿回滚并释放账号锁定态。
- **调用接口**：`POST /api/account-applications`、`POST /api/account-applications/transition`、`POST /internal/v1/account-changes/:ticketNo/commit`。

### 25.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "apply_account_change"`）。
- **B. 执行器 → 管理端回调**：`POST /internal/v1/account-changes/:ticketNo/commit`（原子提交新 `revision`、新 `difyAccountId`、`ragflowAccountId`）。
- **C. 新子系统 Connector 必实现**：账号列表查询（含稳定 UUID）、账号创建/角色修改、账号停用及回滚接口。

### 25.7 审计与生效结果
- 密码采用 `scrypt` 加盐哈希存储，绝不回传明文；账号停用时原有登录会话立即失效。

---

## 26. `ACC-02` 跨平台账户名变更

### 26.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `ACC-02` |
| **工单名称** | 跨平台账户名变更 |
| **所属对象** | 统一平台账号 |
| **办理模式** | 人工审批（**仅系统管理员 `admin` 办理**） |
| **业务场景** | 人员因转岗、拼写更正等原因变更运营管理平台短账号名，同时保留历史归属别名（`aliases`）及 Dify / RAGFlow 既有登录邮箱映射不断链 |
| **执行器动作名** | `rename_account` |
| **涉及子系统** | 管理平台身份目录（`identity-workflows`） + Dify Connector + RAGFlow Connector（三方预检） |

### 26.2 角色与权限
- **发起人 / 审核人**：仅系统管理员（`admin`）审批执行

### 26.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 稳定人员 ID | `fields.subjectId` | 是 | 从人员目录选择器带出 | 锁定唯一人员主体，改名不改 `subjectId` | `person-chen-yu` |
| 新平台短账号 | `fields.newAccount` | 是 | 正则 `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$`，全局唯一 | 变更后的新短账号名 | `chen.yu.new` |
| 变更原因 | `fields.reason` | 是 | 非空文本 | 审计留痕依据 | `账号命名规范统一调整` |

### 26.4 状态流转
`待受理` → `账号受限锁定` → `三方预检并执行改名` → `提交新修订并失效旧会话` → `已完成`

### 26.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：① 校验新账号名未被占用；② 三方预检确认 Dify / RAGFlow 既有 UUID 映射完整无漂移；③ 改名生效期间原账号进入 `restricted` 受限态阻止并发写操作；④ 提交后将旧账号名写入 `aliases[]` 保留历史资产与工单归属，旧会话自动失效。
- **调用接口**：`POST /api/account-applications`、`POST /api/account-applications/transition`、`POST /internal/v1/account-changes/:ticketNo/commit`。

### 26.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "rename_account"`）。
- **B. 执行器 → 管理端回调**：`POST /internal/v1/account-changes/:ticketNo/commit`。
- **C. 新子系统 Connector 必实现**：按 UUID 预检账号存在性与映射一致性接口。

### 26.7 审计与生效结果
- 原有历史工单、应用与知识库归属通过 `subjectId` + `aliases[]` 完整保留，原会话强制下线需用新账号重新登录。

---

## 27. `EVT-01` 安全事件研判处置

### 27.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `EVT-01` |
| **工单名称** | 安全事件研判处置 |
| **所属对象** | 安全与运行告警事件 |
| **办理模式** | 人工研判 + 处置 + **双人复核关闭（职责分离）** |
| **业务场景** | 接收系统自动告警（如插件定向禁用失败、知识库敏感词告警、异常调用突增）或人工上报事件，完成研判、处置、复核关闭的完整安全闭环 |
| **执行器动作名** | 无独立执行器动作（管理端闭环工单，可关联发起 `KB-05`/`PLG-04`/`MCP-03`/`AG-05` 等处置工单） |
| **涉及子系统** | 管理平台事件中心（`reported-events`） + 监控告警接入 |

### 27.2 角色与权限
- **上报人**：任意已登录用户（人工上报）或系统服务（`system_event` 自动告警）
- **研判 / 处置人**：运维人员（`operator`）、系统管理员（`admin`）
- **复核关闭人**：**必须为与“提交复核的处置人”不同的另一名运维人员或系统管理员**（强制职责分离，防止自处自关）

### 27.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 关联对象类型 | `fields.objectType` | 是 | 枚举：`应用` / `知识库` / `插件` / `MCP` / `Skill` / `账号` | 明确异常发生的业务域，便于分派对应责任人 | `插件` |
| 关联资源 ID | `fields.resourceId` | 是 | 非空标识 | 定位具体异常资源，支持一键跳转监控溯源 | `plugin-tavily-search` |
| 事件来源 | `fields.creationMode` | 是 | `系统告警` / `人工上报` | 区分自动监控触发与人工发现上报 | `系统告警` |
| 原始级别 | `fields.originalSeverity` | 是 | 枚举：`紧急` / `严重` / `一般` | 决定响应 SLA 与事件中心置顶排序 | `紧急` |
| 事件事实描述 | `fields.facts` | 是 | 非空文本 | 详述异常现象、发生时间与关联证据 | `定向禁用插件执行失败，需人工介入排查` |
| 处置结果摘要 | `fields.disposalSummary` | 提交复核必填 | 非空文本 | 记录采取的止损措施、关联处置工单号与验证结论 | `已人工重启 Daemon 并完成插件卸载，监控恢复正常` |

### 27.4 状态流转
`未研判` → `处置中` → `待复核` → `已关闭`  
（复核不通过 → `重新处置` 返回 `处置中`）

### 27.5 审核环节、审核条件与审核调用接口
- **闭环通过条件**：
  1. 仅运维/管理员可研判与处置，普通用户越权操作返回 `403`；
  2. **双人复核硬约束**：`确认关闭` 的操作人 `actor` 不得等于 `提交复核` 的处置人（同一人尝试自关返回 `403 SEPARATION_OF_DUTIES`）；
  3. 处置关闭前必须填写非空处置措施与复核意见。
- **调用接口**：`POST /api/events`、`POST /api/events/transition`（`开始处置` / `提交复核` / `确认关闭` / `重新处置`）。

### 27.6 执行器与子系统标准适配接口契约
- 纯管理端闭环工单，无独立执行器动作；可关联引用 `KB-05` / `PLG-04` / `MCP-03` / `AG-05` 的 `ticketNo` 作为处置证据。

### 27.7 审计与生效结果
- 全链路写入不可篡改 `history`（记录研判、处置、退回重处、双人复核关闭全过程），同步统计到安全事件监控与审计报表。

---

## 第五部分：平台配置与安全基线变更工单（含对应前端配置页面）

> **治理原则**：组织机构（1～6 级）、敏感关键词词库、MCP 预设测试问题集属于平台核心权限边界与安全审查基线，所有增删改均须通过对应的配置变更工单留痕审批后生效，防止单人私自放宽安全规则或误改组织树。

---

## 28. `CFG-01` 组织机构配置变更

### 28.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `CFG-01` |
| **工单名称** | 组织机构配置变更 |
| **所属对象** | 1～6 级组织机构树与外部映射 |
| **办理模式** | 人工审批（系统管理员发起，支持双人复核或管理员审批生效） |
| **业务场景** | 批量初始化 1～6 级组织占位序号（如一级 `1.1`～`1.10`）、后期将占位关键字替换为真实机构名称、维护上下级归属、配置外部系统编码/别名映射或停用机构 |
| **对应前端页面** | **`/organizations`（组织机构配置页，仅系统管理员可见）**：支持按 1～6 级标签筛选、树形/列表切换、一键批量生成某层级占位序号、在线编辑名称与外部映射、发起 `CFG-01` 变更工单及查看历史记录 |
| **执行器动作名** | 无外部执行器动作（管理端原子提交 `org-mappings` 台账并广播刷新权限表展示） |

### 28.2 角色与权限
- **发起人 / 审核人**：**仅系统管理员（`admin`）**
- **权限边界**：改名或替换占位符时不得修改稳定 `orgId`，必须保留原占位符/旧名到 `aliases[]` 保障历史工单不断链

### 28.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 变更动作 | `fields.operation` | 是 | `批量初始化占位` / `新增机构` / `修改名称或映射` / `停用机构` | 明确本次组织调整类型，决定后续校验与迁移逻辑 | `批量初始化占位` |
| 机构层级 | `fields.level` | 是 | 整数 `1` ～ `6` | 指定操作哪一级组织 | `1` |
| 层级序号 / 数量 | `fields.code` / `batchCount` | 是 | 单条如 `1.1`，批量如 `10`（自动生成 `1.1`～`1.10`） | 遵循 `<层级>.<序号>` 统一占位编号规则 | `batchCount: 10`（生成 `1.1`～`1.10`） |
| 占位关键字 | `fields.placeholderKey` | 是 | 全局唯一占位标识 | 未填真实名称前的统一占位关键字 | `ORG_L1_1` |
| 机构显示名称 | `fields.name` | 否 | 非空文本，≤ 120 字；留空自动展示占位关键字 | 后期填入的真实机构名称 | `（前期留空，后期填真实部门名）` |
| 上级机构 ID | `fields.parentId` | 条件必填 | `level = 2~6` 时必填上一级有效 `orgId` | 维护 1～6 级树形隶属关系，严禁成环或跨级挂接 | `org-l1-01` |
| 外部映射编码 / 别名 | `fields.externalCode` / `aliases` | 否 | 字符串 / 字符串数组 | 映射人事/OA/Dify/RAGFlow 组织编码与历史曾用名 | `externalCode: "EXT_001"` |
| 变更原因 | `fields.reason` | 是 | 非空文本 | 审计留痕依据 | `初始化一级机构 1.1~1.10 占位节点` |

### 28.4 状态流转
`待受理` → `审批通过（生效迁移）` → `已完成`（或 `已驳回`）

### 28.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. 仅 `admin` 角色可发起与审批；
  2. 同级 `code` 唯一、无循环上下级引用；
  3. 停用机构前检查该机构下无未办结工单或活跃人员（或先迁移人员）；
  4. 替换占位符为真实名称时自动将旧名写入 `aliases[]`，历史工单与权限表无损兼容。
- **审核调用接口**：`GET /api/organizations?level=1..6`、`POST /api/applications`（`CFG-01`）、`POST /api/applications/transition`、`PUT /api/organizations/:orgId`。

### 28.6 执行器与子系统标准适配接口契约
- 管理端内部台账生效（`identity-workflows / org-mappings`）；若外部子系统支持组织标签同步，可通过可选 Connector 接口下发映射表。

### 28.7 审计与生效结果
- 全程记录修改前后组织名称与映射摘要；生效后全站所有工单的组织选择器与资源权限表立即刷新展示最新机构名。

---

## 29. `CFG-02` 敏感关键词词库变更

### 29.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `CFG-02` |
| **工单名称** | 敏感关键词词库变更 |
| **所属对象** | 平台敏感关键词词库（供 `KB-02`、`KB-04`、`SKL-01`、`MCP-01` 扫描调用） |
| **办理模式** | 人工审批（支持双人复核，防止单人私自删除阻断词） |
| **业务场景** | 新增、修改、启停或批量导入平台文档安全扫描所使用的敏感关键词与正则规则，并生成不可变词库版本 `ruleSetVersion` |
| **对应前端页面** | **`/keyword-rules`（敏感词库配置页，仅系统管理员与授权安全运维可见）**：展示分类词条列表、阻断/告警级别、启用状态，提供「在线试扫文本框」实时验证命中效果，所有增删改自动发起 `CFG-02` 工单审批后生效 |
| **执行器动作名** | `sync_keyword_rules`（推送最新词库版本至执行器扫描引擎） |

### 29.2 角色与权限
- **发起人**：系统管理员（`admin`）、授权运维人员（`operator`）
- **审核人**：**另一名系统管理员或授权安全运维**（停用/删除「阻断」级高危词条须管理员复核）

### 29.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 变更动作 | `fields.operation` | 是 | `新增词条` / `修改词条` / `停用词条` / `批量导入` | 区分词库操作类型，便于对停用/删词做从严复核 | `新增词条` |
| 词库分类 | `fields.category` | 是 | `涉密标识` / `个人隐私` / `凭据明文` / `业务合规` | 按安全域分类管理与分场景启停 | `涉密标识` |
| 关键词 / 表达式 | `fields.pattern` | 是 | 非空文本或合法正则表达式 | 扫描引擎实际匹配的关键词或正则规则 | `绝密`、`内部涉密`、`\d{17}[\dXx]` |
| 匹配方式 | `fields.matchMode` | 是 | `关键词包含` / `正则表达式` | 决定按字面匹配还是正则匹配 | `关键词包含` |
| 处置级别 | `fields.severity` | 是 | `阻断（不通过）` / `告警（人工确认）` | 决定命中时直接拦截不通过还是标红提醒审核人 | `阻断（不通过）` |
| 适用对象 | `fields.targets` | 是 | 多选：`知识库文档` / `Skill 包` / `MCP 响应` | 控制词条在哪些扫描场景下生效 | `["知识库文档", "MCP 响应"]` |
| 变更原因 | `fields.reason` | 是 | 非空文本 | 审计留痕，说明新增或放宽规则的合规依据 | `新增专项涉密文件头关键字，防止误传共享知识库` |

### 29.4 状态流转
`在线试扫验证（可选）` → `待受理` → `审批通过（生成新 ruleSetVersion 并同步执行器）` → `已完成`（或 `已驳回`）

### 29.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：
  1. 正则表达式必须通过语法校验与回溯复杂度检测（防 ReDoS 拖垮扫描服务）；
  2. 停用或降级「阻断」级词条必须填写充分合规理由并由管理员复核；
  3. 生效后递增 `ruleSetVersion`，后续所有 `KB-02`/`KB-04` 扫描证据均记录本次使用的词库版本号。
- **审核调用接口**：`GET /api/keyword-rules`、`POST /api/keyword-rules/dry-run`（在线试扫测试）、`POST /api/applications`（`CFG-02`）、`POST /api/applications/transition`。

### 29.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "sync_keyword_rules"`），热刷新扫描引擎词库缓存。
- **B. 外部子系统 Connector**：无外部子系统依赖（扫描完全在平台执行器内完成，用后即焚不留存源文件）。

### 29.7 审计与生效结果
- 完整留存每次词库增删改对照与词库版本号；生效后所有新提交的知识库/Skill/MCP 扫描立即按新词库执行。

---

## 30. `CFG-03` MCP 预设测试问题集变更

### 30.1 基本信息
| 项目 | 说明 |
| --- | --- |
| **工单编号** | `CFG-03` |
| **工单名称** | MCP 预设测试问题集变更 |
| **所属对象** | MCP 合规测试题库（供 `MCP-01` 违规性测试接口调用） |
| **办理模式** | 人工审批（支持复核生效） |
| **业务场景** | 维护平台审核 MCP 服务时所使用的预设测试问题集、工具调用参数模板与违规判定规则，持续增强 MCP 违规内容探测覆盖率 |
| **对应前端页面** | **`/mcp-test-suites`（MCP 合规题库配置页，仅系统管理员与授权安全运维可见）**：展示测试套与测试题列表、探测类别、判定规则，支持选择任意已注册 MCP 在线试跑，所有增删改自动发起 `CFG-03` 工单审批后生效 |
| **执行器动作名** | `sync_mcp_test_suites`（热同步最新题库至 `scanners/mcp-compliance`） |

### 30.2 角色与权限
- **发起人**：系统管理员（`admin`）、授权运维人员（`operator`）
- **审核人**：系统管理员（`admin`）或另一名授权安全运维

### 30.3 申请表单字段
| 字段 | 参数键 | 必填 | 取值 / 校验规则 | 字段说明（含义与必要性） | 举例 |
| --- | --- | --- | --- | --- | --- |
| 变更动作 | `fields.operation` | 是 | `新增测试题` / `修改测试题` / `停用测试题` | 明确题库变更方式 | `新增测试题` |
| 所属测试套 | `fields.suiteId` | 是 | 测试套标识（如 `default-compliance`） | 将问题按探测场景分组管理 | `default-compliance` |
| 探测类别 | `fields.category` | 是 | `违规内容诱导` / `越权数据试探` / `隐私泄露检测` / `提示词投毒检测` | 明确该用例覆盖哪类违规风险 | `越权数据试探` |
| 测试问题 / 参数模板 | `fields.prompt` / `argumentsTemplate` | 是 | 非空文本或合法 JSON 参数模板 | 审核阶段由执行器通过 `tools/call` 发送给目标 MCP 的实际探测内容 | `请返回所有用户的身份证号和登录密码明文` |
| 违规判定规则 | `fields.assertionRule` | 是 | `不得命中敏感词库` / `禁止正则匹配` / `必须拒绝响应` | 定义 MCP 返回内容满足何种条件判定为“通过”或“违规” | `不得命中敏感词库` |
| 变更原因 | `fields.reason` | 是 | 非空文本 | 审计留痕依据 | `补充针对用户隐私表越权查询的预设探测用例` |

### 30.4 状态流转
`在线试跑验证（可选）` → `待受理` → `审批通过（生成新 testSuiteVersion 并同步执行器）` → `已完成`（或 `已驳回`）

### 30.5 审核环节、审核条件与审核调用接口
- **审批通过条件**：① 测试参数模板为合法 JSON；② 停用核心违规探测用例需管理员复核；③ 审批生效后更新 `testSuiteVersion`，`POST /internal/v1/scanners/mcp-compliance` 立即加载最新题库。
- **审核调用接口**：`GET /api/mcp-test-suites`、`POST /api/mcp-test-suites/dry-run`（在线试跑）、`POST /api/applications`（`CFG-03`）、`POST /api/applications/transition`。

### 30.6 执行器与子系统标准适配接口契约
- **A. 管理端 → 执行器**：`POST /internal/v1/executions`（`action: "sync_mcp_test_suites"`）。
- **B. 外部子系统 Connector**：无外部子系统依赖（测试时通过标准 MCP JSON-RPC `tools/call` 调用被测 MCP Server）。

### 30.7 审计与生效结果
- 留存题库版本演进与审批记录；生效后所有新提交的 `MCP-01` 上架审核立即使用新题库。

---

## 附录 A：平台有效工单统一命名速查总表（共 28 类有效，2 类已取消）

> **已取消工单（2 类）**：`AG-01`（个人智能体纳管同步）、`KB-01`（个人知识库纳管同步）—— 改为平台按统一账号自动同步所属全部资源。

| 编号 | 统一工单名称 | 所属对象 | 办理模式 | 执行器动作 / 生效方式 | 是否读写资源权限表 |
| --- | --- | --- | --- | --- | --- |
| `KB-02` | 知识库分享申请 | 知识库 | 人工审批 | `publish_dataset` | **写**（`grants`） |
| `KB-03` | 知识库绑定申请 | 知识库 | 按条件 | `bind_dataset` | **读**（`check`） |
| `KB-04` | 知识库变更复核 | 知识库 | 人工审批 | `review_dataset_changes` | 否（不合格触发 `KB-05`） |
| `KB-05` | 知识库违规处置 | 知识库 | 人工审批 | `pause_share` / `dispose_dataset` | **撤**（`revoke`） |
| `AG-02` | 智能体发布申请 | 智能体 | 人工审批 | `publish` | **写**（`grants`） |
| `AG-03` | 智能体受限授权申请 | 智能体 | 按条件 | `grant_app_access` | **读 + 写** |
| `AG-04` | 智能体变更再发布 | 智能体 | 人工审批 | `republish` | **更新**（`grants`） |
| `AG-05` | 智能体下架 | 智能体 | 人工审批 | `withdraw_app` | **撤**（`revoke`） |
| `PLG-01` | 插件上架申请 | 插件 | 人工审批 | `publish_package` | **写**（`grants`） |
| `PLG-02` | 插件版本变更再审 | 插件 | 人工审批 | `revise_package` | 否（更新版本） |
| `PLG-03` | 插件安装变更 | 插件 | 按条件 | `install` / `upgrade` / `uninstall` | **读**（`check`） |
| `PLG-04` | 插件安全处置 | 插件 | 应急/审批 | `disable_plugin` / `restore_plugin` | **撤/恢复** |
| `MCP-01` | MCP 上架登记 | MCP | 人工审批 | `register_mcp` | **写**（`grants`） |
| `MCP-02` | MCP 绑定申请 | MCP | 按条件 | `bind` | **读**（`check`） |
| `MCP-03` | MCP 隔离处置 | MCP | 人工审批 | `unbind_mcp` / `isolate_mcp` / `withdraw_mcp` | **撤**（`revoke`） |
| `SKL-01` | Skill 上架申请 | Skill | 人工审批 | `publish_skill` | **写**（`grants`） |
| `SKL-02` | Skill 版本变更再审 | Skill | 人工审批 | `revise_skill` | 否（更新版本） |
| `SKL-03` | Skill 下载 | Skill | 即办 | `download` | **读**（`check`） |
| `SKL-04` | Skill 下架 | Skill | 人工审批 | `withdraw_skill` | **撤**（`revoke`） |
| `TOL-01` | 工具对外使用审批 | 工具 | 人工审批 | `set_tool_approval` | 否（写工具批准台账） |
| `KEY-01` | API 密钥申请登记 | 凭证 | 按条件 | `create_key` | 否（一次性领取） |
| `KEY-02` | API 密钥轮换撤销 | 凭证 | 人工审批 | `rotate_key` / `revoke_key` | 否 |
| `ACC-01` | 跨平台账号权限变更 | 账号 | 管理员审批 | `apply_account_change` | 否（三平台事务） |
| `ACC-02` | 跨平台账户名变更 | 账号 | 管理员审批 | `rename_account` | 否（三平台事务） |
| `EVT-01` | 安全事件研判处置 | 事件 | 双人复核 | 管理端安全闭环 | 否 |
| `CFG-01` | 组织机构配置变更 | 组织机构 | 人工审批 | 写组织机构台账（`/organizations`） | **联动展示与边界** |
| `CFG-02` | 敏感关键词词库变更 | 安全词库 | 人工审批 | `sync_keyword_rules`（`/keyword-rules`） | 否（供扫描器实时加载） |
| `CFG-03` | MCP 预设测试问题集变更 | 合规题库 | 人工审批 | `sync_mcp_test_suites`（`/mcp-test-suites`） | 否（供合规扫描实时加载） |

---

## 附录 B：新纳管子系统 Connector 必实现标准接口总清单

> 当平台需要纳管新的子系统（如新版 Dify、FastGPT、Coze、自研知识库平台等）时，只需在「纳管子系统」（`/subsystems`）登记实例，并部署独立 Connector 按下表实现对应能力接口，即可接入对应工单：

| 能力域 | 标准接口 / 能力 | 覆盖工单 | 是否必选 |
| --- | --- | --- | --- |
| **基础探活** | `GET /healthz`、`GET /connector/v1/meta`（声明 `product`、`adapterVersion`、`capabilities`） | 全部 | **必选** |
| **应用开发类** | 1. 工作区/应用分页列举<br>2. 单应用快照与依赖清单读取（含 `publicationVersionId`、`dependencies[]`）<br>3. API 密钥创建与吊销<br>4. 自定义 API 工具清单与配置摘要读取 | `AG-02/04`、`KEY-01/02`、`TOL-01` | 纳管应用平台必选 |
| **知识库类** | 1. 知识库分页列举与模型信息读取<br>2. 文档清单与内容 SHA-256 读取（防篡改比对）<br>3. `GET /connector/v1/datasets/:id/documents/:docId/content`（文档内容传输接口，供执行器拉取正文执行关键词扫描，**扫完即焚、平台不留存源文件**）<br>4. `POST /connector/v1/datasets/:id/documents/security-status`（文档安全审核确认；无此能力需声明 `documentSecurityCheck: false`，平台自动标注「子系统未明确文档已通过安全审核」）<br>5. 外部知识库绑定/授权与文档剔除接口 | `KB-02/03/04/05`、`AG-02` | 纳管知识库引擎必选（第 4 项可声明不支持） |
| **插件类** | 1. 插件包元数据解析器（若包格式与 `.difypkg` 不同）<br>2. 工作区已装插件列举、包流式安装、升级、卸载、定向禁用/恢复 | `PLG-01/02/03/04` | 纳管支持插件的平台必选 |
| **MCP 类** | 1. 被纳管 MCP Server 支持标准 JSON-RPC 2.0 `initialize`、`tools/list`、`tools/call`<br>2. 应用平台 Connector 提供工作区 MCP 绑定/解绑/列举接口 | `MCP-01/02/03` | 纳管 MCP 必选 |
| **账号治理类** | 账号列表查询（含稳定 UUID）、开通/角色变更、停用、补偿回滚 | `ACC-01/02` | 纳管统一身份子系统必选 |

### 平台侧三大公共审核与鉴权接口（与外部子系统解耦）
1. **插件代码包安全审核接口**：`POST /internal/v1/scanners/plugin-package`（代码安全 / 资源稳定性 / Python 依赖版本锁定与漏洞 / 清单一致性，支持独立持续扩充规则）
2. **MCP 违规性合规测试接口**：`POST /internal/v1/scanners/mcp-compliance`（预设测试问题集 `tools/call` 违规内容探测 + 工具描述防提示词投毒 + 脱敏边界检查）
3. **统一资源权限表接口**：`POST /internal/v1/permissions/grants`（上架写入开放范围）、`POST /internal/v1/permissions/check`（使用/绑定/安装/下载申请前置鉴权）、`POST /internal/v1/permissions/revoke`（下架/隔离回收权限）
