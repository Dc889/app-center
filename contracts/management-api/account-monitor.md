# 账号与集成监控契约

提供方：管理系统后端  
调用方：管理系统前端（运维人员、系统管理员）  
协议：HTTP JSON

## 1. 概述与范围

按总设计与管理系统开发分工第 8.8 节实现账号与集成监控。
仅具备 `operator`（平台运维）或 `admin`（系统管理员）角色的有效账户可访问，普通用户拒绝访问（HTTP 403 `ACCESS_DENIED`）。
系统管理员可访问全量数据与关联 ACC 工单；运维人员限制所属组织隔离，且账号类工单敏感信息按安全附录裁剪。

监控包含五大核心区块与数据来源：
1. **指标卡（五项指标）**：
   - 映射总数（`totalCount`）：平台纳管的开发者及业务人员映射总数。未采集为 `null`。
   - 三方一致数（`consistentCount`）：平台、RAGFlow 与 Dify 三方映射状态完全一致的记录数。未采集为 `null`。
   - 缺 RAGFlow 数（`missingRagflowCount`）：存在于平台但缺少对应 RAGFlow 用户映射的记录数。
   - 缺 Dify 数（`missingDifyCount`）：存在于平台但缺少对应 Dify 用户映射的记录数。
   - 账户冲突/差异数（`conflictCount`）：角色不一致或账户名发生冲突需处置的数量。
2. **接口健康与耗时趋势（`trend`）**：
   - 按时间窗口（`1h` / `24h` / `7d`）统计 RAGFlow、Dify 接口调用的成功率与平均请求耗时（ms）。
   - `1h` 与 `24h` 按 5 分钟为一个完整时间桶，`7d` 按 1 小时为一个时间桶。
3. **差异类型分布（`diffDistribution`）**：
   - 统计一致、缺 RAGFlow、缺 Dify、角色不一致、账户冲突等各类映射状态的占比与数量分布。
4. **账号映射核对台账（`mappings`）**：
   - 包含平台账户名、姓名、所属组织、RAGFlow ID、Dify ID、目标 Workspace、一致性状态、最近核对时间及关联工单号。
   - 支持关键字搜索（账户名、姓名、工单号、组织、外部 ID）与分页。
5. **适配同步作业台账（`syncJobs`）**：
   - 记录外部账号与工作区目录同步作业的执行历史、目标系统、作业类型、同步条目数、异常数、状态及执行时间。
6. **接口健康与探针探测（`probes`）**：
   - 展示 RAGFlow API、Dify API 及 LDAP/SSO 探测接口的可用性、探测耗时与最近检查时间。

## 2. API 接口定义

### `GET /api/account-monitor`

#### 查询参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `window` | `string` | 否 | `24h` | 趋势时间窗口：`1h`、`24h`、`7d` |
| `org` | `string` | 否 | 全部 | 组织筛选；运维仅可查本人所属组织或全部（如具备权限），越权返回 403 |
| `consistency` | `string` | 否 | 全部 | 一致性状态筛选：`全部`、`一致`、`缺 RAGFlow`、`缺 Dify`、`角色不一致`、`账户名冲突` |
| `q` | `string` | 否 | 空 | 搜索关键字，匹配账户名、姓名、组织、工单号、Workspace 或三方 ID |
| `page` | `integer` | 否 | 1 | 映射台账与同步作业分页页码，最小为 1 |
| `pageSize` | `integer` | 否 | 10 | 每页条数，1 到 100 |

#### 响应结构 (200 OK)
```json
{
  "asOf": "2026-11-19T13:10:00.000Z",
  "window": "24h",
  "metrics": {
    "totalCount": 1284,
    "consistentCount": 1242,
    "missingRagflowCount": 12,
    "missingDifyCount": 19,
    "conflictCount": 4
  },
  "sources": {
    "directory": "collected",
    "probes": "collected",
    "syncJobs": "collected"
  },
  "trend": [
    {
      "time": "20:40",
      "ragflowSuccessRate": 99.8,
      "difySuccessRate": 99.2,
      "ragflowLatencyMs": 45,
      "difyLatencyMs": 118
    }
  ],
  "diffDistribution": [
    { "name": "三方一致", "value": 1242 },
    { "name": "缺 Dify", "value": 19 },
    { "name": "缺 RAGFlow", "value": 12 },
    { "name": "角色不一致", "value": 7 },
    { "name": "账户名冲突", "value": 4 }
  ],
  "mappings": {
    "total": 1284,
    "page": 1,
    "pageSize": 10,
    "items": [
      {
        "account": "chen.yu",
        "name": "陈宇",
        "org": "业务一部",
        "ragflowId": "rf_10482",
        "difyId": "df_20873",
        "workspaceId": "ws_84f2",
        "consistency": "一致",
        "checkedAt": "2026-11-19T13:05:00.000Z",
        "ticketNo": "—"
      }
    ]
  },
  "syncJobs": {
    "total": 24,
    "page": 1,
    "pageSize": 10,
    "items": [
      {
        "jobId": "JOB-SYNC-9021",
        "targetSystem": "Dify",
        "jobType": "增量同步",
        "triggerMode": "定时",
        "syncedCount": 128,
        "errorCount": 0,
        "status": "成功",
        "executedAt": "2026-11-19T13:00:00.000Z"
      }
    ]
  },
  "probes": [
    {
      "name": "RAGFlow User API",
      "status": "健康",
      "latency": "42ms",
      "interval": "30s",
      "lastProbe": "2026-11-19T13:09:30.000Z"
    },
    {
      "name": "Dify Auth API",
      "status": "健康",
      "latency": "118ms",
      "interval": "30s",
      "lastProbe": "2026-11-19T13:09:30.000Z"
    }
  ]
}
```

#### 错误响应
- `400 INVALID_REQUEST`：非法查询参数或分页参数越界。
- `403 ACCESS_DENIED`：普通用户访问，或非管理员跨组织越权查询。
- `403 ACTOR_SESSION_CHANGED`：会话修订变更或账户被限制。
