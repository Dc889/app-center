# AI 运营管理平台

管理系统按功能位于 `management/modules/`，公共装配与基础位于 `management/app/`、`management/platform/`。能力组件按功能位于 `capability/modules/`，公共执行框架位于 `capability/platform/`，启动位于 `capability/app/`；四个独立仓库位于 `capability/repositories/{skill,plugin,mcp,agent}/`。服务之间使用HTTP。[共享契约](contracts/README.md)按提供方归档，[能力分工与结构](分工文档/能力组件结构与分工.md)说明目录归属与测试命令。

## 本机联调

采用 Node.js 22.23 或兼容版本。在本目录运行 `npm ci` 安装依赖，`npm run dev` 启动页面、管理 API 和本机能力服务。运行 `npm run test:integration` 检查跨服务调用，`npm run build` 构建页面，`npm run lint` 检查代码。

从页面选择“用户 → 手工申请 → SKL-03 → 公文摘要 Skill → 提交申请 → 领取文件”。文件发送完成、回执确认后工单完成。在“我的申请”查看当前浏览器会话的记录。SQLite 数据默认保存在忽略提交的 `.local-data/`，可用 `APP_DATA_DIR` 覆盖。迁移前下载流水原样存于 `capability/repositories/skill/legacy-data`。

## 分组开发

在各开发终端设置相同的 `INTERNAL_TOKEN` 后分别启动下表服务。可用 `PORT` 修改监听端口，通过 `CAPABILITY_URL`、`SKILL_URL`、`PLUGIN_URL` 配置下游或模拟对端。设置 `CAPABILITY_URL` 后运行 `npm run dev`，只启动页面及管理 API。

| 服务 | 命令 | 默认端口 |
| --- | --- | --- |
| 管理后端 | `npm run service -- management` | 4300 |
| 能力执行 | `npm run service -- executor` | 4310 |
| Skill 仓库 | `npm run service -- skill` | 4311 |
| 插件仓库 | `npm run service -- plugin` | 4312 |
| MCP 目录 | `npm run service -- mcp` | 4313 |
| 智能体目录 | `npm run service -- agent` | 4314 |

本地环境使用演示角色和回环 HTTP 服务令牌。真实部署需接入受信登录、服务身份与双向 TLS。真实插件安装需要核验产品身份、工作区及部署配置。MCP 与智能体仓库目前提供只读入口。完整业务规则见[总设计](分工文档/总设计.md)。
