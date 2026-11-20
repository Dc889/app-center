# Skill 监控契约

提供方：管理系统后端  
调用方：管理系统前端（运维人员、系统管理员）  
协议：HTTP JSON

## 1. 概述与范围

按总设计与管理系统开发分工第 8.6 节实现 Skill 监控。
仅具备 `operator`（平台运维）或 `admin`（系统管理员）角色的有效账户可访问，普通用户拒绝访问（HTTP 403 `ACCESS_DENIED`）。

监控包含四个核心区块与目录指标：
1. **目录指标卡（五项指标）**：
   - 已上架 Skill 数量（`publishedCount`）：来自能力端/仓库生效目录。未采集为 `null`。
   - 待审核工单数（`pendingCount`）：来自管理库中 SKL-01/SKL-02/SKL-04 处于待审批/待研判的工单数。
   - 已下架 Skill 数量（`withdrawnCount`）：来自管理库下架完成记录或目录已下架条目。
   - 生效版本总数（`versionCount`）：来自生效目录中所有可用版本的总和。未采集为 `null`。
   - 存储占用（`storageBytes` / `storageFormatted`）：生效 Skill 文件累计字节大小。未采集为 `null`。
   - 终态失败数（`deliveryFailures`）：时间窗内交付终态失败（`failed`/`cancelled`）的次数。
2. **下载趋势**：
   - 按时间窗（`1h` / `24h` / `7d`）统计成功下载与失败下载次数。
   - `1h` 与 `24h` 按 5 分钟为一个完整时间桶，`7d` 按 1 小时为一个时间桶。
3. **下载人组织分布**：
   - 统计时间窗内成功交付按下载人历史组织的分布与排行。
4. **下载明细台账（结算流水）**：
   - 取自管理库中实际发生的 `SKL-03` 交付流水。
   - 包含流水号（`resultId`）、时间、账户名、姓名、组织、Skill名称、版本、文件指纹（SHA-256前缀/完整）、状态及对应工单号。
   - 成功去重人数（`uniqueAccounts`）：时间窗内成功下载的去重账户数。

## 2. API 接口定义

### `GET /api/skill-monitor`

#### 查询参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `window` | `string` | 否 | `24h` | 时间窗口：`1h`、`24h`、`7d` |
| `org` | `string` | 否 | 全部 | 组织筛选；运维仅可查本人所属组织或全部（如具备权限），越权返回 403 |
| `q` | `string` | 否 | 空 | 搜索关键字，匹配流水号、Skill名称、账户、姓名、工单号 |
| `page` | `integer` | 否 | 1 | 分页页码，最小为 1 |
| `pageSize` | `integer` | 否 | 10 | 每页条数，1 到 100 |

#### 响应结构 (200 OK)
```json
{
  "asOf": "2026-11-19T09:20:00.000Z",
  "window": "24h",
  "metrics": {
    "publishedCount": 2,
    "pendingCount": 0,
    "withdrawnCount": 0,
    "versionCount": 2,
    "storageBytes": 188,
    "storageFormatted": "188 B",
    "deliveryFailures": 0
  },
  "trend": [
    { "time": "17:15", "success": 1, "failed": 0, "total": 1 }
  ],
  "orgDistribution": [
    { "name": "业务一部", "value": 1 }
  ],
  "deliveries": {
    "total": 1,
    "page": 1,
    "pageSize": 10,
    "items": [
      {
        "deliveryId": "DL-x1",
        "time": "2026-11-19T09:18:00.000Z",
        "account": "chen.yu",
        "name": "陈宇",
        "org": "业务一部",
        "skillId": "skl_doc",
        "skillName": "公文摘要 Skill",
        "version": "v2.1.0",
        "sha256": "a8df...",
        "status": "成功",
        "ticketNo": "SKL-03-1001"
      }
    ]
  },
  "uniqueAccounts": 1,
  "sources": {
    "catalog": "collected",
    "deliveries": "collected"
  }
}
```

#### 错误响应
- `400 INVALID_REQUEST`：非法查询参数或分页参数越界。
- `403 ACCESS_DENIED`：普通用户访问，或非管理员跨组织越权查询。
- `403 ACTOR_SESSION_CHANGED`：会话修订变更或账户被限制。
