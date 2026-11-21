# AI 运营管理平台

单仓多服务组织：

| 目录 | 内容 |
| --- | --- |
| `management/` | 管理系统：`app/` 装配、`platform/` 公共底座、`modules/` 11 个业务模块、`shared-ui/` 前端公共组件与样式 |
| `capability/` | 能力组件：`app/` 启动、`platform/` 执行框架与连接器客户端、`modules/` 11 个业务模块、`repositories/{skill,plugin,mcp,agent}` 四个独立仓库 |
| `connectors/{dify,ragflow}` | 独立子系统连接器，唯一持有外部产品凭据，可随产品版本单独升级 |
| `runtime/` | 共享 HTTP 运行时与存储层（MySQL 8.0 / SQLite 双驱动） |
| `server/` | 生产启动入口与服务端精简依赖 |
| `docker/` | 6 业务镜像 + MySQL 8.0 容器编排 |

服务之间使用 HTTP。架构总览见 [ARCHITECTURE](docs/ARCHITECTURE.md)，[共享契约](contracts/README.md)按提供方归档，[能力分工与结构](分工文档/能力组件结构与分工.md)说明目录归属与测试命令。

## 本机开发

采用 Node.js 22.23 或兼容版本。在本目录运行 `npm ci` 安装依赖，`npm run dev` 启动页面、管理 API 和本机能力服务（SQLite 落在 `.local-data/`，可用 `APP_DATA_DIR` 覆盖）。`npm run dev:live` 读取 `.local-data/local-products.json` 接入本地真实 Dify 与 RAGFlow。

页面使用独立 URL 路由（如 `/overview`、`/knowledge`、`/manual/TOL-01`），支持浏览器前进/后退与刷新保持登录。

| 检查 | 命令 |
| --- | --- |
| 全量门禁（边界 + lint + 构建 + 集成测试） | `npm run check` |
| 能力端测试 | `npm run test:capability [-- 模块名]` |
| 管理模块测试 | `npm run test:module -- 模块名` |
| 浏览器回归 | `node dev/check-ui-browser.mjs` |
| 视觉巡检 | `node dev/review-ui.mjs` |

## 分组开发

在各终端设置相同的 `INTERNAL_TOKEN` 后分别启动服务；`PORT` 修改监听端口，`CAPABILITY_URL`、`SKILL_URL` 等配置下游。设置 `CAPABILITY_URL` 后运行 `npm run dev` 只启动页面及管理 API。

| 服务 | 开发命令 | 生产入口 | 默认端口 |
| --- | --- | --- | --- |
| 管理后端 | `npm run service -- management` | `server/start-management.mjs` | 4300 |
| 能力执行 | `npm run service -- executor` | `server/start-executor.mjs` | 4310 |
| Skill / 插件 / MCP / 智能体仓库 | `npm run service -- skill\|plugin\|mcp\|agent` | `server/start-repository.mjs`（`REPO_SERVICE`） | 4311–4314 |
| Dify 连接器 | — | `server/start-connector-dify.mjs` | 4321 |
| RAGFlow 连接器 | — | `server/start-connector-ragflow.mjs` | 4322 |

executor 设置 `DIFY_CONNECTOR_URL` / `RAGFLOW_CONNECTOR_URL` 后经连接器访问外部产品；未设置时兼容直连（本地开发与测试）。

## 容器化部署

```bash
cd docker
cp .env.example .env   # 填入 INTERNAL_TOKEN 与 Dify/RAGFlow 地址、凭据
docker compose build
docker compose up -d
```

访问 `http://localhost:8088/`。镜像清单、MySQL 三库隔离、连接器独立升级与离线导出见 [docker/README.md](docker/README.md)。

本地环境使用演示角色和共享内部令牌。正式部署需接入受信登录、服务身份与双向 TLS，并替换演示口令与证书。完整业务规则见[总设计](分工文档/总设计.md)。
