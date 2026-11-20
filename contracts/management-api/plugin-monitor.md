# 插件监控契约

提供方：管理系统后端  
调用方：管理系统前端（运维人员、系统管理员）  
协议：HTTP JSON

## 1. 概述与范围

按总设计与管理系统开发分工第 8.4 节实现插件监控。
仅具备 `operator`（平台运维）或 `admin`（系统管理员）角色的有效账户可访问，普通用户拒绝访问（HTTP 403 `ACCESS_DENIED`）。

监控包含六大核心区块与数据来源：
1. **状态指标卡（六项指标）**：
   - 已上架插件数（`publishedCount`）：来自生效插件目录盘点。未采集为 `null`。
   - 已安装实例总数（`installedCount`）：来自跨工作区安装实例（PLG-03等）。
   - 运行中实例数（`runningCount`）：当前处于健康运行中的实例数。未采集为 `null`。
   - 自动禁用实例数（`disabledCount`）：由 PLG-04 或监控告警激发的自动禁用实例数。
   - 待升级实例数（`upgradableCount`）：有新可用版本发布的已安装实例数。
   - 存在漏洞/告警数（`vulnerableCount`）：触发告警规则未恢复或未确认的插件实例数。
2. **容器内存与调用趋势**：
   - 按时间窗（`1h` / `24h` / `7d`）统计容器已用内存（MB）、调用次数、失败数与超时数。
   - `1h` 与 `24h` 按 5 分钟为一个完整时间桶，`7d` 按 1 小时为一个时间桶。
3. **插件错误排行**：
   - 统计时间窗内失败率或超时率偏高的插件排行及错误次数。
4. **Daemon 探测与健康状态**：
   - 插件 Daemon 探测健康度、实例平均延迟、最后探测依据。未采集时安全降级为 `null`。
5. **自动禁用记录台账（`disables`）**：
   - 取自 PLG-04 及紧急事件安全台账。
   - 包含禁用时间、插件名称、版本号、工作区 ID、触发规则（失败率/超时率）、阈值、实测值、恢复状态（待确认/观察中/已恢复）及关联工单号。
   - 支持多字段搜索与分页。
6. **安装实例台账（`instances`）**：
   - 包含安装实例 ID（`installationId`）、插件名称、版本、工作区 ID、安装人、组织、状态及关联工单号。

## 2. API 接口定义

### `GET /api/plugin-monitor`

#### 查询参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `window` | `string` | 否 | `24h` | 时间窗口：`1h`、`24h`、`7d` |
| `org` | `string` | 否 | 全部 | 组织筛选；运维仅可查本人所属组织或全部（如具备权限），越权返回 403 |
| `q` | `string` | 否 | 空 | 搜索关键字，匹配插件名、版本、工作区 ID、工单号、安装人 |
| `page` | `integer` | 否 | 1 | 禁用记录与实例台账分页页码，最小为 1 |
| `pageSize` | `integer` | 否 | 10 | 每页条数，1 到 100 |

#### 响应结构 (200 OK)
```json
{
  "asOf": "2026-11-19T10:00:00.000Z",
  "window": "24h",
  "metrics": {
    "publishedCount": 42,
    "installedCount": 186,
    "runningCount": 173,
    "disabledCount": 3,
    "upgradableCount": 14,
    "vulnerableCount": 5
  },
  "sources": {
    "catalog": "collected",
    "daemon": "collected",
    "safety": "collected"
  },
  "trend": [
    { "time": "18:40", "memoryUsedMb": 512, "memoryLimitMb": 1024, "calls": 120, "failures": 4, "timeouts": 2 }
  ],
  "errorRanking": [
    { "name": "document-parser", "value": 18, "reason": "失败率偏高" },
    { "name": "browser-agent", "value": 12, "reason": "超时率偏高" }
  ],
  "daemonHealth": {
    "status": "healthy",
    "checkedAt": "2026-11-19T09:55:00.000Z",
    "instances": 173,
    "evidenceRef": "evidence-daemon-01"
  },
  "disables": {
    "total": 3,
    "page": 1,
    "pageSize": 10,
    "items": [
      {
        "disabledAt": "2026-11-19T09:42:00.000Z",
        "pluginName": "document-parser",
        "version": "2.4.1",
        "workspaceId": "ws_84f2",
        "installationId": "inst-101",
        "rule": "失败率",
        "threshold": "30%",
        "actualValue": "46.8%",
        "recoveryStatus": "待确认",
        "ticketNo": "PLG-04-1001"
      }
    ]
  },
  "instances": {
    "total": 186,
    "page": 1,
    "pageSize": 10,
    "items": [
      {
        "installationId": "inst-101",
        "pluginName": "document-parser",
        "version": "2.4.1",
        "workspaceId": "ws_84f2",
        "account": "chen.yu",
        "org": "业务一部",
        "status": "已禁用",
        "ticketNo": "PLG-03-1002",
        "installedAt": "2026-11-19T08:00:00.000Z"
      }
    ]
  }
}
```

#### 错误响应
- `400 INVALID_REQUEST`：非法查询参数或分页参数越界。
- `403 ACCESS_DENIED`：普通用户访问，或非管理员跨组织越权查询。
- `403 ACTOR_SESSION_CHANGED`：会话修订变更或账户被限制。
