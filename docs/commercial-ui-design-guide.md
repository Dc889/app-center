# AI 应用中心 · 前端商业化设计规范与页面改造指南

> **适用范围**：`app-center` 管理端全部前端页面（工作台、工单流转、资源仓库、后台配置与监控页面）
> **核心目标**：消除“内部测试工具 / 研发原型”观感，统一为**企业级商用 SaaS 软件**的视觉语言与交互标准。

---

## 一、七条核心设计铁律

### 1. 横平竖直，严格对齐
- **页面主容器统一等宽堆叠**：页面内所有顶层区块（标题栏、KPI 概览条、操作表单卡、列表/卡片区、工单记录区）必须左右边线完全齐平，统一使用 `.org-page-stack`（`width: 100%; display: flex; flex-direction: column; gap: 16px`）。
- **KPI 概览严格等宽网格**：顶部指标统一使用 **4 等宽卡片网格**（`.org-kpi-grid`），禁止长短不一的胶囊或松散横排。
- **表单控件统一高度与基线**：同一行内的 `input`、`select`、`button` 必须严格等高（标准 `38px`），底部基线齐平（`align-items: end`），禁止高低错落或孤立折行。
- **卡片网格等高底栏对齐**：多列卡片（如子系统、仓库卡片）必须使用 `display: flex; flex-direction: column`，将底部操作栏用 `margin-top: auto` 或中间区 `flex: 1` 推齐到底部同一水平线。

### 2. 删去括号说明，大幅减少碎小文字
- **严禁在标题、表单标签、按钮、状态标签中堆砌括号说明**。
  - ❌ `新增组织机构（提交 CFG-01 变更工单）` → ✅ `新增组织机构`
  - ❌ `1 级机构（1.x）` → ✅ `一级机构`
  - ❌ `全部（6）` / `1 级（5）` → ✅ `全部` + 独立角标 `6`
  - ❌ `机构真实名称（留空则显示占位关键字）` → ✅ `机构名称`
  - ❌ `外部系统映射编码（OA / LDAP / 子系统）` → ✅ `外部编码`
  - ❌ `变更原因（必填，记入 CFG-01 审计）` → ✅ `变更原因`
  - ❌ `未填写（显示占位）` → ✅ `待命名`
- **减少二级小字解释**：能通过清晰标题、标签、占位符或视觉状态表达的，绝不再多写一整段灰色解释文案。
- **禁止裸露底层技术细节**：
  - 列表与详情标题严禁直接展示 UUID、内部前缀 ID（如 `skl-in-...`、`reg-...`、`mcp-...`），必须解析为中文业务名称。
  - 严禁在正文区域直接铺开原始 JSON 代码块；如确需排障报文，必须默认折叠在页面最底部极弱化的 `<details className="app-raw-payload">` 中。

### 3. 统一的视觉层级与卡片规范
| 元素 | 标准规范 |
| --- | --- |
| **主卡片容器** | 白底 `#ffffff`，边框 `1px solid #e4e7ec`，圆角 `12px`，内边距 `20px 24px`，轻阴影 `0 1px 2px rgba(16,24,40,0.04)` |
| **页面主标题** | `20px ~ 22px`，`font-weight: 700`，颜色 `#101828` |
| **卡片标题** | `15px`，`font-weight: 600`，颜色 `#101828` |
| **表单字段标签** | `12px`，`font-weight: 500`，颜色 `#475467` |
| **正文 / 表格内容** | `13.5px`，主色 `#101828`，次要辅助色 `#667085` |
| **等宽编码芯片** | `12px` 等宽字体，底色 `#f2f4f7`，圆角 `5px`，用于工单号、序号、占位标识与 API 地址 |

### 4. 统一语义化状态色（五态胶囊）
全站状态统一使用 `.app-status-pill` + 五种语义色调，禁止各页面自造颜色：
- **待处理 / 告警（`tone-pending`）**：琥珀色 `#b54708` / 底 `#fffaeb` / 边 `#fedf89`（如：待受理、待复核、未审告警）
- **进行中 / 主用（`tone-progress`）**：品牌蓝 `#175cd3` / 底 `#eff8ff` / 边 `#b2ddff`（如：执行中、待结果确认、主用）
- **成功 / 启用（`tone-success`）**：翠绿色 `#027a48` / 底 `#ecfdf3` / 边 `#abefc6`（如：已完成、已启用、自动核验通过）
- **失败 / 驳回（`tone-danger`）**：警示红 `#b42318` / 底 `#fef3f2` / 边 `#fecdca`（如：已驳回、执行失败、已禁用拦截）
- **停用 / 归档（`tone-muted`）**：中性灰 `#475467` / 底 `#f2f4f7` / 边 `#e4e7ec`（如：已撤回、已停用）

### 5. 高频表单商业化（少打字、多选择、可手填）
- **禁止让用户手填 UUID 或反复背诵枚举**：所有资源通过自动加载选择器选取；常用业务字段（业务线、组织边界、目标组织、权限声明、CIDR、QPS、有效期）必须提供**下拉预置（`PresetInput`）或点选标签（`ChipMultiInput`）**，同时保留自由输入能力。
- **自动回填**：选定资源后自动带出默认展示名称与作用域，减少重复输入。
- **按钮主次明确**：主操作用 `.primary-button`（品牌蓝），次操作用 `.secondary-button` / `.app-icon-btn`，危险/驳回操作用 `.danger-outline-button`（红框白底）。

### 6. 复杂业务采用「标签页 + 双栏主从工作台」
- **禁止空表上下堆叠**：同页面含多个工单或数据子集时，使用顶部横向导航标签页（`.workorder-tabs`）分栏展示，默认聚焦首要业务。
- **审批/工单类统一双栏主从布局（`.app-workbench`）**：左侧 `320px` 可搜索筛选卡片列表 + 右侧白底正式详情单（抬头 + 4 步进度条 + 两列网格信息表 + 合规核验卡 + 竖向时间线 + 底部操作卡），进入页面自动选中并展开第一条。

### 7. 严禁前端裸露无意义字符码、UUID 与哈希长串（商用级红线）
- **禁止展示任何 36 位 UUID、64 位 SHA-256 哈希或 UUID 拼接单号**：
  - ❌ `PLG-03-98100f92-ed90-4ed1-8a2f-37266d411b5f`、`EVT-01-plugin-93d8e4701...`
  - ✅ **统一商用可读编号**：新建工单号统一采用 `<类型>-<YYYYMMDD>-<4位序号>`（如 `PLG-03-20261126-0012`）；历史遗留 UUID 单号在前端列表、卡片、提示语中统一经格式化工具缩短展示（如 `PLG-03-98100F`），禁止整串 36 位随机码直接上屏。
- **所有业务对象一律展示中文业务名称，禁止暴露底层 ID**：
  - 下拉选择器 `<option>`、只读输入框、卡片标题、表格列中**严禁**拼接或单独展示 `resourceId`、`workspaceId`、`appId`、`documentId`、`installationId`、`bindingId`、`subjectId`、`snapshotId`、`executionId`、`draftId`、`policyRef`。
  - ❌ `王芳的工作区 · 93afd578-d418-439b-ba3d-9a19d77b8e42` → ✅ `王芳的工作区`
  - ❌ `稳定人员ID · dify-c60c3f086cb24734` → ✅ 隐藏内部主键，仅展示姓名、登录账号与所属组织
  - ❌ `SHA-256 · 93d8e470013bbb6ddd03...` → ✅ 展示语义微标 `完整性校验通过` / `防篡改已锁定`
- **通用详情组件（`RecordDetails`）强制过滤技术字段**：
  - 审批单与工单详情的主信息网格**只展示业务人员看得懂的字段**（名称、组织、用途、范围、时间、结论等）；任何底层技术 ID、快照指纹、原始报文若确需供管理员审计排障，必须默认折叠收纳在页面最底部的 `<details className="app-raw-payload">查看审计溯源编号</details>` 中。
- **审计追踪清单**：全站排查明细见 [前端字符码与UUID裸露审计清单.md](前端字符码与UUID裸露审计清单.md)。

---

## 二、项目内可直接复用的组件与样式清单

| 能力 | 位置 | 复用类名 / 组件 |
| --- | --- | --- |
| 页面等宽堆叠与 4 列 KPI | `management/shared-ui/styles/consistency.css` | `.org-page-stack`, `.org-header-row`, `.org-kpi-grid`, `.org-kpi-card`, `.org-card` |
| 等高表单网格与字段 | `management/shared-ui/styles/consistency.css` | `.org-create-grid`, `.org-field`, `.org-seg-switch` |
| 筛选角标标签与搜索框 | `management/shared-ui/styles/consistency.css` | `.org-level-tabs`, `.app-list-search`, `.org-table-search` |
| 商用数据表与侧栏编辑抽屉 | `management/shared-ui/styles/consistency.css` | `.org-table-wrap`, `.org-table`, `.org-editor-drawer` |
| 双栏主从审批工作台 | `management/shared-ui/styles/consistency.css` | `.app-workbench`, `.app-ticket-card`, `.app-detail-sheet`, `.app-stepper`, `.app-timeline`, `.app-action-card` |
| 顶部横向导航标签页 | `management/shared-ui/styles/consistency.css` | `.workorder-tabs`, `.workorder-tab`, `.workorder-tab-badge` |
| 预置下拉与组织多选标签 | `management/shared-ui/PresetFields.tsx` | `PresetInput`, `ChipMultiInput`, `useOrgOptions` |
| 合规核验指标卡 | `management/shared-ui/styles/consistency.css` | `.app-audit-card`, `.app-audit-metrics`, `.app-audit-table` |

---

## 三、开发文案 → 商用文案对照表

| 场景 | 避免写法（研发口语） | 推荐写法（商业化标准） |
| --- | --- | --- |
| 按钮/占位 | `写一句撤回原因` | `请输入撤回原因` |
| 按钮/占位 | `写一句办理意见，例如：同意发布` | `请输入审批意见` |
| 技术报文 | `技术明细`（默认展开或醒目） | `查看工单审计报文`（默认折叠、弱化置于页底） |
| 数量展示 | `全部（6）` / `业务审批申请（1 条）` | `全部` + 角标 `6` |
| 加密字段 | `管理密码（已加密保存，留空不变）` | `管理密码` + 绿色微标 `已加密` |
| 空状态 | `共 0 条`（光秃秃一行字） | 居中空状态图标 + 一句明确引导语 |

---

## 四、全站页面商业化改造进度清单

| 页面 | 路径 | 当前状态 | 备注 |
| --- | --- | --- | --- |
| 我的申请 / 我的待办 / 工单查询 | `/mine`, `/todo`, `/query` | ✅ 已完成 | 顶部标签页 + 双栏主从工作台 + 4 步进度条 + 中文名称解析 |
| 异常事件处置 / 账号变更工单 | `EventDesk` / `AccountDesk` | ✅ 已完成 | 统一接入双栏主从工作台 |
| 发起申请（高频工单表单） | `/manual`（`AG-02`、`KB-02`、`PLG-01`、`MCP-01`、`KEY-01`） | ✅ 已完成 | 下拉预置 + 组织多选标签 + 核验可视化卡片 |
| 组织机构管理 | `/organizations` | ✅ 已完成 | 4 等宽 KPI + 全宽对齐卡片 + 直接命名新增 + 零括号文案 |
| 纳管子系统 | `/subsystems` | ✅ 已完成 | 4 等宽 KPI + 3 列对齐卡片网格 + 侧栏配置抽屉 |
| 四大资源仓库 | `/agents`, `/plugins`, `/mcps`, `/skills` | ✅ 已完成 | 统一 5 段式 Dify 风格商业化卡片布局 |
| 敏感关键词词库 | `/keyword-rules` | ✅ 已完成 | 4 等宽 KPI + 在线试扫卡 + 38px 对齐新增网格 + 角标分类表 |
| MCP 预设测试集 | `/mcp-test-suites` | ✅ 已完成 | 4 等宽 KPI + 在线探测联调卡 + 38px 对齐新增网格 + 角标分类表 |
| 各类监控大屏与日志页 | `/agent-monitor`, `/knowledge-monitor`, `/service-monitor` 等 | ✅ 已完成 | 清理全部括号说明与冗余小字，统一卡片与指标文案 |

---

## 五、页面改造验收自检清单（每次改完必查）
1. 页面从上到下所有矩形卡片的左右边线是否完全垂直对齐？
2. 同一行内的所有输入框、下拉框、按钮高度与底边是否完全齐平？
3. 是否已彻底清除标题、标签、按钮、状态里的括号说明文字？
4. 是否已彻底清除所有裸露的 36 位 UUID、UUID 拼接超长工单号（如 `PLG-03-98100f92-...`）、64 位 SHA-256 哈希、内部主键（`subjectId`/`snapshotId`/`executionId`）及默认展开的原始 JSON？
5. 所有状态是否统一使用 5 种标准语义胶囊（`.app-status-pill`）？
6. `npm run build` 是否 0 报错通过，且移动端/窄屏下不会横向溢出？
