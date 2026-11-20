# 知识库监控契约

提供方：管理系统后端  
调用方：管理系统前端（运维人员、系统管理员）  
协议：HTTP JSON

## 1. 概述与范围

按总设计与管理系统开发分工第 8.2 节实现知识库监控。
仅具备 `operator`（平台运维）或 `admin`（系统管理员）角色的有效账户可访问，普通用户拒绝访问（HTTP 403 `ACCESS_DENIED`）。

监控包含八个核心区块与数据来源：
1. **状态指标卡（五项指标）**：
   - 纳入管理总数（`managedCount`）：两产品库（RAGFlow / Dify）已盘点纳管的知识库总量。未采集为 `null`。
   - 已分享知识库（`sharedCount`）：已通过 KB-02 完成发布与分享审批的知识库数量。
   - 构建中任务数（`buildingCount`）：实时处于解析、切片、索引/向量化阶段的任务数。未采集为 `null`。
   - 异常知识库数（`abnormalCount`）：构建失败、处于告警或被暂停处置的知识库数。
   - 待审查文档数（`pendingDocCount`）：在途 KB-02（首次发布审查）及 KB-04（变更审查）中待运维确认的逐文档审查数量。
2. **两产品库来源与状态分布**：
   - 来源分布（`sources`）：RAGFlow 与 Dify 两大底层系统的知识库数量统计。
   - 状态分布（`status`）：已分享、私有纳管、构建中、异常、已暂停等状态分布。
3. **构建任务趋势**：
   - 按时间窗（`1h` / `24h` / `7d`）统计解析/切片/索引任务总量、成功数与异常数。
   - `1h` 与 `24h` 按 5 分钟为一个完整时间桶，`7d` 按 1 小时为一个时间桶。
4. **失败原因分类**：
   - 统计构建失败任务的分类（解析错误 `parse_error`、切片异常 `chunk_error`、向量化超时 `embedding_timeout`、存储超限 `storage_exceeded`）。
5. **嵌入模型核对**：
   - 提取各知识库使用的嵌入模型，与模型目录核对一致性（模型名称、来源系统、核对状态、绑定库数）。
6. **文档审查追踪**：
   - 关联 KB-02 / KB-04 逐文档审查明细（文档 ID、文档名称、64位指纹摘要、自动审查结论、运维确认结论、关联工单）。
7. **构建任务追踪台账**：
   - 包含任务 ID（`taskId`）、来源系统（`source`）、知识库名称（`datasetName`）、当前阶段（`stage`）、进度（`progress`）、持续时长（`duration`）、状态（`status`）及关联工单号（`ticketNo`）。
   - 支持多字段搜索与分页。
8. **告警与处置工单追踪**：
   - 关联由规则证据激发的 KB-05 / EVT-01 处置记录（告警编号、知识库、处置原因、处置动作、工单状态、触发时间）。

## 2. API 接口定义

### `GET /api/knowledge-monitor`

#### 查询参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `window` | `string` | 否 | `24h` | 时间窗口：`1h`、`24h`、`7d` |
| `org` | `string` | 否 | 全部 | 组织筛选；运维仅可查本人所属组织或全部（如具备权限），越权返回 403 |
| `sourceSystem` | `string` | 否 | 全部 | 来源系统筛选：`全部`、`RAGFlow`、`Dify` |
| `q` | `string` | 否 | 空 | 搜索关键字，匹配知识库名称、文档名、任务 ID、工单号等 |
| `page` | `integer` | 否 | 1 | 构建任务台账分页页码，最小为 1 |
| `pageSize` | `integer` | 否 | 10 | 构建任务台账每页条数，1 到 100 |

#### 响应结构 (200 OK)
```json
{
  "asOf": "2026-11-19T09:30:00.000Z",
  "window": "24h",
  "metrics": {
    "managedCount": 168,
    "sharedCount": 57,
    "buildingCount": 12,
    "abnormalCount": 4,
    "pendingDocCount": 23
  },
  "sources": {
    "catalog": "collected",
    "tasks": "collected"
  },
  "trend": [
    { "time": "17:15", "total": 12, "success": 10, "alert": 2, "failed": 0 }
  ],
  "distribution": {
    "sources": [
      { "name": "RAGFlow", "value": 98 },
      { "name": "Dify", "value": 70 }
    ],
    "status": [
      { "name": "已分享", "value": 57 },
      { "name": "私有纳管", "value": 95 },
      { "name": "构建中", "value": 12 },
      { "name": "异常停滞", "value": 4 }
    ]
  },
  "failureCategories": [
    { "category": "解析失败", "code": "parse_error", "count": 2 },
    { "category": "切片异常", "code": "chunk_error", "count": 1 },
    { "category": "向量化超时", "code": "embedding_timeout", "count": 1 },
    { "category": "存储超限", "code": "storage_exceeded", "count": 0 }
  ],
  "embeddingModels": [
    { "modelName": "bge-large-zh", "sourceSystem": "RAGFlow", "status": "正常", "datasetsCount": 98 },
    { "modelName": "text-embedding-v3", "sourceSystem": "Dify", "status": "正常", "datasetsCount": 70 }
  ],
  "tasks": {
    "total": 4,
    "page": 1,
    "pageSize": 10,
    "items": [
      {
        "taskId": "JOB-88421",
        "source": "RAGFlow",
        "datasetName": "经侦案例知识库",
        "stage": "索引 / 向量化",
        "progress": "78%",
        "duration": "12分 38秒",
        "status": "进行中",
        "ticketNo": "KB-01-1001",
        "updatedAt": "2026-11-19T09:25:00.000Z"
      }
    ]
  },
  "documentAudits": [
    {
      "documentId": "doc-01",
      "documentName": "经侦业务办案规范.pdf",
      "datasetName": "经侦案例知识库",
      "sourceSystem": "RAGFlow",
      "sha256": "4a7b...",
      "autoVerdict": "通过",
      "manualVerdict": "通过",
      "status": "已确认",
      "ticketNo": "KB-02-1002",
      "updatedAt": "2026-11-19T09:20:00.000Z"
    }
  ],
  "alerts": [
    {
      "alertId": "ALT-KB-01",
      "datasetName": "反诈话术资料库",
      "reason": "内容违规",
      "operation": "暂停分享",
      "status": "待运维确认",
      "ticketNo": "KB-05-1003",
      "time": "2026-11-19T08:50:00.000Z"
    }
  ]
}
```

#### 错误响应
- `400 INVALID_REQUEST`：非法查询参数或分页参数越界。
- `403 ACCESS_DENIED`：普通用户访问，或非管理员跨组织越权查询。
- `403 ACTOR_SESSION_CHANGED`：会话修订变更或账户被限制。
