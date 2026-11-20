# 智能体仓库（Agent Warehouse）接口契约

本文档定义智能体仓库的业务契约与技术规范。

---

## 1. 概述与业务边界

依据《总设计》附录 A 与《app-center-design.md》：
1. **智能体仓库定位**：展示通过工单申请（AG-01、AG-02、AG-04 等）并且已经审核生效的智能体资产。
2. **多角色与组织隔离边界**：
   - **普通用户（`user`）**：
     - 只能看到自己可用且有权使用的条目（`directlyUsable === true`，且条目未配置组织限制或用户所属组织属于 `visibleOrgs`）。
     - 用户只看到成功调用排行，看不到暂不可用/已下架条目，看不到下架工单号和底层 Dify 调试信息。
     - 指标卡展示：`可用应用`、`三种方式齐全`、`可运行`、`可访问 API`。
     - 迭代记录表中隐藏工单号（ticket 为空或不展示）。
   - **运维人员（`ops`）与系统管理员（`admin`）**：
     - 能看到全量已生效条目（包括已下架、暂不可用条目）。
     - 指标卡展示：`已生效应用`、`可直接使用`、`三种方式齐全`、`暂不可用`。
     - 迭代记录表展示工单号，并支持点击穿透到工单详情抽屉。
     - 支持针对选中智能体快速发起下架（`AG-05`）或再发布（`AG-04`）工单联动。
3. **真实数据与动态联动**：
   - 彻底清空前端静态死数据（如 `warehouseAgents`、`successCountByApp`）。
   - 结合平台已办结工单（`applications` 表中已完成的 `AG-01`、`AG-02`、`AG-04`、`AG-05`）动态维护智能体的状态与迭代历史。

---

## 2. 接口定义

### `GET /api/agent-warehouse`

获取当前调用身份有权访问的智能体仓库目录列表、统计指标、使用排行与分类标签。

#### 请求头
- `Cookie` / `Authorization`：包含已登录的有效会话凭据。

#### 查询参数
| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `q` | string | 否 | - | 模糊搜索关键字（匹配名称、开发人员、账户、组织、简介、标签、版本号） |
| `tag` | string | 否 | `全部标签` | 标签筛选 |
| `method` | string | 否 | `全部方式` | 使用方式筛选：`run`（运行）、`embed`（嵌入网站）、`api`（访问 API） |
| `usable` | string | 否 | `全部` | 可用性筛选：`全部`、`可直接使用`、`暂不可用`、`三种方式齐全` |

#### 响应格式（`application/json`）
```json
{
  "asOf": "2026-11-19T21:30:00.000Z",
  "role": "ops",
  "org": "平台运营组",
  "metrics": {
    "total": 12,
    "usableCount": 10,
    "fullMethodCount": 4,
    "runCount": 9,
    "apiCount": 6,
    "unavailableCount": 2
  },
  "tags": ["刑侦", "摘要", "文书", "情指", "研判", "网安", "Agent", "线索", "治安", "问答", "经侦", "查询", "日志", "执法", "串并", "检索", "资金"],
  "ranking": [
    {
      "id": "app_case_summary",
      "name": "案件摘要助手",
      "developer": "陈宇",
      "org": "业务一部",
      "count": 18
    }
  ],
  "items": [
    {
      "id": "app_case_summary",
      "name": "案件摘要助手",
      "emoji": "📋",
      "developer": "陈宇",
      "developerAccount": "chen.yu",
      "org": "业务一部",
      "description": "读取案件材料、法规和文书范例，生成可复核的案件摘要，并标出引用出处。",
      "tags": ["刑侦", "摘要", "文书"],
      "directlyUsable": true,
      "methods": ["run", "embed", "api"],
      "unavailableReason": "",
      "visibleOrgs": [],
      "mode": "Chatflow",
      "successCount": 18,
      "releases": [
        {
          "version": "v1.6",
          "publishedAt": "11-16 20:18",
          "changedAt": "11-16 19:46",
          "summary": "接入档案检索，摘要增加出处标注",
          "ticket": "AG-20261116-0142"
        }
      ]
    }
  ]
}
```

---

## 3. 错误状态码
- `400 INVALID_QUERY`：查询参数格式或长度非法。
- `403 ACCESS_DENIED`：未登录或无效会话。
