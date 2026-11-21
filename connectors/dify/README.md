# Dify Connector (`app-center-connector-dify`)

独立的 Dify 协议适配微服务（无状态，无需数据库）。

- **职责**：隔离所有 Dify Console API、Plugin Daemon API、运行期 401 令牌续签与版本差异（如 Dify 1.7.1 → 1.14.0）。
- **安全边界**：全平台唯一持有 `DIFY_*` 外部凭据的容器；对外通过内网 `Bearer INTERNAL_TOKEN` 向 `app-center-executor` 暴露 `/connector/v1/*`。
- **独立升级**：当目标分区升级 Dify 版本时，仅需升级并滚动替换 `app-center-connector-dify` 镜像，无需改动或重启管理系统、四大仓库、能力编排器或 RAGFlow Connector。
