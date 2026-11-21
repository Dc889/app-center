# AI 运营管理平台（app-center）Docker 容器化部署指南

## 1. 镜像与容器总览（6 个业务镜像 + 1 个 MySQL 8.0）

| 镜像 | 容器名 | 网络域 | 数据存储 | 独立升级场景 |
| --- | --- | --- | --- | --- |
| `app-center-web` | `web` | `edge_net` | 无状态 | 前端 UI / 路由改版 |
| `app-center-management` | `management` | `edge_net` + `internal_net` | MySQL `app_center_mgmt` + 卷 | 工单/审批/审计升级 |
| `app-center-repositories` | `repo-skill` / `repo-plugin` / `repo-mcp` / `repo-agent` | `internal_net`（完全断外网） | MySQL `app_center_repo` + 4 独立对象卷 | 仅自身资产模型升级，**不随外部子系统重启** |
| `app-center-executor` | `executor` | `internal_net` + `connector_net`（断外网） | MySQL `app_center_exec` + 卷 | 工单编排逻辑升级；**不持有外部产品密钥** |
| `app-center-connector-dify` | `connector-dify` | `connector_net` + `outbound_net` | 无状态（无库） | **随 Dify 1.7.1 → 1.14.0 单独升级发版** |
| `app-center-connector-ragflow` | `connector-ragflow` | `connector_net` + `outbound_net` | 无状态（无库） | **随 RAGFlow 0.22.1 → 新版单独升级发版** |
| `mysql:8.0.39` | `mysql` | `internal_net`（完全断外网） | 3 逻辑库 + 3 最小权限账号 | 基础设施 |

## 2. 快速启动

```bash
cd app-center/docker
cp .env.example .env
# 编辑 .env 填入 INTERNAL_TOKEN、Dify/RAGFlow 地址与凭据
docker compose build
docker compose up -d
docker compose ps
```

访问入口：`http://localhost:8088/`

## 3. 单独升级子系统 Connector（以 Dify 1.7.1 → 1.14.0 为例）

只需构建并滚动替换 `connector-dify`，管理系统、四大仓库、能力编排器、RAGFlow Connector 与 MySQL 全部**零停机、零重启**：

```bash
# 1. 构建新版 Dify 连接器镜像
DIFY_CONNECTOR_TAG=1.14.0 docker compose build connector-dify

# 2. 更新 .env 中 DIFY_CONNECTOR_TAG=1.14.0 与 DIFY_ADAPTER_VERSION=1.14.0
# 3. 仅滚动替换 connector-dify 容器
docker compose up -d --no-deps connector-dify
```

## 4. 离线内网分区部署（导出/导入 7 个镜像）

```bash
# 导出离线镜像包
docker save -o app-center-images.tar \
  app-center-web:1.0.0 \
  app-center-management:1.0.0 \
  app-center-repositories:1.0.0 \
  app-center-executor:1.0.0 \
  app-center-connector-dify:1.7.1 \
  app-center-connector-ragflow:0.22.1 \
  mysql:8.0.39

# 目标分区导入
docker load -i app-center-images.tar
```

用户域与数据域复用同一套镜像，各自部署独立 `docker/.env` 与独立数据卷即可实现分区彻底隔离。
