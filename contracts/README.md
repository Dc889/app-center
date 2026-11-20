# 跨模块接口

| 提供方 | 调用方 | 接口与当前范围 |
| --- | --- | --- |
| 管理系统 | 能力组件 | [获准输入回调](management-api/openapi.json) |
| 管理系统内部 | 业务模块 / 平台层 | [管理端内部跨模块契约](management-modules/README.md)与[模块清单](management-modules/module-manifest.md) |
| 能力组件 | 管理系统 | [执行、查询、目录、取文件和回执](capability-api/openapi.yaml)，[动作登记](capability-api/actions.json)覆盖 27 种工单，EVT-01 对应空动作列表 |
| Skill 仓库 | 能力组件 | [目录、预约交付、文件和回执](repository-api/skill.openapi.yaml) |
| 其他三个仓库 | 能力组件 | [插件样例包](repository-api/plugin.openapi.json)、[MCP 只读目录](repository-api/mcp.openapi.json)、[智能体只读目录](repository-api/agent.openapi.json) |

提供方和调用方共同维护契约。接口变更同时更新规范、实现和 tests/integration 中的用例。浏览器使用的 /api/tickets 由管理组维护。Dify、RAGFlow 和模型中心的协议由能力组在适配器内处理。
部署核验接口为 GET /internal/v1/capabilities，可按 workspaceId 查询。能力服务通过 CAPABILITY_EVIDENCE_FILE 读取本部署维护的 JSON 数组，每项包含 ticketType、ticketTypeVersion、action、variant、workspaceId、state、reasonCode、checkedAt。通用范围用 null，实际工作区只匹配自身证据。缺少处理器返回 unsupported，已接线且缺少核验记录返回 unverified。

每个工单类型、类型版本、动作、实现方式和工作区的组合只保存一条当前核验记录。更新状态时替换原记录。查询遇到重复记录返回 HTTP 503 和错误码 `AMBIGUOUS_EVIDENCE`，管理端应暂停依赖该核验结果的发布操作。
