# 跨模块接口

| 提供方 | 调用方 | 接口与当前范围 |
| --- | --- | --- |
| 管理系统 | 能力组件 | [获准输入回调](management-api/openapi.json) |
| 能力组件 | 管理系统 | [执行、查询、目录、取文件和回执](capability-api/openapi.yaml)，[动作登记](capability-api/actions.json)覆盖 27 种工单，EVT-01 对应空动作列表 |
| Skill 仓库 | 能力组件 | [目录、预约交付、文件和回执](repository-api/skill.openapi.yaml) |
| 其他三个仓库 | 能力组件 | [插件样例包](repository-api/plugin.openapi.json)、[MCP 只读目录](repository-api/mcp.openapi.json)、[智能体只读目录](repository-api/agent.openapi.json) |

提供方和调用方共同维护契约。接口变更同时更新规范、实现和 tests/integration 中的用例。浏览器使用的 /api/tickets 由管理组维护。Dify、RAGFlow 和模型中心的协议由能力组在适配器内处理。
