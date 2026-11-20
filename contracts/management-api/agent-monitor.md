# 智能体监控契约（Dify 全量智能体与调用审计）

提供方：管理系统后端  
调用方：管理系统前端（运维人员、系统管理员）  
协议：HTTP JSON

## 1. 概述与范围

按总设计与管理系统开发分工第 8.3 节实现智能体监控（`agentMonitor` / `DifyAgentMonitorPage`）。
仅具备 `operator`（平台运维）或 `admin`（系统管理员）角色的有效账户可访问，普通用户拒绝访问（HTTP 403 `ACCESS_DENIED`）。

监控包含四大核心区块与数据来源：
1. **指标卡（四项指标）**：
   - Dify 账户数（`accountCount`）：有智能体应用开发的账户数。未采集为 `null`。
   - 全部应用数（`totalAppCount`）：Dify 全量智能体应用（含已上架与未走工单应用）。未采集为 `null`。
   - 未进仓库数（`outsideAppCount`）：只存在于 Dify、未发布到应用中心仓库的应用数。
   - 调用记录数（`callCount`）：可逐条审计与溯源的调用总数（包含成功与失败）。
2. **账户 / 应用树（`accountGroups`）**：
   - 盘点各账户下的应用清单、仓库状态（工单应用 / 仅 Dify）与累计调用量。
   - 支持按全部账户、指定账户或具体应用节点向下穿梭。
3. **调用审计与过滤（`logs`）**：
   - 涵盖调用序号（`seq`）、时间、账户、应用名、调用 IP、调用方、使用的模型、知识库、MCP 与插件依赖标签、耗时、状态码、业务结果及错误码。
   - 支持关键字搜索，多字段联合筛选（账户、应用、IP、模型、知识库、MCP、插件）。
4. **调用明细溯源抽屉（`InvocationTrace`）**：
   - 点击「溯源」打开详细侧边栏，查看单次调用的完整上下文（账户、组织、应用模式、调用方、耗时、HTTP 状态、错误码）以及本次实际使用的模型、知识库、MCP 工具与插件清单。

## 2. API 接口定义

### `GET /api/agent-monitor`

#### 查询参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `window` | `string` | 否 | `24h` | 时间窗口：`1h`、`24h`、`7d` |
| `org` | `string` | 否 | 全部 | 组织筛选；运维仅可查本人所属组织或全部（如具备权限），越权返回 403 |
| `account` | `string` | 否 | 全部账户 | 过滤指定 Dify 开发者账户名 |
| `appName` | `string` | 否 | 全部应用 | 过滤指定智能体应用名称 |
| `ip` | `string` | 否 | 全部 IP | 过滤调用 IP |
| `model` | `string` | 否 | 全部模型 | 过滤使用模型 |
| `knowledge` | `string` | 否 | 全部知识库 | 过滤使用知识库 |
| `mcp` | `string` | 否 | 全部 MCP | 过滤使用 MCP |
| `plugin` | `string` | 否 | 全部插件 | 过滤使用插件 |
| `q` | `string` | 否 | 空 | 搜索关键字，匹配账户、应用名、IP、模型、知识库、MCP 或插件 |
| `page` | `integer` | 否 | 1 | 调用记录分页页码，最小为 1 |
| `pageSize` | `integer` | 否 | 20 | 每页条数，1 到 100 |

#### 响应结构 (200 OK)
```json
{
  "asOf": "2026-11-19T10:50:00.000Z",
  "window": "24h",
  "metrics": {
    "accountCount": 7,
    "totalAppCount": 17,
    "outsideAppCount": 3,
    "callCount": 61,
    "failedCallCount": 7
  },
  "sources": {
    "difyCatalog": "collected",
    "invocations": "collected"
  },
  "accountGroups": [
    {
      "account": "chen.yu",
      "name": "陈宇",
      "org": "业务一部",
      "useCount": 19,
      "apps": [
        {
          "name": "案件摘要助手",
          "appId": "df_app_01",
          "appMode": "工作流编排",
          "inWarehouse": true,
          "useCount": 12
        },
        {
          "name": "文书草稿",
          "appId": "df_app_13",
          "appMode": "单智能体",
          "inWarehouse": false,
          "useCount": 2
        }
      ]
    }
  ],
  "filterOptions": {
    "ipOptions": ["10.24.16.12", "10.24.16.72"],
    "modelOptions": ["gpt-4.1-mini", "qwen-max"],
    "knowledgeOptions": ["案件法规库", "文书范例库"],
    "mcpOptions": ["search_archive", "query_company"],
    "pluginOptions": ["web-search-pro", "document-parser"]
  },
  "logs": {
    "total": 61,
    "page": 1,
    "pageSize": 20,
    "items": [
      {
        "seq": 1,
        "time": "11-16 20:48:00",
        "ownerAccount": "chen.yu",
        "ownerName": "陈宇",
        "ownerOrg": "业务一部",
        "appName": "案件摘要助手",
        "appId": "df_app_01",
        "appMode": "工作流编排",
        "sourceIp": "10.24.16.72",
        "caller": "广场用户 chen.yu · 业务一部",
        "models": ["openai / gpt-4.1-mini · 1,284入 / 342出"],
        "modelLabels": ["gpt-4.1-mini"],
        "knowledgeBases": ["案件法规库（ds_case_01）· 命中2段"],
        "knowledgeLabels": ["案件法规库"],
        "mcpCalls": ["档案检索服务 / search_archive · 1.8s"],
        "mcpLabels": ["search_archive"],
        "pluginCalls": [],
        "pluginLabels": [],
        "duration": "2.4s",
        "httpStatus": "200 OK",
        "result": "成功",
        "errorCode": "—"
      }
    ]
  }
}
```

#### 错误响应
- `400 INVALID_REQUEST`：非法查询参数或分页参数越界。
- `403 ACCESS_DENIED`：普通用户访问，或非管理员跨组织越权查询。
- `403 ACTOR_SESSION_CHANGED`：会话修订变更或账户被限制。
