# MCP 监控契约

提供方：管理系统后端  
调用方：管理系统前端（运维人员、系统管理员）  
协议：HTTP JSON

## 1. 概述与范围

按总设计与管理系统开发分工第 8.5 节实现 MCP 监控。
仅具备 `operator`（平台运维）或 `admin`（系统管理员）角色的有效账户可访问，普通用户拒绝访问（HTTP 403 `ACCESS_DENIED`）。

监控包含六大核心区块与数据来源：
1. **指标卡（五项指标）**：
   - 目录总数（`catalogCount`）：生效 MCP 目录数量。未采集为 `null`。
   - 正常运行数（`activeCount`）：处于 active 状态的可用 MCP。未采集为 `null`。
   - 隔离数（`isolatedCount`）：处于隔离状态的 MCP 数。
   - 绑定总数（`boundCount`）：在各工作区及应用绑定的实例数（MCP-02等）。
   - 异常数（`abnormalCount`）：调用失败、超时或处于 MCP-03 处置中的数量。
2. **调用与时长趋势**：
   - 按时间窗（`1h` / `24h` / `7d`）统计调用次数、成功数、超时数与平均延迟（ms）。
   - `1h` 与 `24h` 按 5 分钟为一个完整时间桶，`7d` 按 1 小时为一个时间桶。
3. **异常 MCP 排行**：
   - 统计时间窗内超时或异常次数最高的 MCP 服务排行。
4. **MCP 调用追踪明细台账（`calls`）**：
   - 取自调用记录与审计事实（包含外部 API 与广场 Web 调用）。
   - 包含记录 ID（`RUN-xxxx`）、时间、调用方式、组织、应用、MCP 名称、工具名称、耗时、结果及关联工单。
   - 支持多字段搜索与分页。
5. **MCP 绑定台账（`bindings`）**：
   - 包含绑定 ID、MCP 名称、目标 Workspace、关联应用、绑定账户、组织、状态及绑定工单号。
6. **告警与处置记录（`alerts`）**：
   - 关联 MCP-03（解绑、隔离或下架）与安全告警工单。

## 2. API 接口定义

### `GET /api/mcp-monitor`

#### 查询参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `window` | `string` | 否 | `24h` | 时间窗口：`1h`、`24h`、`7d` |
| `org` | `string` | 否 | 全部 | 组织筛选；运维仅可查本人所属组织或全部（如具备权限），越权返回 403 |
| `q` | `string` | 否 | 空 | 搜索关键字，匹配 MCP 名、工具名、应用名、工作区、工单号 |
| `page` | `integer` | 否 | 1 | 调用记录与绑定台账分页页码，最小为 1 |
| `pageSize` | `integer` | 否 | 10 | 每页条数，1 到 100 |

#### 响应结构 (200 OK)
```json
{
  "asOf": "2026-11-19T10:10:00.000Z",
  "window": "24h",
  "metrics": {
    "catalogCount": 38,
    "activeCount": 34,
    "isolatedCount": 2,
    "boundCount": 246,
    "abnormalCount": 4
  },
  "sources": {
    "catalog": "collected",
    "calls": "collected",
    "bindings": "collected"
  },
  "trend": [
    { "time": "20:40", "calls": 45, "success": 42, "timeouts": 3, "latencyMs": 1420 }
  ],
  "errorRanking": [
    { "name": "地图服务", "value": 14, "reason": "调用超时" },
    { "name": "企业查询服务", "value": 6, "reason": "响应异常" }
  ],
  "calls": {
    "total": 4,
    "page": 1,
    "pageSize": 10,
    "items": [
      {
        "callId": "RUN-908821",
        "time": "2026-11-19T09:42:18.000Z",
        "accessMode": "广场 Web",
        "org": "业务一部",
        "appName": "案件摘要助手",
        "mcpName": "档案检索服务",
        "toolName": "search_archive",
        "latency": "1.8s",
        "status": "成功",
        "ticketNo": "MCP-02-1001"
      }
    ]
  },
  "bindings": {
    "total": 246,
    "page": 1,
    "pageSize": 10,
    "items": [
      {
        "bindingId": "bind-101",
        "mcpName": "档案检索服务",
        "workspaceId": "ws_84f2",
        "targetApp": "案件摘要助手",
        "account": "chen.yu",
        "org": "业务一部",
        "status": "已绑定",
        "ticketNo": "MCP-02-1001",
        "boundAt": "2026-11-19T08:00:00.000Z"
      }
    ]
  },
  "alerts": [
    {
      "alertId": "ALT-MCP-01",
      "mcpName": "档案检索服务",
      "reason": "异常高频调用",
      "operation": "服务隔离",
      "status": "待审批",
      "ticketNo": "MCP-03-1003",
      "time": "2026-11-19T09:10:00.000Z"
    }
  ]
}
```

#### 错误响应
- `400 INVALID_REQUEST`：非法查询参数或分页参数越界。
- `403 ACCESS_DENIED`：普通用户访问，或非管理员跨组织越权查询。
- `403 ACTOR_SESSION_CHANGED`：会话修订变更或账户被限制。
